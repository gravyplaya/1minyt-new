/**
 * TAV-23: Summarize Later queue — Pocket-style "save for later summarization".
 *
 * A dedicated queue of videos the user wants summarized, with a batch
 * "summarize all" action. Each row tracks state:
 *   - 'queued'      — waiting to be summarized
 *   - 'summarized'  — the batch run processed it (kept with a badge, not deleted,
 *                     so the user can review what was summarized)
 *
 * Re-queuing an already-summarized video flips it back to 'queued' so the
 * user can re-run the batch. Removing from the queue deletes the row.
 */

import { getDb } from './db';
import { newId } from './id';
import type { QueueState, SummarizeQueueItem } from './types';

/**
 * Add a video to the Summarize Later queue. If the video is already queued
 * (in any state), reset it to 'queued' and bump queued_at — this makes the
 * action idempotent and lets users re-queue a summarized video for a re-run.
 */
export async function enqueueForSummary(videoId: string): Promise<void> {
  const client = await getDb();
  try {
    const now = Math.floor(Date.now() / 1000);
    const id = newId();
    await client.query(
      `INSERT INTO summarize_queue (id, video_id, state, queued_at, summarized_at, created_at)
       VALUES ($1, $2, 'queued', $3, NULL, $3)
       ON CONFLICT (video_id) DO UPDATE SET
        state = 'queued',
        queued_at = excluded.queued_at,
        summarized_at = NULL`,
      [id, videoId, now],
    );
  } finally {
    client.release();
  }
}

/**
 * Remove a video from the Summarize Later queue entirely. Called when the
 * user explicitly removes an item (distinct from "summarized", which keeps
 * the row with a badge).
 */
export async function removeFromQueue(videoId: string): Promise<void> {
  const client = await getDb();
  try {
    await client.query('DELETE FROM summarize_queue WHERE video_id = $1', [videoId]);
  } finally {
    client.release();
  }
}

/**
 * Mark a queue item as 'summarized'. Called after the batch run successfully
 * generates a summary for the video. Keeps the row so the user sees what was
 * processed; `summarized_at` is the completion timestamp.
 */
export async function markQueueItemSummarized(videoId: string): Promise<void> {
  const client = await getDb();
  try {
    const now = Math.floor(Date.now() / 1000);
    await client.query(
      `UPDATE summarize_queue SET state = 'summarized', summarized_at = $1 WHERE video_id = $2`,
      [now, videoId],
    );
  } finally {
    client.release();
  }
}

/**
 * List all Summarize Later queue items, optionally filtered by state.
 * Queued items first (newest first), then summarized items (most recently
 * summarized first). Each row is joined with video + channel details.
 */
export async function listQueueItems(state?: QueueState): Promise<SummarizeQueueItem[]> {
  const client = await getDb();
  try {
    const params: unknown[] = [];
    let whereState = '';
    if (state) {
      params.push(state);
      whereState = `WHERE sq.state = $1`;
    }
    const { rows } = await client.query<{
      id: string;
      video_id: string;
      q_state: string;
      queued_at: number;
      summarized_at: number | null;
      created_at: number;
      title: string;
      thumbnail_url: string | null;
      duration_seconds: number | null;
      published_at: number | null;
      channel_id: string;
      channel_title: string;
      transcript_status: string;
      summary_count: string;
    }>(
      `SELECT
         sq.id, sq.video_id, sq.state AS q_state, sq.queued_at, sq.summarized_at, sq.created_at,
         v.title, v.thumbnail_url, v.duration_seconds, v.published_at,
         v.channel_id, c.title AS channel_title, v.transcript_status,
         (SELECT COUNT(*) FROM summaries s WHERE s.video_id = v.video_id) AS summary_count
       FROM summarize_queue sq
       JOIN videos v ON v.video_id = sq.video_id
       JOIN channels c ON c.channel_id = v.channel_id
       ${whereState}
       ORDER BY
         CASE sq.state WHEN 'queued' THEN 0 ELSE 1 END,
         CASE sq.state WHEN 'queued' THEN sq.queued_at ELSE sq.summarized_at END DESC`,
      params,
    );

    return rows.map(r => ({
      id: r.id,
      video_id: r.video_id,
      state: r.q_state === 'summarized' ? 'summarized' : 'queued',
      queued_at: r.queued_at,
      summarized_at: r.summarized_at,
      created_at: r.created_at,
      title: r.title,
      thumbnail_url: r.thumbnail_url,
      duration_seconds: r.duration_seconds,
      published_at: r.published_at,
      channel_id: r.channel_id,
      channel_title: r.channel_title,
      transcript_status: r.transcript_status as SummarizeQueueItem['transcript_status'],
      has_summary: Number(r.summary_count) > 0,
    }));
  } finally {
    client.release();
  }
}

/**
 * List just the video_ids of items currently in 'queued' state. Used by the
 * batch summarize action to know which videos to process.
 */
export async function listQueuedVideoIds(): Promise<string[]> {
  const client = await getDb();
  try {
    const { rows } = await client.query<{ video_id: string }>(
      `SELECT video_id FROM summarize_queue WHERE state = 'queued' ORDER BY queued_at DESC`,
    );
    return rows.map(r => r.video_id);
  } finally {
    client.release();
  }
}

/** Count of items in 'queued' state — for the nav badge. */
export async function countQueued(): Promise<number> {
  const client = await getDb();
  try {
    const { rows } = await client.query(`SELECT COUNT(*) AS n FROM summarize_queue WHERE state = 'queued'`);
    return Number(rows[0].n);
  } finally {
    client.release();
  }
}

/**
 * Check whether a video is currently in the queue (any state). Used by UI
 * components to show the correct "added to queue" state on the button.
 */
export async function isQueued(videoId: string): Promise<boolean> {
  const client = await getDb();
  try {
    const { rows } = await client.query<{ id: string }>(
      'SELECT id FROM summarize_queue WHERE video_id = $1',
      [videoId],
    );
    return rows.length > 0;
  } finally {
    client.release();
  }
}

/**
 * Bulk-check queue membership for a set of video_ids. Returns the subset of
 * ids that are currently queued (any state). Used by list views to mark
 * which videos are already in the queue without N+1 queries.
 */
export async function queuedVideoIds(videoIds: string[]): Promise<Set<string>> {
  if (videoIds.length === 0) return new Set();
  const client = await getDb();
  try {
    const placeholders = videoIds.map((_, i) => `$${i + 1}`).join(',');
    const { rows } = await client.query<{ video_id: string }>(
      `SELECT video_id FROM summarize_queue WHERE video_id IN (${placeholders})`,
      videoIds,
    );
    return new Set(rows.map(r => r.video_id));
  } finally {
    client.release();
  }
}
