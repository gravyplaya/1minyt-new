/**
 * TAV-22: Unified inbox / triage view.
 *
 * A single relevance-ranked feed of videos across all subscriptions, with
 * per-video triage state (seen / saved). The relevance score blends three
 * signals:
 *
 *   engagement  — log-scaled view + like counts (TAV-17 statistics).
 *   recency     — exponential decay over published_at (7-day half-life).
 *   channel     — bonus proportional to how many videos the user has already
 *                 summarized from this channel (a proxy for "past interaction
 *                 with that channel").
 *
 * The score is computed in SQL so the feed stays a single paginated query.
 */

import { getDb } from './db';
import type { InboxQuery, InboxVideo, VideoTriageState } from './types';

/** Default page size for the inbox feed. */
export const INBOX_PAGE_SIZE = 30;

/**
 * Fetch a page of inbox videos ordered by relevance score.
 *
 * The `scope` parameter controls which triage bucket is returned:
 *   - 'new'   (default): videos with no triage state (not yet seen/saved).
 *   - 'saved':           videos the user has bookmarked from the inbox.
 *
 * Returns the page plus the total count (ignoring limit/offset) for pagination.
 */
export async function listInboxVideos(query: InboxQuery = {}): Promise<{ videos: InboxVideo[]; total: number }> {
  const scope: 'new' | 'saved' = query.scope === 'saved' ? 'saved' : 'new';
  const limit = Math.max(1, Math.min(200, query.limit ?? INBOX_PAGE_SIZE));
  const offset = Math.max(0, query.offset ?? 0);

  const where: string[] = [];
  const params: unknown[] = [];
  let pIdx = 1;

  // Exclude hidden channels — the user has soft-hidden them from the app.
  where.push('c.hidden = 0');
  // Exclude live broadcasts from the triage feed.
  where.push('v.is_live = 0');

  if (scope === 'new') {
    where.push('vs.state IS NULL');
  } else {
    where.push("vs.state = 'saved'");
  }

  if (query.channelId) {
    where.push(`v.channel_id = $${pIdx}`);
    params.push(query.channelId);
    pIdx++;
  }
  if (query.categoryId != null) {
    where.push(`v.category_id = $${pIdx}`);
    params.push(query.categoryId);
    pIdx++;
  }
  if (query.onlyUncaptioned) {
    where.push("v.transcript_status = 'unavailable'");
  }

  const whereSql = `WHERE ${where.join(' AND ')}`;

  const client = await getDb();
  try {
    // Count first (same WHERE, no LIMIT/OFFSET).
    const countSql = `
      SELECT COUNT(*) AS n
      FROM videos v
      JOIN channels c ON c.channel_id = v.channel_id
      LEFT JOIN video_states vs ON vs.video_id = v.video_id
      ${whereSql}`;
    const countResult = await client.query(countSql, params);
    const total = Number(countResult.rows[0].n);
    if (total === 0) return { videos: [], total: 0 };

    // Scored feed. The CTE pre-computes per-channel interaction counts so we
    // don't need a correlated subquery per row.
    const feedSql = `
      WITH channel_interaction AS (
        SELECT v2.channel_id, COUNT(s.id) AS summary_count
        FROM videos v2
        JOIN summaries s ON s.video_id = v2.video_id
        GROUP BY v2.channel_id
      ),
      scored AS (
        SELECT
          v.video_id, v.title, v.thumbnail_url, v.duration_seconds,
          v.published_at, v.channel_id,
          c.title AS channel_title,
          c.thumbnail_url AS channel_thumbnail_url,
          v.view_count, v.like_count, v.comment_count, v.category_id,
          v.transcript_status,
          vs.state AS triage_state,
          EXISTS (SELECT 1 FROM summaries s WHERE s.video_id = v.video_id) AS has_summary,
          -- engagement: log-scaled view + like counts (null → 0 contribution)
          (LN(COALESCE(v.view_count, 1)) + LN(COALESCE(v.like_count, 0) + 1)) AS engagement,
          -- recency: exponential decay, half-life ~7 days (604800s).
          -- Null published_at → treated as epoch (0), so recency → ~0.
          -- Clamp the exponent to >= -700 so EXP() never underflows to
          -- sub-DBL_MIN (older videos with published_at = 0 would otherwise
          -- produce ~EXP(-2929), which Postgres rejects as out of range).
          EXP(-GREATEST(-700, LEAST(EXTRACT(EPOCH FROM (NOW() - TO_TIMESTAMP(COALESCE(v.published_at, 0)))) / 604800.0, 0))) AS recency,
          -- channel interaction: capped bonus (saturates at 5 prior summaries).
          LEAST(COALESCE(ci.summary_count, 0) / 5.0, 1) AS channel_signal
        FROM videos v
        JOIN channels c ON c.channel_id = v.channel_id
        LEFT JOIN video_states vs ON vs.video_id = v.video_id
        LEFT JOIN channel_interaction ci ON ci.channel_id = v.channel_id
        ${whereSql}
      )
      SELECT *,
        -- relevance = engagement × recency × (1 + channel_signal)
        (engagement * recency * (1 + channel_signal)) AS raw_score
      FROM scored
      ORDER BY raw_score DESC NULLS LAST
      LIMIT ${limit} OFFSET ${offset}`;

    const { rows } = await client.query<{
      video_id: string;
      title: string;
      thumbnail_url: string | null;
      duration_seconds: number | null;
      published_at: number | null;
      channel_id: string;
      channel_title: string;
      channel_thumbnail_url: string | null;
      view_count: number | null;
      like_count: number | null;
      comment_count: number | null;
      category_id: number | null;
      transcript_status: string;
      has_summary: boolean;
      triage_state: string | null;
      raw_score: number;
    }>(feedSql, params);

    // Normalise the raw score to 0–1 for display using the page max.
    const maxScore = rows.length > 0 ? Math.max(...rows.map(r => r.raw_score ?? 0), 1e-9) : 1;

    const videos: InboxVideo[] = rows.map(r => ({
      video_id: r.video_id,
      title: r.title,
      thumbnail_url: r.thumbnail_url,
      duration_seconds: r.duration_seconds,
      published_at: r.published_at,
      channel_id: r.channel_id,
      channel_title: r.channel_title,
      channel_thumbnail_url: r.channel_thumbnail_url,
      view_count: r.view_count,
      like_count: r.like_count,
      comment_count: r.comment_count,
      category_id: r.category_id,
      transcript_status: r.transcript_status as InboxVideo['transcript_status'],
      has_summary: r.has_summary,
      relevance_score: (r.raw_score ?? 0) / maxScore,
      triage_state: r.triage_state === 'seen' || r.triage_state === 'saved' ? r.triage_state : null,
    }));

    return { videos, total };
  } finally {
    client.release();
  }
}

/**
 * Set or update the triage state for a video. Upserts the `video_states` row.
 * Passing `null` for state removes the triage row (returns the video to 'new').
 */
export async function setVideoState(videoId: string, state: VideoTriageState | null): Promise<void> {
  const client = await getDb();
  try {
    if (state === null) {
      await client.query('DELETE FROM video_states WHERE video_id = $1', [videoId]);
      return;
    }
    const now = Math.floor(Date.now() / 1000);
    await client.query(
      `INSERT INTO video_states (video_id, state, updated_at)
       VALUES ($1, $2, $3)
       ON CONFLICT (video_id) DO UPDATE SET state = excluded.state, updated_at = excluded.updated_at`,
      [videoId, state, now],
    );
  } finally {
    client.release();
  }
}

/** Count of untriaged videos — for the inbox badge. */
export async function countInboxNew(): Promise<number> {
  const client = await getDb();
  try {
    const { rows } = await client.query(`
      SELECT COUNT(*) AS n
      FROM videos v
      JOIN channels c ON c.channel_id = v.channel_id
      LEFT JOIN video_states vs ON vs.video_id = v.video_id
      WHERE c.hidden = 0 AND v.is_live = 0 AND vs.state IS NULL`);
    return Number(rows[0].n);
  } finally {
    client.release();
  }
}

/**
 * Distinct (category_id, category_label) pairs present among untriaged videos,
 * for the topic filter dropdown. YouTube category ids are stable; we don't
 * resolve them to human names here (the UI can map the well-known ones).
 */
export async function listInboxCategories(): Promise<{ category_id: number; video_count: number }[]> {
  const client = await getDb();
  try {
    const { rows } = await client.query<{
      category_id: number;
      video_count: number;
    }>(`
      SELECT v.category_id, COUNT(*) AS video_count
      FROM videos v
      JOIN channels c ON c.channel_id = v.channel_id
      LEFT JOIN video_states vs ON vs.video_id = v.video_id
      WHERE c.hidden = 0 AND v.is_live = 0 AND vs.state IS NULL AND v.category_id IS NOT NULL
      GROUP BY v.category_id
      ORDER BY video_count DESC`);
    return rows.map(r => ({ category_id: r.category_id, video_count: Number(r.video_count) }));
  } finally {
    client.release();
  }
}

/**
 * Distinct channels that have untriaged videos, for the channel filter dropdown.
 */
export async function listInboxChannels(): Promise<{ channel_id: string; channel_title: string; video_count: number }[]> {
  const client = await getDb();
  try {
    const { rows } = await client.query<{
      channel_id: string;
      channel_title: string;
      video_count: number;
    }>(`
      SELECT v.channel_id, c.title AS channel_title, COUNT(*) AS video_count
      FROM videos v
      JOIN channels c ON c.channel_id = v.channel_id
      LEFT JOIN video_states vs ON vs.video_id = v.video_id
      WHERE c.hidden = 0 AND v.is_live = 0 AND vs.state IS NULL
      GROUP BY v.channel_id, c.title
      ORDER BY video_count DESC`);
    return rows.map(r => ({
      channel_id: r.channel_id,
      channel_title: r.channel_title,
      video_count: Number(r.video_count),
    }));
  } finally {
    client.release();
  }
}
