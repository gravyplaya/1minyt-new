/**
 * Data access for videos + summaries (TAV-4) + chat messages (TAV-5).
 *
 * All functions are async — backed by PostgreSQL.
 */

import { getDb } from './db';
import { newId } from './id';
import type { Chapter, ChatMessage, CommunityPulse, FollowUp, MostReferencedVideo, ReferenceType, SummaryRow, TranscriptSource, TranscriptStatus, VideoComment, VideoRow, VideoWithSummary, VideoReferenceWithTarget } from './types';

const SUMMARY_MODEL_KEY = process.env.SUMMARY_MODEL?.trim() || 'openai/gpt-oss-20b:free';

export async function upsertVideo(input: Omit<VideoRow, 'transcript' | 'transcript_status' | 'transcript_fetched_at' | 'transcript_source' | 'created_at' | 'updated_at'> & {
  transcript?: string | null;
  transcript_status?: TranscriptStatus;
  transcript_fetched_at?: number | null;
  transcript_source?: TranscriptSource | null;
}): Promise<void> {
  const client = await getDb();
  try {
    const now = Math.floor(Date.now() / 1000);
    const { rows } = await client.query('SELECT video_id FROM videos WHERE video_id = $1', [input.video_id]);
    if (rows.length > 0) {
      await client.query(
        `UPDATE videos SET
          channel_id=$2, title=$3, description=$4,
          thumbnail_url=$5, duration_seconds=$6,
          published_at=$7,
          transcript=COALESCE($8, transcript),
          transcript_status=COALESCE($9, transcript_status),
          transcript_fetched_at=COALESCE($10, transcript_fetched_at),
          transcript_source=COALESCE($11, transcript_source),
          view_count=$12,
          like_count=$13,
          comment_count=$14,
          favorite_count=$15,
          tags=$16,
          category_id=$17,
          is_live=$18,
          live_streaming_details=$19,
          updated_at=$20
        WHERE video_id=$1`,
        [
          input.video_id, input.channel_id, input.title, input.description,
          input.thumbnail_url, input.duration_seconds,
          input.published_at,
          input.transcript ?? null,
          input.transcript_status ?? null,
          input.transcript_fetched_at ?? null,
          input.transcript_source ?? null,
          input.view_count,
          input.like_count,
          input.comment_count,
          input.favorite_count,
          input.tags,
          input.category_id,
          input.is_live,
          input.live_streaming_details,
          now,
        ],
      );
      return;
    }
    await client.query(
      `INSERT INTO videos (
        video_id, channel_id, title, description, thumbnail_url,
        duration_seconds, published_at,
        transcript, transcript_status, transcript_fetched_at, transcript_source,
        view_count, like_count, comment_count, favorite_count,
        tags, category_id, is_live, live_streaming_details,
        created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5,
        $6, $7,
        $8, $9, $10, $11,
        $12, $13, $14, $15,
        $16, $17, $18, $19,
        $20, $21
      )`,
      [
        input.video_id, input.channel_id, input.title, input.description,
        input.thumbnail_url, input.duration_seconds,
        input.published_at,
        input.transcript ?? null,
        input.transcript_status ?? 'pending',
        input.transcript_fetched_at ?? null,
        input.transcript_source ?? null,
        input.view_count,
        input.like_count,
        input.comment_count,
        input.favorite_count,
        input.tags,
        input.category_id,
        input.is_live,
        input.live_streaming_details,
        now, now,
      ],
    );
  } finally {
    client.release();
  }
}

/** TAV-19: persist a fetched transcript. `source` records whether it came
 *  from YouTube captions ('youtube') or Whisper speech-to-text ('whisper'). */
export async function setTranscript(videoId: string, text: string, source?: TranscriptSource): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const client = await getDb();
  try {
    await client.query(
      `UPDATE videos SET transcript = $1, transcript_status = 'fetched', transcript_fetched_at = $2, transcript_source = COALESCE($3, transcript_source), updated_at = $4 WHERE video_id = $5`,
      [text, now, source ?? null, now, videoId],
    );
  } finally {
    client.release();
  }
}

export async function setTranscriptStatus(videoId: string, status: TranscriptStatus): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const client = await getDb();
  try {
    await client.query('UPDATE videos SET transcript_status = $1, updated_at = $2 WHERE video_id = $3', [status, now, videoId]);
  } finally {
    client.release();
  }
}

export async function getVideo(videoId: string): Promise<VideoRow | null> {
  const client = await getDb();
  try {
    const { rows } = await client.query<VideoRow>('SELECT * FROM videos WHERE video_id = $1', [videoId]);
    return rows[0] ?? null;
  } finally {
    client.release();
  }
}

export async function listVideosByChannel(channelId: string, limit = 30): Promise<VideoWithSummary[]> {
  const client = await getDb();
  try {
    const { rows } = await client.query<VideoRow>(
      'SELECT * FROM videos WHERE channel_id = $1 ORDER BY published_at DESC LIMIT $2',
      [channelId, limit],
    );
    if (rows.length === 0) return [];
    // Hydrate latest summary for each video in one query.
    const videoIds = rows.map(r => r.video_id);
    const placeholders = videoIds.map((_, i) => `$${i + 1}`).join(',');
    const summaryResult = await client.query(
      `SELECT DISTINCT ON (video_id) * FROM summaries
       WHERE video_id IN (${placeholders})
       ORDER BY video_id, created_at DESC`,
      videoIds,
    );
    const summaryMap = new Map<string, SummaryRow>();
    for (const row of summaryResult.rows as SummaryDbRow[]) {
      summaryMap.set(row.video_id, hydrateSummary(row));
    }

    // Hydrate chapters for all videos in one query (TAV-13).
    const chapterResult = await client.query<{ video_id: string; chapters: string }>(
      `SELECT video_id, chapters FROM video_chapters WHERE video_id IN (${placeholders})`,
      videoIds,
    );
    const chapterMap = new Map<string, Chapter[]>();
    for (const row of chapterResult.rows) {
      try {
        chapterMap.set(row.video_id, JSON.parse(row.chapters) as Chapter[]);
      } catch { /* keep default */ }
    }

    // TAV-20: hydrate community pulse (comments + summary) for all videos.
    const pulseResult = await client.query<{
      video_id: string;
      comments: string;
      fetched_at: number;
      summary: string | null;
      summary_model: string | null;
    }>(`SELECT video_id, comments, fetched_at, summary, summary_model FROM video_comments WHERE video_id IN (${placeholders})`, videoIds);
    const pulseMap = new Map<string, CommunityPulse>();
    for (const row of pulseResult.rows) {
      let comments: VideoComment[] = [];
      try { comments = JSON.parse(row.comments) as VideoComment[]; } catch { /* keep default */ }
      pulseMap.set(row.video_id, {
        video_id: row.video_id,
        comments,
        summary: row.summary,
        summary_model: row.summary_model,
        fetched_at: row.fetched_at,
      });
    }

    return rows.map(row => ({
      ...row,
      summary: summaryMap.get(row.video_id) ?? null,
      chapters: chapterMap.get(row.video_id) ?? null,
      community_pulse: pulseMap.get(row.video_id) ?? null,
    }));
  } finally {
    client.release();
  }
}

export async function listRecentUploadIds(channelId: string, limit = 12): Promise<{ video_id: string; title: string }[]> {
  const client = await getDb();
  try {
    const { rows } = await client.query<{ video_id: string; title: string }>(
      'SELECT video_id, title FROM videos WHERE channel_id = $1 ORDER BY published_at DESC LIMIT $2',
      [channelId, limit],
    );
    return rows;
  } finally {
    client.release();
  }
}

/**
 * Return the set of video_ids currently cached for a channel. Used by the
 * digest generator to diff against freshly-fetched uploads and identify
 * which videos are genuinely new (inserted by this sync pass).
 */
export async function listVideoIdsByChannel(channelId: string): Promise<Set<string>> {
  const client = await getDb();
  try {
    const { rows } = await client.query<{ video_id: string }>(
      'SELECT video_id FROM videos WHERE channel_id = $1',
      [channelId],
    );
    return new Set(rows.map(r => r.video_id));
  } finally {
    client.release();
  }
}

// ----- summaries -------------------------------------------------------------

export async function latestSummary(videoId: string): Promise<SummaryRow | null> {
  const client = await getDb();
  try {
    const { rows } = await client.query<SummaryDbRow>(
      'SELECT * FROM summaries WHERE video_id = $1 ORDER BY created_at DESC LIMIT 1',
      [videoId],
    );
    return rows[0] ? hydrateSummary(rows[0]) : null;
  } finally {
    client.release();
  }
}

/**
 * Batch-fetch the latest summary for each video id in a set. Returns a map of
 * video_id → SummaryRow. Videos without a cached summary are absent from the
 * map. Used by the playlist synthesizer (TAV-26) to gather per-video TL;DRs.
 */
export async function latestSummariesByVideoIds(videoIds: string[]): Promise<Map<string, SummaryRow>> {
  const out = new Map<string, SummaryRow>();
  if (videoIds.length === 0) return out;
  const client = await getDb();
  try {
    const placeholders = videoIds.map((_, i) => `$${i + 1}`).join(',');
    const { rows } = await client.query<SummaryDbRow>(
      `SELECT DISTINCT ON (video_id) * FROM summaries
       WHERE video_id IN (${placeholders})
       ORDER BY video_id, created_at DESC`,
      videoIds,
    );
    for (const row of rows) {
      out.set(row.video_id, hydrateSummary(row));
    }
    return out;
  } finally {
    client.release();
  }
}

export async function saveSummary(input: {
  video_id: string;
  model: string;
  tldr: string;
  key_points: string[];
  follow_ups: FollowUp[];
  topics: string[];
  prompt: string;
  token_count: number | null;
}): Promise<SummaryRow> {
  const client = await getDb();
  try {
    const now = Math.floor(Date.now() / 1000);
    const id = newId();
    const payload = {
      id,
      video_id: input.video_id,
      model: input.model,
      tldr: input.tldr,
      key_points: JSON.stringify(input.key_points),
      follow_ups: JSON.stringify(input.follow_ups),
      topics: JSON.stringify(input.topics),
      prompt: input.prompt,
      token_count: input.token_count,
      created_at: now,
    };

    await client.query(
      `INSERT INTO summaries (id, video_id, model, tldr, key_points, follow_ups, topics, prompt, token_count, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (video_id, model) DO UPDATE SET
        id=excluded.id,
        tldr=excluded.tldr,
        key_points=excluded.key_points,
        follow_ups=excluded.follow_ups,
        topics=excluded.topics,
        prompt=excluded.prompt,
        token_count=excluded.token_count,
        created_at=excluded.created_at`,
      [payload.id, payload.video_id, payload.model, payload.tldr, payload.key_points, payload.follow_ups, payload.topics, payload.prompt, payload.token_count, payload.created_at],
    );

    return hydrateSummary({
      id: payload.id,
      video_id: payload.video_id,
      model: payload.model,
      tldr: payload.tldr,
      key_points: payload.key_points,
      follow_ups: payload.follow_ups,
      topics: payload.topics,
      prompt: payload.prompt,
      token_count: payload.token_count,
      created_at: payload.created_at,
      bookmarked: 0,
    });
  } finally {
    client.release();
  }
}

export function currentSummaryModel(): string {
  return SUMMARY_MODEL_KEY;
}

// ----- TAV-12: bookmarked summaries ------------------------------------------

/**
 * Flip the bookmark flag on a video's latest summary. Returns the new state
 * (1 = bookmarked, 0 = not) or null if the video has no summary to bookmark.
 */
export async function toggleBookmark(videoId: string): Promise<0 | 1 | null> {
  const client = await getDb();
  try {
    // Find the latest summary for this video.
    const { rows } = await client.query<SummaryDbRow>(
      'SELECT id, bookmarked FROM summaries WHERE video_id = $1 ORDER BY created_at DESC LIMIT 1',
      [videoId],
    );
    if (rows.length === 0) return null;
    const current = rows[0].bookmarked === 1 ? 1 : 0;
    const next: 0 | 1 = current === 1 ? 0 : 1;
    await client.query('UPDATE summaries SET bookmarked = $1 WHERE id = $2', [next, rows[0].id]);
    return next;
  } finally {
    client.release();
  }
}

/**
 * A bookmarked summary joined with its video and channel, for the /saved page.
 */
export interface BookmarkedSummary {
  summary: SummaryRow;
  video: Pick<VideoRow, 'video_id' | 'title' | 'thumbnail_url' | 'channel_id' | 'published_at' | 'duration_seconds'>;
  channelTitle: string;
}

/**
 * List all bookmarked summaries, most recently bookmarked first. We sort by
 * created_at (the summary row's created_at doubles as the bookmark timestamp
 * for the v1 simple boolean flag — there is no separate bookmarked_at column).
 */
export async function listBookmarkedSummaries(): Promise<BookmarkedSummary[]> {
  const client = await getDb();
  try {
    const { rows } = await client.query<{
      // summary fields
      id: string;
      video_id: string;
      model: string;
      tldr: string;
      key_points: string;
      follow_ups: string;
      topics: string | null;
      prompt: string;
      token_count: number | null;
      created_at: number;
      bookmarked: number;
      // video fields
      v_title: string;
      v_thumb: string | null;
      v_channel_id: string;
      v_published_at: number | null;
      v_duration: number | null;
      // channel field
      c_title: string;
    }>(
      `SELECT
         s.id, s.video_id, s.model, s.tldr, s.key_points, s.follow_ups,
         s.topics, s.prompt, s.token_count, s.created_at, s.bookmarked,
         v.title        AS v_title,
         v.thumbnail_url AS v_thumb,
         v.channel_id    AS v_channel_id,
         v.published_at  AS v_published_at,
         v.duration_seconds AS v_duration,
         c.title         AS c_title
       FROM summaries s
       JOIN videos  v ON v.video_id = s.video_id
       JOIN channels c ON c.channel_id = v.channel_id
       WHERE s.bookmarked = 1
       ORDER BY s.created_at DESC`,
    );

    return rows.map(r => {
      const summary = hydrateSummary({
        id: r.id,
        video_id: r.video_id,
        model: r.model,
        tldr: r.tldr,
        key_points: r.key_points,
        follow_ups: r.follow_ups,
        topics: r.topics,
        prompt: r.prompt,
        token_count: r.token_count,
        created_at: r.created_at,
        bookmarked: r.bookmarked,
      });
      return {
        summary,
        video: {
          video_id: r.video_id,
          title: r.v_title,
          thumbnail_url: r.v_thumb,
          channel_id: r.v_channel_id,
          published_at: r.v_published_at,
          duration_seconds: r.v_duration,
        },
        channelTitle: r.c_title,
      };
    });
  } finally {
    client.release();
  }
}

/**
 * TAV-27: load a single bookmarked summary by video id, joined with its video
 * + channel. Used by the read-later export actions so we can build the export
 * payload for one summary without pulling every bookmark. Returns null when
 * the video has no bookmarked summary.
 */
export async function getBookmarkedSummary(videoId: string): Promise<BookmarkedSummary | null> {
  const client = await getDb();
  try {
    const { rows } = await client.query<{
      id: string;
      video_id: string;
      model: string;
      tldr: string;
      key_points: string;
      follow_ups: string;
      topics: string | null;
      prompt: string;
      token_count: number | null;
      created_at: number;
      bookmarked: number;
      v_title: string;
      v_thumb: string | null;
      v_channel_id: string;
      v_published_at: number | null;
      v_duration: number | null;
      c_title: string;
    }>(
      `SELECT
         s.id, s.video_id, s.model, s.tldr, s.key_points, s.follow_ups,
         s.topics, s.prompt, s.token_count, s.created_at, s.bookmarked,
         v.title        AS v_title,
         v.thumbnail_url AS v_thumb,
         v.channel_id    AS v_channel_id,
         v.published_at  AS v_published_at,
         v.duration_seconds AS v_duration,
         c.title         AS c_title
       FROM summaries s
       JOIN videos  v ON v.video_id = s.video_id
       JOIN channels c ON c.channel_id = v.channel_id
       WHERE s.bookmarked = 1 AND s.video_id = $1
       ORDER BY s.created_at DESC
       LIMIT 1`,
      [videoId],
    );
    if (rows.length === 0) return null;
    const r = rows[0];
    const summary = hydrateSummary({
      id: r.id,
      video_id: r.video_id,
      model: r.model,
      tldr: r.tldr,
      key_points: r.key_points,
      follow_ups: r.follow_ups,
      topics: r.topics,
      prompt: r.prompt,
      token_count: r.token_count,
      created_at: r.created_at,
      bookmarked: r.bookmarked,
    });
    return {
      summary,
      video: {
        video_id: r.video_id,
        title: r.v_title,
        thumbnail_url: r.v_thumb,
        channel_id: r.v_channel_id,
        published_at: r.v_published_at,
        duration_seconds: r.v_duration,
      },
      channelTitle: r.c_title,
    };
  } finally {
    client.release();
  }
}

// ----- TAV-31: all summarized videos -----------------------------------------

/**
 * A summarized video joined with its latest summary + channel, for the
 * /summarized page. Mirrors BookmarkedSummary but without the bookmark filter.
 */
export interface SummarizedVideo {
  summary: SummaryRow;
  video: Pick<VideoRow, 'video_id' | 'title' | 'thumbnail_url' | 'channel_id' | 'published_at' | 'duration_seconds'>;
  channelTitle: string;
}

/**
 * List every video that has at least one cached summary, most recently
 * summarized first. A subquery picks the latest summary per video (DISTINCT ON
 * requires ORDER BY to begin with the DISTINCT column), and the outer query
 * re-sorts by summary recency.
 */
export async function listSummarizedVideos(limit = 500): Promise<SummarizedVideo[]> {
  const client = await getDb();
  try {
    const { rows } = await client.query<{
      id: string;
      video_id: string;
      model: string;
      tldr: string;
      key_points: string;
      follow_ups: string;
      topics: string | null;
      prompt: string;
      token_count: number | null;
      created_at: number;
      bookmarked: number;
      v_title: string;
      v_thumb: string | null;
      v_channel_id: string;
      v_published_at: number | null;
      v_duration: number | null;
      c_title: string;
    }>(
      `SELECT * FROM (
         SELECT DISTINCT ON (s.video_id)
           s.id, s.video_id, s.model, s.tldr, s.key_points, s.follow_ups,
           s.topics, s.prompt, s.token_count, s.created_at, s.bookmarked,
           v.title           AS v_title,
           v.thumbnail_url   AS v_thumb,
           v.channel_id      AS v_channel_id,
           v.published_at    AS v_published_at,
           v.duration_seconds AS v_duration,
           c.title           AS c_title
         FROM summaries s
         JOIN videos  v ON v.video_id = s.video_id
         JOIN channels c ON c.channel_id = v.channel_id
         ORDER BY s.video_id, s.created_at DESC
       ) latest
       ORDER BY latest.created_at DESC
       LIMIT $1`,
      [limit],
    );

    return rows.map(r => {
      const summary = hydrateSummary({
        id: r.id,
        video_id: r.video_id,
        model: r.model,
        tldr: r.tldr,
        key_points: r.key_points,
        follow_ups: r.follow_ups,
        topics: r.topics,
        prompt: r.prompt,
        token_count: r.token_count,
        created_at: r.created_at,
        bookmarked: r.bookmarked,
      });
      return {
        summary,
        video: {
          video_id: r.video_id,
          title: r.v_title,
          thumbnail_url: r.v_thumb,
          channel_id: r.v_channel_id,
          published_at: r.v_published_at,
          duration_seconds: r.v_duration,
        },
        channelTitle: r.c_title,
      };
    });
  } finally {
    client.release();
  }
}

/** Count of distinct videos with at least one cached summary — for the sidebar badge. */
export async function countSummarizedVideos(): Promise<number> {
  const client = await getDb();
  try {
    const { rows } = await client.query<{ n: string }>('SELECT COUNT(DISTINCT video_id) AS n FROM summaries');
    return Number(rows[0]?.n ?? 0);
  } finally {
    client.release();
  }
}

// ----- TAV-5: chat message persistence ---------------------------------------

export async function saveChatMessage(input: {
  video_id: string;
  role: 'user' | 'assistant';
  content: string;
}): Promise<ChatMessage> {
  const client = await getDb();
  try {
    const now = Math.floor(Date.now() / 1000);
    const id = newId();
    await client.query(
      'INSERT INTO chat_messages (id, video_id, role, content, created_at) VALUES ($1, $2, $3, $4, $5)',
      [id, input.video_id, input.role, input.content, now],
    );
    return { id, video_id: input.video_id, role: input.role, content: input.content, created_at: now };
  } finally {
    client.release();
  }
}

export async function listChatMessages(videoId: string, limit = 50): Promise<ChatMessage[]> {
  const client = await getDb();
  try {
    const { rows } = await client.query(
      'SELECT * FROM chat_messages WHERE video_id = $1 ORDER BY created_at ASC, id ASC LIMIT $2',
      [videoId, limit],
    );
    return rows.map((r: { id: string; video_id: string; role: string; content: string; created_at: number }) => ({
      id: r.id,
      video_id: r.video_id,
      role: r.role as 'user' | 'assistant',
      content: r.content,
      created_at: r.created_at,
    }));
  } finally {
    client.release();
  }
}

// ----- TAV-13: AI chapter persistence ----------------------------------------

export async function saveChapters(input: {
  video_id: string;
  chapters: Chapter[];
  model: string;
  token_count: number | null;
}): Promise<Chapter[]> {
  const client = await getDb();
  try {
    const now = Math.floor(Date.now() / 1000);
    const chaptersJson = JSON.stringify(input.chapters);
    await client.query(
      `INSERT INTO video_chapters (video_id, chapters, model, token_count, created_at)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (video_id) DO UPDATE SET
        chapters = excluded.chapters,
        model = excluded.model,
        token_count = excluded.token_count,
        created_at = excluded.created_at`,
      [input.video_id, chaptersJson, input.model, input.token_count, now],
    );
    return input.chapters;
  } finally {
    client.release();
  }
}

export async function getChapters(videoId: string): Promise<Chapter[] | null> {
  const client = await getDb();
  try {
    const { rows } = await client.query<{ chapters: string }>(
      'SELECT chapters FROM video_chapters WHERE video_id = $1',
      [videoId],
    );
    if (rows.length === 0) return null;
    try {
      return JSON.parse(rows[0].chapters) as Chapter[];
    } catch {
      return null;
    }
  } finally {
    client.release();
  }
}

// ----- TAV-14: digest video hydration ----------------------------------------

/**
 * Hydrate the video + channel + summary-presence details for a list of video
 * ids, as needed by the /digests page. Returns rows sorted by published_at desc.
 */
export async function listDigestVideos(videoIds: string[]): Promise<import('./types').DigestVideoEntry[]> {
  if (videoIds.length === 0) return [];
  const client = await getDb();
  try {
    const placeholders = videoIds.map((_, i) => `$${i + 1}`).join(',');
    const { rows } = await client.query<{
      video_id: string;
      title: string;
      thumbnail_url: string | null;
      duration_seconds: number | null;
      published_at: number | null;
      channel_id: string;
      channel_title: string;
      summary_count: string;
    }>(
      `SELECT
         v.video_id,
         v.title,
         v.thumbnail_url,
         v.duration_seconds,
         v.published_at,
         v.channel_id,
         c.title AS channel_title,
         (SELECT COUNT(*) FROM summaries s WHERE s.video_id = v.video_id) AS summary_count
       FROM videos v
       JOIN channels c ON c.channel_id = v.channel_id
       WHERE v.video_id IN (${placeholders})
       ORDER BY v.published_at DESC NULLS LAST`,
      videoIds,
    );
    return rows.map(r => ({
      video_id: r.video_id,
      title: r.title,
      thumbnail_url: r.thumbnail_url,
      duration_seconds: r.duration_seconds,
      published_at: r.published_at,
      channel_id: r.channel_id,
      channel_title: r.channel_title,
      has_summary: Number(r.summary_count) > 0,
    }));
  } finally {
    client.release();
  }
}

// ----- TAV-20: Community Pulse — comment persistence -------------------------

/**
 * Upsert fetched top-level comments for a video. The `comments` array is stored
 * as JSON. Re-fetching replaces the whole set — comments move around as likes
 * accrue, so a snapshot is more useful than a diff.
 */
export async function upsertVideoComments(
  videoId: string,
  comments: VideoComment[],
): Promise<void> {
  const client = await getDb();
  try {
    const now = Math.floor(Date.now() / 1000);
    await client.query(
      `INSERT INTO video_comments (video_id, comments, fetched_at, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (video_id) DO UPDATE SET
        comments = excluded.comments,
        fetched_at = excluded.fetched_at,
        updated_at = excluded.updated_at`,
      [videoId, JSON.stringify(comments), now, now, now],
    );
  } finally {
    client.release();
  }
}

/**
 * Persist the LLM-generated community summary for a video. Called after the
 * comments are upserted; updates the summary fields in place.
 */
export async function setCommentSummary(
  videoId: string,
  summary: string,
  model: string,
): Promise<void> {
  const client = await getDb();
  try {
    const now = Math.floor(Date.now() / 1000);
    await client.query(
      `UPDATE video_comments SET summary = $1, summary_model = $2, updated_at = $3 WHERE video_id = $4`,
      [summary, model, now, videoId],
    );
  } finally {
    client.release();
  }
}

/** Fetch a video's community pulse row, or null when comments haven't been fetched yet. */
export async function getCommunityPulse(videoId: string): Promise<CommunityPulse | null> {
  const client = await getDb();
  try {
    const { rows } = await client.query<{
      video_id: string;
      comments: string;
      fetched_at: number;
      summary: string | null;
      summary_model: string | null;
    }>('SELECT video_id, comments, fetched_at, summary, summary_model FROM video_comments WHERE video_id = $1', [videoId]);
    if (rows.length === 0) return null;
    const row = rows[0];
    let comments: VideoComment[] = [];
    try { comments = JSON.parse(row.comments) as VideoComment[]; } catch { /* keep default */ }
    return {
      video_id: row.video_id,
      comments,
      summary: row.summary,
      summary_model: row.summary_model,
      fetched_at: row.fetched_at,
    };
  } finally {
    client.release();
  }
}

// ----- TAV-29: Video reference graph — cross-video citations ------------------

/**
 * Persist a video's outgoing reference edges from its summary's `follow_ups`.
 * Re-summarizing a video replaces its outgoing edges (delete-then-insert by
 * source_video_id) so the graph always reflects the latest summary. Each
 * follow-up with a valid 11-char YouTube video id becomes a 'video' edge;
 * follow-ups without a recognizable video id are skipped (they are external
 * links or references to channels without a concrete video).
 */
export async function persistVideoReferences(sourceVideoId: string, followUps: FollowUp[]): Promise<void> {
  // Filter to follow-ups whose video_id looks like a YouTube video id
  // (11 chars, base64-url alphabet). This matches what the LLM is prompted to
  // produce and avoids storing junk edges.
  const edges = followUps
    .filter(f => /^[A-Za-z0-9_-]{11}$/.test(f.video_id))
    .filter(f => f.video_id !== sourceVideoId); // no self-edges

  const client = await getDb();
  try {
    const now = Math.floor(Date.now() / 1000);
    // Replace strategy: delete existing outgoing edges, then insert fresh ones.
    await client.query('DELETE FROM video_references WHERE source_video_id = $1', [sourceVideoId]);
    for (const f of edges) {
      await client.query(
        `INSERT INTO video_references (id, source_video_id, target_video_id, target_channel_id, reference_type, context, created_at)
         VALUES ($1, $2, $3, NULL, 'video', $4, $5)`,
        [newId(), sourceVideoId, f.video_id, f.reason, now],
      );
    }
  } finally {
    client.release();
  }
}

/**
 * Outgoing reference edges for a video (videos this video's summary cited),
 * hydrated with target video + channel titles for display.
 */
export async function getOutgoingReferences(sourceVideoId: string): Promise<VideoReferenceWithTarget[]> {
  const client = await getDb();
  try {
    const { rows } = await client.query<{
      id: string;
      source_video_id: string;
      target_video_id: string | null;
      target_channel_id: string | null;
      reference_type: string;
      context: string | null;
      created_at: number;
      target_video_title: string | null;
      target_video_thumbnail: string | null;
      target_channel_title: string | null;
    }>(
      `SELECT r.id, r.source_video_id, r.target_video_id, r.target_channel_id,
              r.reference_type, r.context, r.created_at,
              v.title AS target_video_title, v.thumbnail_url AS target_video_thumbnail,
              c.title AS target_channel_title
       FROM video_references r
       LEFT JOIN videos v ON v.video_id = r.target_video_id
       LEFT JOIN channels c ON c.channel_id = v.channel_id
       WHERE r.source_video_id = $1
       ORDER BY r.created_at DESC`,
      [sourceVideoId],
    );
    return rows.map(r => ({
      id: r.id,
      source_video_id: r.source_video_id,
      target_video_id: r.target_video_id,
      target_channel_id: r.target_channel_id,
      reference_type: r.reference_type as ReferenceType,
      context: r.context,
      created_at: r.created_at,
      target_video_title: r.target_video_title,
      target_video_thumbnail: r.target_video_thumbnail,
      target_channel_title: r.target_channel_title,
    }));
  } finally {
    client.release();
  }
}

/**
 * Incoming reference edges for a video (videos whose summaries cited this
 * video), hydrated with source video + channel titles for display.
 */
export async function getIncomingReferences(targetVideoId: string): Promise<VideoReferenceWithTarget[]> {
  const client = await getDb();
  try {
    const { rows } = await client.query<{
      id: string;
      source_video_id: string;
      target_video_id: string | null;
      target_channel_id: string | null;
      reference_type: string;
      context: string | null;
      created_at: number;
      target_video_title: string | null;
      target_video_thumbnail: string | null;
      target_channel_title: string | null;
    }>(
      `SELECT r.id, r.source_video_id, r.target_video_id, r.target_channel_id,
              r.reference_type, r.context, r.created_at,
              v.title AS target_video_title, v.thumbnail_url AS target_video_thumbnail,
              c.title AS target_channel_title
       FROM video_references r
       JOIN videos v ON v.video_id = r.source_video_id
       JOIN channels c ON c.channel_id = v.channel_id
       WHERE r.target_video_id = $1
       ORDER BY r.created_at DESC`,
      [targetVideoId],
    );
    // For incoming refs, the "target" fields we hydrated are actually the
    // *source* video's info (we joined on source_video_id). Rename so the
    // caller can use the same shape: target_* now describes the source video.
    return rows.map(r => ({
      id: r.id,
      source_video_id: r.source_video_id,
      target_video_id: r.target_video_id,
      target_channel_id: r.target_channel_id,
      reference_type: r.reference_type as ReferenceType,
      context: r.context,
      created_at: r.created_at,
      target_video_title: r.target_video_title,
      target_video_thumbnail: r.target_video_thumbnail,
      target_channel_title: r.target_channel_title,
    }));
  } finally {
    client.release();
  }
}

/**
 * The most-referenced videos across a channel's subscriptions (TAV-29).
 * Counts how many distinct source videos (from channels the user subscribes
 * to) cite each target video. Only counts edges where the source video's
 * channel is subscribed — so the graph reflects the user's own subscription
 * graph, not the whole internet.
 */
export async function getMostReferencedVideos(limit = 10): Promise<MostReferencedVideo[]> {
  const client = await getDb();
  try {
    const { rows } = await client.query<{
      video_id: string;
      title: string;
      thumbnail_url: string | null;
      channel_id: string;
      channel_title: string;
      reference_count: number;
    }>(
      `SELECT r.target_video_id AS video_id,
              v.title AS title,
              v.thumbnail_url AS thumbnail_url,
              v.channel_id AS channel_id,
              c.title AS channel_title,
              COUNT(DISTINCT r.source_video_id) AS reference_count
       FROM video_references r
       JOIN videos v ON v.video_id = r.target_video_id
       JOIN channels c ON c.channel_id = v.channel_id
       JOIN videos sv ON sv.video_id = r.source_video_id
       JOIN channels sc ON sc.channel_id = sv.channel_id
       WHERE r.target_video_id IS NOT NULL
         AND sc.subscribed_at IS NOT NULL
       GROUP BY r.target_video_id, v.title, v.thumbnail_url, v.channel_id, c.title
       ORDER BY reference_count DESC, v.published_at DESC
       LIMIT $1`,
      [limit],
    );
    return rows.map(r => ({
      video_id: r.video_id,
      title: r.title,
      thumbnail_url: r.thumbnail_url,
      channel_id: r.channel_id,
      channel_title: r.channel_title,
      reference_count: Number(r.reference_count),
    }));
  } finally {
    client.release();
  }
}

// ----- internals -------------------------------------------------------------

interface SummaryDbRow {
  id: string;
  video_id: string;
  model: string;
  tldr: string;
  key_points: string;
  follow_ups: string;
  topics: string | null;
  prompt: string;
  token_count: number | null;
  created_at: number;
  bookmarked?: number | null;
}

function hydrateSummary(row: SummaryDbRow): SummaryRow {
  let keyPoints: string[] = [];
  let followUps: FollowUp[] = [];
  let topics: string[] = [];
  try { keyPoints = JSON.parse(row.key_points) as string[]; } catch { /* keep default */ }
  try { followUps = JSON.parse(row.follow_ups) as FollowUp[]; } catch { /* keep default */ }
  if (row.topics) {
    try { topics = JSON.parse(row.topics) as string[]; } catch { /* keep default */ }
  }
  return {
    id: row.id,
    video_id: row.video_id,
    model: row.model,
    tldr: row.tldr,
    key_points: keyPoints,
    follow_ups: followUps,
    topics,
    prompt: row.prompt,
    token_count: row.token_count,
    created_at: row.created_at,
    bookmarked: row.bookmarked === 1 ? 1 : 0,
  };
}
