/**
 * Data access for videos + summaries (TAV-4) + chat messages (TAV-5).
 *
 * All functions are async — backed by PostgreSQL.
 */

import { getDb } from './db';
import { newId } from './id';
import type { Chapter, ChatMessage, FollowUp, SummaryRow, TranscriptStatus, VideoRow, VideoWithSummary } from './types';

const SUMMARY_MODEL_KEY = process.env.SUMMARY_MODEL?.trim() || 'openai/gpt-oss-20b:free';

export async function upsertVideo(input: Omit<VideoRow, 'transcript' | 'transcript_status' | 'transcript_fetched_at' | 'created_at' | 'updated_at'> & {
  transcript?: string | null;
  transcript_status?: TranscriptStatus;
  transcript_fetched_at?: number | null;
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
          updated_at=$11
        WHERE video_id=$1`,
        [
          input.video_id, input.channel_id, input.title, input.description,
          input.thumbnail_url, input.duration_seconds,
          input.published_at,
          input.transcript ?? null,
          input.transcript_status ?? null,
          input.transcript_fetched_at ?? null,
          now,
        ],
      );
      return;
    }
    await client.query(
      `INSERT INTO videos (
        video_id, channel_id, title, description, thumbnail_url,
        duration_seconds, published_at,
        transcript, transcript_status, transcript_fetched_at,
        created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5,
        $6, $7,
        $8, $9, $10,
        $11, $12
      )`,
      [
        input.video_id, input.channel_id, input.title, input.description,
        input.thumbnail_url, input.duration_seconds,
        input.published_at,
        input.transcript ?? null,
        input.transcript_status ?? 'pending',
        input.transcript_fetched_at ?? null,
        now, now,
      ],
    );
  } finally {
    client.release();
  }
}

export async function setTranscript(videoId: string, text: string): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const client = await getDb();
  try {
    await client.query(
      `UPDATE videos SET transcript = $1, transcript_status = 'fetched', transcript_fetched_at = $2, updated_at = $3 WHERE video_id = $4`,
      [text, now, now, videoId],
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

    return rows.map(row => ({
      ...row,
      summary: summaryMap.get(row.video_id) ?? null,
      chapters: chapterMap.get(row.video_id) ?? null,
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
