/**
 * Data access for videos + summaries (TAV-4) + chat messages (TAV-5).
 *
 * All functions are async — backed by PostgreSQL.
 */

import { getDb } from './db';
import { newId } from './id';
import type { ChatMessage, FollowUp, SummaryRow, TranscriptStatus, VideoRow, VideoWithSummary } from './types';

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
    return rows.map(row => ({ ...row, summary: summaryMap.get(row.video_id) ?? null }));
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
      prompt: input.prompt,
      token_count: input.token_count,
      created_at: now,
    };

    await client.query(
      `INSERT INTO summaries (id, video_id, model, tldr, key_points, follow_ups, prompt, token_count, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (video_id, model) DO UPDATE SET
        id=excluded.id,
        tldr=excluded.tldr,
        key_points=excluded.key_points,
        follow_ups=excluded.follow_ups,
        prompt=excluded.prompt,
        token_count=excluded.token_count,
        created_at=excluded.created_at`,
      [payload.id, payload.video_id, payload.model, payload.tldr, payload.key_points, payload.follow_ups, payload.prompt, payload.token_count, payload.created_at],
    );

    return hydrateSummary({
      id: payload.id,
      video_id: payload.video_id,
      model: payload.model,
      tldr: payload.tldr,
      key_points: payload.key_points,
      follow_ups: payload.follow_ups,
      prompt: payload.prompt,
      token_count: payload.token_count,
      created_at: payload.created_at,
    });
  } finally {
    client.release();
  }
}

export function currentSummaryModel(): string {
  return SUMMARY_MODEL_KEY;
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

// ----- internals -------------------------------------------------------------

interface SummaryDbRow {
  id: string;
  video_id: string;
  model: string;
  tldr: string;
  key_points: string;
  follow_ups: string;
  prompt: string;
  token_count: number | null;
  created_at: number;
}

function hydrateSummary(row: SummaryDbRow): SummaryRow {
  let keyPoints: string[] = [];
  let followUps: FollowUp[] = [];
  try { keyPoints = JSON.parse(row.key_points) as string[]; } catch { /* keep default */ }
  try { followUps = JSON.parse(row.follow_ups) as FollowUp[]; } catch { /* keep default */ }
  return {
    id: row.id,
    video_id: row.video_id,
    model: row.model,
    tldr: row.tldr,
    key_points: keyPoints,
    follow_ups: followUps,
    prompt: row.prompt,
    token_count: row.token_count,
    created_at: row.created_at,
  };
}
