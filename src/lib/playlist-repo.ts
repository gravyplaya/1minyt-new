/**
 * TAV-26: Data access for curated channel playlists.
 *
 * Backed by PostgreSQL. All functions are async. The repo layer owns the
 * mapping between the YouTube API shapes (ChannelPlaylist / PlaylistVideo) and
 * the stored rows (PlaylistRow / PlaylistVideoRow).
 */

import { getDb } from './db';
import { newId } from './id';
import type { ChannelPlaylist, PlaylistVideo } from './youtube';
import type { PlaylistRow, PlaylistVideoRow, PlaylistSummary, PlaylistWithChannel } from './types';

// ----- playlists --------------------------------------------------------------

/**
 * Upsert a batch of playlists fetched for a channel. Re-fetching a channel's
 * playlists replaces the whole set: stale playlists (deleted on YouTube) are
 * removed, new ones inserted, and existing ones updated in place. This mirrors
 * the "snapshot is more useful than a diff" stance the rest of the app takes
 * with sync.
 */
export async function upsertChannelPlaylists(
  channelId: string,
  playlists: ChannelPlaylist[],
): Promise<void> {
  const client = await getDb();
  try {
    const now = Math.floor(Date.now() / 1000);
    // Replace the whole set for this channel so deleted-on-YouTube playlists
    // don't linger. Playlist video rows cascade-delete via the FK. The whole
    // replace operation runs in a single transaction — if any insert fails, the
    // prior rows are restored (matches the setChannelFolders pattern in repo.ts).
    await client.query('BEGIN');
    await client.query('DELETE FROM channel_playlists WHERE channel_id = $1', [channelId]);
    for (const p of playlists) {
      if (!p.playlist_id) continue;
      await client.query(
        `INSERT INTO channel_playlists (
          playlist_id, channel_id, title, description,
          thumbnail_url, item_count, published_at, synced_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (playlist_id) DO UPDATE SET
          channel_id = excluded.channel_id,
          title = excluded.title,
          description = excluded.description,
          thumbnail_url = excluded.thumbnail_url,
          item_count = excluded.item_count,
          published_at = excluded.published_at,
          synced_at = excluded.synced_at`,
        [
          p.playlist_id,
          p.channel_id,
          p.title,
          p.description,
          p.thumbnail_url,
          p.item_count,
          p.published_at,
          now,
        ],
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * List a channel's cached curated playlists, ordered alphabetically by title.
 * Returns an empty array when playlists haven't been fetched yet.
 */
export async function listChannelPlaylists(channelId: string): Promise<PlaylistRow[]> {
  const client = await getDb();
  try {
    const { rows } = await client.query<PlaylistRow>(
      `SELECT playlist_id, channel_id, title, description,
              thumbnail_url, item_count, published_at, synced_at
       FROM channel_playlists
       WHERE channel_id = $1
       ORDER BY title ASC`,
      [channelId],
    );
    return rows;
  } finally {
    client.release();
  }
}

/**
 * Fetch a single cached playlist, joined with its channel title + thumbnail for
 * the playlist detail page header. Returns null when the playlist isn't cached
 * locally (the user should fetch playlists from the channel page first).
 */
export async function getPlaylist(playlistId: string): Promise<PlaylistWithChannel | null> {
  const client = await getDb();
  try {
    const { rows } = await client.query<{
      playlist_id: string;
      channel_id: string;
      title: string;
      description: string | null;
      thumbnail_url: string | null;
      item_count: number | null;
      published_at: number | null;
      synced_at: number;
      channel_title: string;
      channel_thumbnail_url: string | null;
    }>(
      `SELECT
         p.playlist_id, p.channel_id, p.title, p.description,
         p.thumbnail_url, p.item_count, p.published_at, p.synced_at,
         c.title AS channel_title,
         c.thumbnail_url AS channel_thumbnail_url
       FROM channel_playlists p
       JOIN channels c ON c.channel_id = p.channel_id
       WHERE p.playlist_id = $1`,
      [playlistId],
    );
    if (rows.length === 0) return null;
    const r = rows[0];
    return {
      playlist_id: r.playlist_id,
      channel_id: r.channel_id,
      title: r.title,
      description: r.description,
      thumbnail_url: r.thumbnail_url,
      item_count: r.item_count,
      published_at: r.published_at,
      synced_at: r.synced_at,
      channel_title: r.channel_title,
      channel_thumbnail_url: r.channel_thumbnail_url,
    };
  } finally {
    client.release();
  }
}

// ----- playlist videos --------------------------------------------------------

/**
 * Upsert a batch of videos for a single playlist. Re-fetching replaces the
 * whole set for the playlist so removed videos (deleted on YouTube or dropped
 * from the playlist) don't linger. Each video row is also upserted into the
 * main `videos` table as a baseline so the summarize pipeline can find it.
 */
export async function upsertPlaylistVideos(
  playlistId: string,
  videos: PlaylistVideo[],
): Promise<void> {
  const client = await getDb();
  try {
    const now = Math.floor(Date.now() / 1000);
    // Snapshot-replace in a transaction so a failed insert midway doesn't leave
    // the playlist with a partial video set (the prior rows are already gone).
    await client.query('BEGIN');
    await client.query('DELETE FROM playlist_videos WHERE playlist_id = $1', [playlistId]);
    for (const v of videos) {
      if (!v.video_id) continue;
      await client.query(
        `INSERT INTO playlist_videos (
          playlist_id, video_id, title, description,
          thumbnail_url, position, published_at, synced_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (playlist_id, video_id) DO UPDATE SET
          title = excluded.title,
          description = excluded.description,
          thumbnail_url = excluded.thumbnail_url,
          position = excluded.position,
          published_at = excluded.published_at,
          synced_at = excluded.synced_at`,
        [
          playlistId,
          v.video_id,
          v.title,
          v.description,
          v.thumbnail_url,
          v.position,
          v.published_at,
          now,
        ],
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * List the cached videos for a playlist, in playlist order (position ascending),
 * hydrated with duration + summary-presence from the main `videos` table.
 */
export async function listPlaylistVideos(playlistId: string): Promise<PlaylistVideoRow[]> {
  const client = await getDb();
  try {
    const { rows } = await client.query<{
      video_id: string;
      title: string;
      description: string | null;
      thumbnail_url: string | null;
      position: number;
      published_at: number | null;
      duration_seconds: number | null;
      summary_count: string;
    }>(
      `SELECT
         pv.video_id, pv.title, pv.description, pv.thumbnail_url,
         pv.position, pv.published_at,
         v.duration_seconds AS duration_seconds,
         (SELECT COUNT(*) FROM summaries s WHERE s.video_id = pv.video_id) AS summary_count
       FROM playlist_videos pv
       LEFT JOIN videos v ON v.video_id = pv.video_id
       WHERE pv.playlist_id = $1
       ORDER BY pv.position ASC`,
      [playlistId],
    );
    return rows.map(r => ({
      video_id: r.video_id,
      playlist_id: playlistId,
      title: r.title,
      description: r.description,
      thumbnail_url: r.thumbnail_url,
      position: r.position,
      published_at: r.published_at,
      duration_seconds: r.duration_seconds,
      has_summary: Number(r.summary_count) > 0,
    }));
  } finally {
    client.release();
  }
}

/** Return the set of video_ids currently cached for a playlist. */
export async function listPlaylistVideoIds(playlistId: string): Promise<Set<string>> {
  const client = await getDb();
  try {
    const { rows } = await client.query<{ video_id: string }>(
      'SELECT video_id FROM playlist_videos WHERE playlist_id = $1',
      [playlistId],
    );
    return new Set(rows.map(r => r.video_id));
  } finally {
    client.release();
  }
}

// ----- playlist summary -------------------------------------------------------

/**
 * Persist (or overwrite) the LLM-generated synthesis for a playlist. Upserts
 * by playlist_id — re-summarizing replaces the prior synthesis.
 */
export async function savePlaylistSummary(input: {
  playlist_id: string;
  model: string;
  synthesis: string;
  themes: string[];
  start_here: string[];
  token_count: number | null;
}): Promise<PlaylistSummary> {
  const client = await getDb();
  try {
    const now = Math.floor(Date.now() / 1000);
    const id = newId();
    const themesJson = JSON.stringify(input.themes);
    const startHereJson = JSON.stringify(input.start_here);
    await client.query(
      `INSERT INTO playlist_summaries (id, playlist_id, model, synthesis, themes, start_here, token_count, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (playlist_id) DO UPDATE SET
        id = excluded.id,
        model = excluded.model,
        synthesis = excluded.synthesis,
        themes = excluded.themes,
        start_here = excluded.start_here,
        token_count = excluded.token_count,
        created_at = excluded.created_at`,
      [id, input.playlist_id, input.model, input.synthesis, themesJson, startHereJson, input.token_count, now],
    );
    return {
      id,
      playlist_id: input.playlist_id,
      model: input.model,
      synthesis: input.synthesis,
      themes: input.themes,
      start_here: input.start_here,
      token_count: input.token_count,
      created_at: now,
    };
  } finally {
    client.release();
  }
}

/** Fetch a playlist's cached synthesis, or null when not yet summarized. */
export async function getPlaylistSummary(playlistId: string): Promise<PlaylistSummary | null> {
  const client = await getDb();
  try {
    const { rows } = await client.query<{
      id: string;
      playlist_id: string;
      model: string;
      synthesis: string;
      themes: string;
      start_here: string;
      token_count: number | null;
      created_at: number;
    }>(
      'SELECT id, playlist_id, model, synthesis, themes, start_here, token_count, created_at FROM playlist_summaries WHERE playlist_id = $1',
      [playlistId],
    );
    if (rows.length === 0) return null;
    const r = rows[0];
    let themes: string[] = [];
    let startHere: string[] = [];
    try { themes = JSON.parse(r.themes) as string[]; } catch { /* keep default */ }
    try { startHere = JSON.parse(r.start_here) as string[]; } catch { /* keep default */ }
    return {
      id: r.id,
      playlist_id: r.playlist_id,
      model: r.model,
      synthesis: r.synthesis,
      themes,
      start_here: startHere,
      token_count: r.token_count,
      created_at: r.created_at,
    };
  } finally {
    client.release();
  }
}
