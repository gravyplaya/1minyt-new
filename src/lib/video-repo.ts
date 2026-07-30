/**
 * Data access for videos + summaries (TAV-4).
 *
 * Keeps the caching contract simple:
 *  - `upsertVideo` inserts/updates a video row (recent uploads from YouTube).
 *  - `setTranscript` stores a fetched transcript and flips the status.
 *  - `getVideo` / `listVideosByChannel` hydrate the latest summary for each row.
 *  - `saveSummary` upserts a summary keyed by (video_id, model) so re-summarizing
 *    with a different model doesn't clobber the prior result.
 */

import { getDb } from './db';
import { newId } from './id';
import type { ChatMessage, FollowUp, SummaryRow, TranscriptStatus, VideoRow, VideoWithSummary } from './types';

const SUMMARY_MODEL_KEY = process.env.SUMMARY_MODEL?.trim() || 'openai/gpt-oss-20b:free';

export function upsertVideo(input: Omit<VideoRow, 'transcript' | 'transcript_status' | 'transcript_fetched_at' | 'created_at' | 'updated_at'> & {
  transcript?: string | null;
  transcript_status?: TranscriptStatus;
  transcript_fetched_at?: number | null;
}): void {
  const db = getDb();
  const now = Math.floor(Date.now() / 1000);
  const existing = db.prepare('SELECT video_id FROM videos WHERE video_id = ?').get(input.video_id);
  if (existing) {
    db.prepare(`
      UPDATE videos SET
        channel_id=@channel_id, title=@title, description=@description,
        thumbnail_url=@thumbnail_url, duration_seconds=@duration_seconds,
        published_at=@published_at,
        transcript=COALESCE(@transcript, transcript),
        transcript_status=COALESCE(@transcript_status, transcript_status),
        transcript_fetched_at=COALESCE(@transcript_fetched_at, transcript_fetched_at),
        updated_at=@updated_at
      WHERE video_id=@video_id
    `).run({
      ...input,
      transcript: input.transcript ?? null,
      transcript_status: input.transcript_status ?? null,
      transcript_fetched_at: input.transcript_fetched_at ?? null,
      updated_at: now,
    });
    return;
  }
  db.prepare(`
    INSERT INTO videos (
      video_id, channel_id, title, description, thumbnail_url,
      duration_seconds, published_at,
      transcript, transcript_status, transcript_fetched_at,
      created_at, updated_at
    ) VALUES (
      @video_id, @channel_id, @title, @description, @thumbnail_url,
      @duration_seconds, @published_at,
      @transcript, @transcript_status, @transcript_fetched_at,
      @created_at, @updated_at
    )
  `).run({
    ...input,
    transcript: input.transcript ?? null,
    transcript_status: input.transcript_status ?? 'pending',
    transcript_fetched_at: input.transcript_fetched_at ?? null,
    created_at: now,
    updated_at: now,
  });
}

export function setTranscript(videoId: string, text: string): void {
  const now = Math.floor(Date.now() / 1000);
  getDb().prepare(`
    UPDATE videos
       SET transcript = ?, transcript_status = 'fetched', transcript_fetched_at = ?, updated_at = ?
     WHERE video_id = ?
  `).run(text, now, now, videoId);
}

export function setTranscriptStatus(videoId: string, status: TranscriptStatus): void {
  const now = Math.floor(Date.now() / 1000);
  getDb().prepare(`
    UPDATE videos SET transcript_status = ?, updated_at = ? WHERE video_id = ?
  `).run(status, now, videoId);
}

export function getVideo(videoId: string): VideoRow | null {
  const row = getDb().prepare('SELECT * FROM videos WHERE video_id = ?').get(videoId) as VideoRow | undefined;
  return row ?? null;
}

export function listVideosByChannel(channelId: string, limit = 30): VideoWithSummary[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT * FROM videos WHERE channel_id = ? ORDER BY published_at DESC LIMIT ?
  `).all(channelId, limit) as VideoRow[];
  if (rows.length === 0) return [];
  return rows.map(row => ({ ...row, summary: latestSummary(row.video_id) }));
}

export function listRecentUploadIds(channelId: string, limit = 12): { video_id: string; title: string }[] {
  return getDb().prepare(`
    SELECT video_id, title FROM videos WHERE channel_id = ? ORDER BY published_at DESC LIMIT ?
  `).all(channelId, limit) as { video_id: string; title: string }[];
}

// ----- summaries -------------------------------------------------------------

export function latestSummary(videoId: string): SummaryRow | null {
  const row = getDb().prepare(`
    SELECT * FROM summaries WHERE video_id = ? ORDER BY created_at DESC LIMIT 1
  `).get(videoId) as SummaryDbRow | undefined;
  return row ? hydrateSummary(row) : null;
}

export function saveSummary(input: {
  video_id: string;
  model: string;
  tldr: string;
  key_points: string[];
  follow_ups: FollowUp[];
  prompt: string;
  token_count: number | null;
}): SummaryRow {
  const db = getDb();
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    id: newId(),
    video_id: input.video_id,
    model: input.model,
    tldr: input.tldr,
    key_points: JSON.stringify(input.key_points),
    follow_ups: JSON.stringify(input.follow_ups),
    prompt: input.prompt,
    token_count: input.token_count,
    created_at: now,
  };

  // Upsert keyed by (video_id, model). Re-summarizing replaces the prior result
  // for that model; a different model adds a new row (the UI shows the latest).
  db.prepare(`
    INSERT INTO summaries (id, video_id, model, tldr, key_points, follow_ups, prompt, token_count, created_at)
    VALUES (@id, @video_id, @model, @tldr, @key_points, @follow_ups, @prompt, @token_count, @created_at)
    ON CONFLICT(video_id, model) DO UPDATE SET
      id=excluded.id,
      tldr=excluded.tldr,
      key_points=excluded.key_points,
      follow_ups=excluded.follow_ups,
      prompt=excluded.prompt,
      token_count=excluded.token_count,
      created_at=excluded.created_at
  `).run(payload);

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
}

export function currentSummaryModel(): string {
  return SUMMARY_MODEL_KEY;
}

// ----- TAV-5: chat message persistence ---------------------------------------

export function saveChatMessage(input: {
  video_id: string;
  role: 'user' | 'assistant';
  content: string;
}): ChatMessage {
  const db = getDb();
  const now = Math.floor(Date.now() / 1000);
  const id = newId();
  db.prepare(`
    INSERT INTO chat_messages (id, video_id, role, content, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, input.video_id, input.role, input.content, now);
  return {
    id,
    video_id: input.video_id,
    role: input.role,
    content: input.content,
    created_at: now,
  };
}

export function listChatMessages(videoId: string, limit = 50): ChatMessage[] {
  const rows = getDb().prepare(`
    SELECT * FROM chat_messages WHERE video_id = ? ORDER BY created_at ASC, id ASC LIMIT ?
  `).all(videoId, limit) as Array<{ id: string; video_id: string; role: string; content: string; created_at: number }>;
  return rows.map(r => ({
    id: r.id,
    video_id: r.video_id,
    role: r.role as 'user' | 'assistant',
    content: r.content,
    created_at: r.created_at,
  }));
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
