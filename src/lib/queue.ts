/**
 * TAV-54: Watch queue — ranked candidate videos for the Watch tab.
 *
 * `buildWatchQueue` is a single SQL query that blends seven signals into a
 * relevance score, modelled on `listInboxVideos` in `src/lib/inbox.ts`. The
 * two new CTEs required by the spec both run *inside* this one query:
 *
 *   1. **topic_match** — computes the user's top-N topics from
 *      `summaries.topics` (stored as a JSON array string) and scores each
 *      candidate by overlap with those topics. Topics are lowercased on write
 *      (see `summarize.ts`), so comparisons are direct text equality after
 *      `jsonb_array_elements_text`.
 *   2. **reference_graph** — counts how many of the user's saved/summarized
 *      videos cite each candidate via `video_references.target_video_id`.
 *      Only edges whose source video has a summary are counted, so the graph
 *      reflects videos the user has actually engaged with.
 *
 * ## Signals (high → low weight)
 *
 *   - never_watched   — `video_play_history` is null        (weight 3.0)
 *   - not_completed   — `completed = 0` AND `last_progress_seconds > 0` (weight 2.0)
 *   - topic_match     — overlap with user's top-N topics     (weight 2.0 × match_count)
 *   - channel_affinity — summaries + likes per channel        (weight 1.5, capped at 5)
 *   - reference_graph — candidate is cited by saved/summarized videos (weight 1.0 × ref_count)
 *   - freshness       — exponential decay on published_at (7-day half-life)
 *   - engagement      — log-scaled view_count + like_count (tiebreaker)
 *
 * The final score multiplies the signal sum by freshness, then adds engagement
 * as a tiebreaker. Raw scores are normalised to 0–1 against the page max, the
 * same pattern `listInboxVideos` uses.
 *
 * ## Excludes
 *
 *   - `video_states.state = 'seen'` (dismissed from the inbox)
 *   - `music_flag = 1` channels (music routes to the Music queue, TAV-55)
 *   - hidden channels
 *   - live broadcasts (`is_live = 1`)
 *
 * ## File coordination
 *
 * TAV-55 (music queue) lands in this same file. Each ticket owns its own
 * exported function and its own SQL string; edits are additive at the bottom
 * of the file. Do not refactor one queue's SQL while the other ticket is
 * open — patch the specific function only.
 */

import { getDb } from './db';
import type { MusicLibraryGroup, MusicLibraryTrack, MusicQueueItem, WatchQueueItem } from './types';

// =============================================================================
// TAV-61: Queue pin helpers — pinToQueueTop / unpinFromQueue / listPinnedVideoIds
// =============================================================================
//
// Minimal queue-mutation API for the cross-link buttons (Watch next / Listen
// next / Play these next / Queue this channel). TAV-59 (autoplay + queue
// controls) hasn't landed a write helper yet, so this is the canonical surface
// — keep the UI buttons thin and call these helpers, never duplicate the SQL.
//
// Pins persist in the `queue_pins` table (see schema.ts) so they survive
// navigation to /watch or /music, which are `force-dynamic` and re-run
// buildWatchQueue / buildMusicQueue on every request. The build functions
// prepend pinned items not already in the ranked results so a pinned video
// always lands at index 0 of the queue the watch/music page receives.
//
// `queue` is 'watch' or 'music' — the same video can be pinned to both
// independently. Music vs. Watch is a parameter, not a separate function.

/** Which playback queue a pin targets. */
export type QueueTarget = 'watch' | 'music';

/**
 * Pin a video to the top of the given queue. Idempotent: re-pinning a video
 * already on the queue bumps it to position 0 (most-recently-pinned first).
 */
export async function pinToQueueTop(videoId: string, queue: QueueTarget): Promise<void> {
  const client = await getDb();
  try {
    const now = Math.floor(Date.now() / 1000);
    // Bump every existing pin on this queue down by one so the new pin can
    // take position 0. Re-pinning an already-pinned video first removes its
    // old row so the position shift doesn't collide with the unique PK.
    await client.query('UPDATE queue_pins SET position = position + 1 WHERE queue = $1', [queue]);
    await client.query(
      `INSERT INTO queue_pins (queue, video_id, position, pinned_at, created_at)
       VALUES ($1, $2, 0, $3, $3)
       ON CONFLICT (queue, video_id) DO UPDATE SET position = 0, pinned_at = EXCLUDED.pinned_at`,
      [queue, videoId, now],
    );
  } finally {
    client.release();
  }
}

/**
 * Pin multiple videos to the top of the given queue in batch, preserving the
 * caller's order: the first video in `videoIds` lands at position 0, the next
 * at 1, etc. Used by "Play these next" and "Queue this channel" so they fire
 * one batch mutation rather than N individual actions.
 *
 * Existing pins on this queue are shifted down by `videoIds.length` to make
 * room. Videos already pinned are re-positioned to their new slot.
 */
export async function pinMultipleToQueueTop(videoIds: string[], queue: QueueTarget): Promise<void> {
  if (videoIds.length === 0) return;
  const client = await getDb();
  try {
    const now = Math.floor(Date.now() / 1000);
    const n = videoIds.length;
    // Shift existing pins down by n to make room for the new batch at the top.
    await client.query('UPDATE queue_pins SET position = position + $1 WHERE queue = $2', [n, queue]);
    // Remove any of the incoming video_ids that are already pinned on this
    // queue so the INSERT ... ON CONFLICT below re-positions them cleanly
    // without a unique-PK collision mid-batch.
    const placeholders = videoIds.map((_, i) => `$${i + 3}`).join(', ');
    await client.query(
      `DELETE FROM queue_pins WHERE queue = $1 AND video_id IN (${placeholders})`,
      [queue, ...videoIds],
    );
    // Insert each video at its batch position (0, 1, 2, …).
    for (let i = 0; i < n; i++) {
      await client.query(
        `INSERT INTO queue_pins (queue, video_id, position, pinned_at, created_at)
         VALUES ($1, $2, $3, $4, $4)
         ON CONFLICT (queue, video_id) DO UPDATE SET position = EXCLUDED.position, pinned_at = EXCLUDED.pinned_at`,
        [queue, videoIds[i], i, now],
      );
    }
  } finally {
    client.release();
  }
}

/** Remove a video's pin from the given queue. No-op if it wasn't pinned. */
export async function unpinFromQueue(videoId: string, queue: QueueTarget): Promise<void> {
  const client = await getDb();
  try {
    await client.query('DELETE FROM queue_pins WHERE queue = $1 AND video_id = $2', [queue, videoId]);
  } finally {
    client.release();
  }
}

/** Return the pinned video ids for a queue, ordered by pin position (top first). */
export async function listPinnedVideoIds(queue: QueueTarget): Promise<string[]> {
  const client = await getDb();
  try {
    const { rows } = await client.query<{ video_id: string }>(
      'SELECT video_id FROM queue_pins WHERE queue = $1 ORDER BY position ASC, pinned_at DESC',
      [queue],
    );
    return rows.map(r => r.video_id);
  } finally {
    client.release();
  }
}

/**
 * Fetch the hydrated pinned items for a queue, joined with videos + channels so
 * the build functions can prepend them to the ranked results without a second
 * round-trip per video. Returns items in pin order (top first).
 *
 * Excludes pinned videos that have been deleted from the `videos` table (the
 * FK cascades, but this is defensive) or whose channel is hidden / a music
 * channel on the Watch queue (or vice versa) — the same excludes the build
 * query applies to ranked candidates.
 */
async function getPinnedWatchItems(): Promise<WatchQueueItem[]> {
  const client = await getDb();
  try {
    const { rows } = await client.query<{
      video_id: string;
      title: string;
      channel_title: string;
      thumbnail_url: string | null;
      duration_seconds: number | null;
      published_at: number | null;
    }>(
      `SELECT v.video_id, v.title, c.title AS channel_title,
              v.thumbnail_url, v.duration_seconds, v.published_at
       FROM queue_pins qp
       JOIN videos v ON v.video_id = qp.video_id
       JOIN channels c ON c.channel_id = v.channel_id
       WHERE qp.queue = 'watch'
         AND c.hidden = 0
         AND c.music_flag <> 1
         AND v.is_live = 0
       ORDER BY qp.position ASC, qp.pinned_at DESC`,
      [],
    );
    return rows.map(r => ({
      video_id: r.video_id,
      title: r.title,
      channel_title: r.channel_title,
      thumbnail_url: r.thumbnail_url,
      duration_seconds: r.duration_seconds,
      published_at: r.published_at,
      score: 1, // pinned items always rank at the top
      reason: '📌 Pinned',
      is_pinned: true,
    }));
  } finally {
    client.release();
  }
}

/** Hydrated pinned items for the Music queue, mirroring getPinnedWatchItems. */
async function getPinnedMusicItems(): Promise<MusicQueueItem[]> {
  const client = await getDb();
  try {
    const { rows } = await client.query<{
      video_id: string;
      title: string;
      channel_title: string;
      thumbnail_url: string | null;
      duration_seconds: number | null;
      published_at: number | null;
    }>(
      `SELECT v.video_id, v.title, c.title AS channel_title,
              v.thumbnail_url, v.duration_seconds, v.published_at
       FROM queue_pins qp
       JOIN videos v ON v.video_id = qp.video_id
       JOIN channels c ON c.channel_id = v.channel_id
       WHERE qp.queue = 'music'
         AND c.hidden = 0
         AND c.music_flag = 1
         AND v.is_live = 0
       ORDER BY qp.position ASC, qp.pinned_at DESC`,
      [],
    );
    return rows.map(r => ({
      video_id: r.video_id,
      title: r.title,
      channel_title: r.channel_title,
      thumbnail_url: r.thumbnail_url,
      duration_seconds: r.duration_seconds,
      published_at: r.published_at,
      score: 1,
      is_pinned: true,
    }));
  } finally {
    client.release();
  }
}

/** Default page size for the Watch queue. */
export const WATCH_QUEUE_PAGE_SIZE = 30;

/** Number of topics to consider "top-N" for the topic-match signal. */
const TOP_N_TOPICS = 15;

/**
 * Fetch a ranked page of Watch-queue candidate videos.
 *
 * The entire ranking — topic-match CTE, reference-graph CTE, signal weights,
 * excludes, and ordering — runs in a single SQL statement so the Watch tab is
 * one paginated round-trip, matching `listInboxVideos`'s shape.
 *
 * @param limit  page size (clamped 1–200, default {@link WATCH_QUEUE_PAGE_SIZE})
 * @param offset row offset for pagination (clamped ≥ 0)
 */
export async function buildWatchQueue(
  limit: number = WATCH_QUEUE_PAGE_SIZE,
  offset: number = 0,
): Promise<WatchQueueItem[]> {
  const lim = Math.max(1, Math.min(200, limit));
  const off = Math.max(0, offset);

  const client = await getDb();
  try {
    const { rows } = await client.query<{
      video_id: string;
      title: string;
      channel_title: string;
      thumbnail_url: string | null;
      duration_seconds: number | null;
      published_at: number | null;
      raw_score: number;
      reason: string;
    }>(
      `
      WITH
      -- topic_match: the user's top-N topics from summaries.topics (JSON array
      -- string). jsonb_array_elements_text returns one row per topic; we
      -- lowercase to match the write path (summarize.ts lowercases topics).
      user_topics AS (
        SELECT LOWER(topic) AS topic
        FROM summaries s,
             LATERAL jsonb_array_elements_text(
               COALESCE(s.topics::jsonb, '[]'::jsonb)
             ) AS topic
        WHERE s.topics IS NOT NULL
        GROUP BY LOWER(topic)
        ORDER BY COUNT(*) DESC
        LIMIT ${TOP_N_TOPICS}
      ),
      -- Score each candidate by how many of the user's top-N topics it shares.
      -- Both sides are JSON arrays of lowercase strings; we compare element-wise
      -- with jsonb_array_elements_text on both rows for exact, indexable match.
      topic_match AS (
        SELECT s.video_id, COUNT(*) AS match_count
        FROM summaries s,
             LATERAL jsonb_array_elements_text(COALESCE(s.topics::jsonb, '[]'::jsonb)) AS cand_topic
        JOIN user_topics ut ON ut.topic = LOWER(cand_topic)
        GROUP BY s.video_id
      ),
      -- reference_graph: count how many of the user's saved/summarized videos
      -- cite each candidate via video_references.target_video_id. Only edges
      -- whose source video has a summary are counted.
      reference_graph AS (
        SELECT r.target_video_id AS video_id, COUNT(DISTINCT r.source_video_id) AS ref_count
        FROM video_references r
        JOIN summaries sm ON sm.video_id = r.source_video_id
        WHERE r.target_video_id IS NOT NULL
        GROUP BY r.target_video_id
      ),
      -- channel_affinity: summaries + likes per channel, capped at 5 so one
      -- prolific channel can't dominate. Matches the channel_interaction CTE
      -- shape in listInboxVideos but adds likes.
      channel_affinity AS (
        SELECT v.channel_id,
               LEAST(COUNT(DISTINCT s.id) + COUNT(DISTINCT vl.video_id), 5) AS affinity
        FROM videos v
        LEFT JOIN summaries s ON s.video_id = v.video_id
        LEFT JOIN video_likes vl ON vl.video_id = v.video_id
        GROUP BY v.channel_id
      ),
      scored AS (
        SELECT
          v.video_id, v.title, v.thumbnail_url, v.duration_seconds,
          -- Select the raw published_at (nullable) separately from the
          -- freshness expression, so nulls flow through to the JS return
          -- as null — not as 0 from the COALESCE in the freshness calc below.
          v.published_at, v.channel_id,
          c.title AS channel_title,

          -- never_watched: no play-history row → strongest signal.
          (ph.video_id IS NULL)::int * 3.0 AS never_watched,

          -- not_completed: started but not finished.
          CASE
            WHEN ph.video_id IS NOT NULL AND ph.completed = 0 AND ph.last_progress_seconds > 0
            THEN 2.0 ELSE 0.0
          END AS not_completed,

          -- topic_match: 2.0 per overlapping topic.
          COALESCE(tm.match_count, 0)::float * 2.0 AS topic_signal,

          -- channel_affinity: capped bonus, weight 1.5 (spec: above reference graph).
          COALESCE(ca.affinity, 0)::float * 1.5 AS channel_signal,

          -- reference_graph: weight 1.0 per citing video.
          COALESCE(rg.ref_count, 0)::float AS reference_signal,

          -- freshness: exponential decay, 7-day half-life (604800s). Fresh →
          -- 1.0, 7-day-old → 0.368, very old → ~0 (underflow-guarded at EXP(-700)),
          -- future-dated → neutral 1.0. GREATEST(age, 0) prevents future bonus;
          -- LEAST(700, …) prevents EXP() underflow.
          EXP(-LEAST(700, GREATEST(
            EXTRACT(EPOCH FROM (NOW() - TO_TIMESTAMP(COALESCE(v.published_at, 0)))) / 604800.0,
            0
          ))) AS freshness,

          -- engagement: log-scaled view + like counts (tiebreaker only).
          (LN(GREATEST(COALESCE(v.view_count, 1), 1)) + LN(COALESCE(v.like_count, 0) + 1)) AS engagement,

          -- reason components for display.
          (ph.video_id IS NULL) AS is_never_watched,
          (ph.video_id IS NOT NULL AND ph.completed = 0 AND ph.last_progress_seconds > 0) AS is_not_completed,
          COALESCE(tm.match_count, 0) AS topic_count,
          COALESCE(rg.ref_count, 0) AS ref_count

        FROM videos v
        JOIN channels c ON c.channel_id = v.channel_id
        LEFT JOIN video_states vs ON vs.video_id = v.video_id
        LEFT JOIN video_play_history ph ON ph.video_id = v.video_id
        LEFT JOIN topic_match tm ON tm.video_id = v.video_id
        LEFT JOIN reference_graph rg ON rg.video_id = v.video_id
        LEFT JOIN channel_affinity ca ON ca.channel_id = v.channel_id
        WHERE c.hidden = 0
          AND c.music_flag <> 1
          AND v.is_live = 0
          AND (vs.state IS NULL OR vs.state <> 'seen')
      )
      SELECT *,
        -- final score: (signal sum) × freshness + engagement tiebreaker.
        (
          (never_watched + not_completed + topic_signal + channel_signal + reference_signal)
          * freshness
          + engagement * 0.01
        ) AS raw_score,
        -- reason: short human-readable string of the top contributing signals.
        (
          CASE WHEN is_never_watched THEN 'Never watched' ELSE '' END
          || CASE WHEN is_not_completed AND is_never_watched THEN ' · Not finished' ELSE '' END
          || CASE WHEN is_not_completed AND NOT is_never_watched THEN 'Not finished' ELSE '' END
          || CASE WHEN topic_count > 0
             THEN (CASE WHEN is_never_watched OR is_not_completed THEN ' · ' ELSE '' END
                  || topic_count::text || ' topic match' || CASE WHEN topic_count > 1 THEN 'es' ELSE '' END)
             ELSE '' END
          || CASE WHEN ref_count > 0
             THEN (CASE WHEN is_never_watched OR is_not_completed OR topic_count > 0 THEN ' · ' ELSE '' END
                  || 'Cited by ' || ref_count::text || ' saved video' || CASE WHEN ref_count > 1 THEN 's' ELSE '' END)
             ELSE '' END
        ) AS reason
      FROM scored
      ORDER BY raw_score DESC NULLS LAST
      LIMIT ${lim} OFFSET ${off}`,
      [],
    );

    // Normalise raw score to 0–1 against the page max, same as listInboxVideos.
    const maxScore = rows.length > 0
      ? Math.max(...rows.map(r => r.raw_score ?? 0), 1e-9)
      : 1;

    const ranked: WatchQueueItem[] = rows.map(r => ({
      video_id: r.video_id,
      title: r.title,
      channel_title: r.channel_title,
      thumbnail_url: r.thumbnail_url,
      duration_seconds: r.duration_seconds,
      published_at: r.published_at,
      score: (r.raw_score ?? 0) / maxScore,
      reason: r.reason || 'Trending',
      is_pinned: false,
    }));

    // TAV-61: prepend pinned videos so they survive the force-dynamic re-fetch.
    return withPinnedWatch(ranked, lim);
  } finally {
    client.release();
  }
}

/**
 * Prepend pinned items (TAV-61) to the ranked Watch queue results. Pinned
 * videos not already in the ranked set are hydrated from `queue_pins` and
 * placed at the top in pin order; pinned videos that also appear in the ranked
 * results are moved to the front. The combined list is truncated to `limit`.
 */
async function withPinnedWatch(
  ranked: WatchQueueItem[],
  limit: number,
): Promise<WatchQueueItem[]> {
  const pinned = await getPinnedWatchItems();
  if (pinned.length === 0) return ranked;

  const rankedIds = new Set(ranked.map(r => r.video_id));
  // Pinned videos already in the ranked results: pull them to the front.
  const pinnedInRanked = pinned.filter(p => rankedIds.has(p.video_id));
  // Pinned videos not in the ranked results: prepend them as new rows.
  const pinnedNotInRanked = pinned.filter(p => !rankedIds.has(p.video_id));
  // Ranked results minus the pinned ones we pulled forward (avoid dupes).
  // Pinned items already in the ranked results are marked is_pinned: true so
  // the UI can toggle the pin button correctly.
  const rest = ranked
    .filter(r => !pinnedInRanked.some(p => p.video_id === r.video_id))
    .map(r => ({ ...r, is_pinned: false }));

  return [...pinnedNotInRanked, ...pinnedInRanked, ...rest].slice(0, Math.max(limit, 1));
}

// =============================================================================
// TAV-55: Music queue — buildMusicQueue
// =============================================================================
//
// `buildMusicQueue` is a trimmed sibling of `buildWatchQueue`: it ranks
// candidate videos from channels the user has flagged as music
// (`channels.music_flag = 1`). The spec drops the topic-match and
// reference-graph CTEs — music discovery doesn't lean on summarised topics or
// citation graphs the way the Watch queue does — and relaxes the freshness
// half-life to 30 days (music doesn't go stale like news).
//
// ## Signals (high → low weight)
//
//   - channel_affinity — plays + likes on music channels (weight 1.0, capped at 5)
//   - freshness        — exponential decay on published_at (30-day half-life)
//   - not_recently_played — deprioritise if played in the last 24h (cooldown)
//   - engagement       — log-scaled view_count + like_count (tiebreaker)
//
// The final score multiplies (channel_affinity + not_recently_played penalty)
// by freshness, then adds engagement as a tiebreaker. Raw scores are
// normalised to 0–1 against the page max, same pattern as the Watch queue.
//
// ## Excludes
//
//   - `video_states.state = 'seen'` (dismissed from the inbox)
//   - non-music channels (`music_flag <> 1`) — those route to the Watch queue
//   - hidden channels
//   - live broadcasts (`is_live = 1`)
//
// This is an additive export at the bottom of the file; it does not touch
// `buildWatchQueue`'s SQL or the shared `WATCH_QUEUE_PAGE_SIZE` constant.

/** Default page size for the Music queue. */
export const MUSIC_QUEUE_PAGE_SIZE = 30;

/**
 * Fetch a ranked page of Music-queue candidate videos.
 *
 * The entire ranking — channel-affinity CTE, 24h not-recently-played cooldown,
 * 30-day freshness decay, engagement tiebreaker, excludes, and ordering — runs
 * in a single SQL statement so the Music tab is one paginated round-trip,
 * matching `buildWatchQueue`'s shape.
 *
 * @param limit  page size (clamped 1–200, default {@link MUSIC_QUEUE_PAGE_SIZE})
 * @param offset row offset for pagination (clamped ≥ 0)
 */
export async function buildMusicQueue(
  limit: number = MUSIC_QUEUE_PAGE_SIZE,
  offset: number = 0,
): Promise<MusicQueueItem[]> {
  const lim = Math.max(1, Math.min(200, limit));
  const off = Math.max(0, offset);

  const client = await getDb();
  try {
    const { rows } = await client.query<{
      video_id: string;
      title: string;
      channel_title: string;
      thumbnail_url: string | null;
      duration_seconds: number | null;
      published_at: number | null;
      raw_score: number;
    }>(
      `
      WITH
      -- channel_affinity: plays + likes on music channels, capped at 5 so one
      -- prolific channel can't dominate. Uses the same shape as the Watch
      -- queue's channel_affinity CTE but counts plays (video_play_history) and
      -- likes (video_likes) instead of summaries — music affinity is about
      -- listening, not summarising.
      channel_affinity AS (
        SELECT v.channel_id,
               LEAST(COUNT(DISTINCT ph.video_id) + COUNT(DISTINCT vl.video_id), 5) AS affinity
        FROM videos v
        LEFT JOIN video_play_history ph ON ph.video_id = v.video_id
        LEFT JOIN video_likes vl ON vl.video_id = v.video_id
        GROUP BY v.channel_id
      ),
      scored AS (
        SELECT
          v.video_id, v.title, v.thumbnail_url, v.duration_seconds,
          v.published_at, v.channel_id,
          c.title AS channel_title,

          -- channel_affinity: capped bonus, weight 1.0.
          COALESCE(ca.affinity, 0)::float AS channel_signal,

          -- not_recently_played: if the video was played in the last 24h
          -- (86400s), apply a 0.5 cooldown multiplier — music re-listening is
          -- normal, but not back-to-back. Null/unplayed → 1.0 (no penalty).
          CASE
            WHEN ph.video_id IS NOT NULL
              AND ph.last_played_at IS NOT NULL
              AND (EXTRACT(EPOCH FROM (NOW() - TO_TIMESTAMP(ph.last_played_at)))) < 86400
            THEN 0.5 ELSE 1.0
          END AS recency_played_factor,

          -- freshness: exponential decay, 30-day half-life (2592000s). Music
          -- doesn't go stale like news, so the half-life is ~4.3× longer than
          -- the Watch queue's 7-day decay. Clamped exponent so EXP() never
          -- underflows (same guard as listInboxVideos / buildWatchQueue).
          EXP(-GREATEST(-700, LEAST(
            EXTRACT(EPOCH FROM (NOW() - TO_TIMESTAMP(COALESCE(v.published_at, 0)))) / 2592000.0,
            0
          ))) AS freshness,

          -- engagement: log-scaled view + like counts (tiebreaker only).
          (LN(GREATEST(COALESCE(v.view_count, 1), 1)) + LN(COALESCE(v.like_count, 0) + 1)) AS engagement

        FROM videos v
        JOIN channels c ON c.channel_id = v.channel_id
        LEFT JOIN video_states vs ON vs.video_id = v.video_id
        LEFT JOIN video_play_history ph ON ph.video_id = v.video_id
        LEFT JOIN channel_affinity ca ON ca.channel_id = v.channel_id
        WHERE c.hidden = 0
          AND c.music_flag = 1
          AND v.is_live = 0
          AND (vs.state IS NULL OR vs.state <> 'seen')
      )
      SELECT *,
        -- final score: (channel_signal × not-recently-played factor) × freshness
        -- + engagement tiebreaker. The cooldown multiplies channel affinity so
        -- a recently-played track from a favourite channel still ranks, just
        -- lower than a fresh one from the same channel.
        (
          (channel_signal * recency_played_factor)
          * freshness
          + engagement * 0.01
        ) AS raw_score
      FROM scored
      ORDER BY raw_score DESC NULLS LAST
      LIMIT ${lim} OFFSET ${off}`,
      [],
    );

    // Normalise raw score to 0–1 against the page max, same as buildWatchQueue.
    const maxScore = rows.length > 0
      ? Math.max(...rows.map(r => r.raw_score ?? 0), 1e-9)
      : 1;

    const ranked: MusicQueueItem[] = rows.map(r => ({
      video_id: r.video_id,
      title: r.title,
      channel_title: r.channel_title,
      thumbnail_url: r.thumbnail_url,
      duration_seconds: r.duration_seconds,
      published_at: r.published_at,
      score: (r.raw_score ?? 0) / maxScore,
      is_pinned: false,
    }));

    // TAV-61: prepend pinned tracks so they survive the force-dynamic re-fetch.
    return withPinnedMusic(ranked, lim);
  } finally {
    client.release();
  }
}

/**
 * Prepend pinned items (TAV-61) to the ranked Music queue results, mirroring
 * {@link withPinnedWatch} for the Music queue. See that function for the
 * dedupe + truncate logic.
 */
async function withPinnedMusic(
  ranked: MusicQueueItem[],
  limit: number,
): Promise<MusicQueueItem[]> {
  const pinned = await getPinnedMusicItems();
  if (pinned.length === 0) return ranked;

  const rankedIds = new Set(ranked.map(r => r.video_id));
  const pinnedInRanked = pinned.filter(p => rankedIds.has(p.video_id));
  const pinnedNotInRanked = pinned.filter(p => !rankedIds.has(p.video_id));
  const rest = ranked
    .filter(r => !pinnedInRanked.some(p => p.video_id === r.video_id))
    .map(r => ({ ...r, is_pinned: false }));

  return [...pinnedNotInRanked, ...pinnedInRanked, ...rest].slice(0, Math.max(limit, 1));
}

// =============================================================================
// Music library — listMusicLibrary / getMusicVideo
// =============================================================================
//
// The Music queue (`buildMusicQueue`) is a ranked top-N page — great for "what
// should play next", but it gives the user no way to browse beyond what the
// ranking picked. These two functions back the browsable "All Music" library
// on /music: every video from music-flagged channels (including `seen` ones —
// a library is a catalogue, not an inbox), grouped by artist.

/**
 * List every video from music-flagged, non-hidden channels, grouped by artist
 * (channel title A–Z, tracks newest-first within each artist). Also used by
 * /music to resolve a `?v=` param naming a track outside the ranked queue
 * page (e.g. clicked from the library section).
 */
export async function listMusicLibrary(): Promise<MusicLibraryGroup[]> {
  const client = await getDb();
  try {
    const { rows } = await client.query<MusicLibraryTrack>(
      `
      SELECT v.video_id, v.title, v.thumbnail_url, v.duration_seconds,
             v.published_at, c.title AS channel_title,
             COALESCE(vs.state = 'seen', FALSE) AS is_seen
      FROM videos v
      JOIN channels c ON c.channel_id = v.channel_id
      LEFT JOIN video_states vs ON vs.video_id = v.video_id
      WHERE c.hidden = 0
        AND c.music_flag = 1
        AND v.is_live = 0
      ORDER BY LOWER(c.title) ASC, v.published_at DESC NULLS LAST`,
      [],
    );

    // Rows arrive pre-sorted (artist A–Z, then newest first), so grouping is
    // a single ordered pass.
    const groups: MusicLibraryGroup[] = [];
    for (const row of rows) {
      const last = groups[groups.length - 1];
      if (last && last.channel_title === row.channel_title) {
        last.tracks.push(row);
      } else {
        groups.push({ channel_title: row.channel_title, tracks: [row] });
      }
    }
    return groups;
  } finally {
    client.release();
  }
}
