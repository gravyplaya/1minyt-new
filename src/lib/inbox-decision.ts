/**
 * TAV-72: JEV interest scoring for the Smart Inbox.
 *
 * The SQL relevance formula (lib/inbox.ts) is blind — it only sees view/like
 * counts and timestamps, so a cluster of same-stats uploads ties and the
 * feed degenerates into "10 videos from one channel in arbitrary order".
 *
 * This pass adds two things on top of the SQL order:
 *
 *  1. JEV re-score (the TAV-70 decision layer, same askDecisions surface as
 *     rerankByRelevance): one batched request, one score question per
 *     un-cached video, judged against a 4-level "is this worth your
 *     attention" rubric. Judgments are cached per (user, video) in
 *     jev_video_scores — the inbox re-renders on every triage action and
 *     JEV calls cost money, so we judge once and reuse.
 *
 *  2. Channel interleaving: after blending SQL relevance with the JEV
 *     score (0.6 SQL + 0.4 JEV), videos from the same channel are spread
 *     across the page round-robin so no single channel floods the top.
 *
 * Enhancement, not a dependency (the TAV-70 rule): unset key, failed call,
 * or partial answers all degrade to the input order. The inbox never breaks
 * because of the decision layer.
 */

import { askDecisions, type DecisionQuestion } from './decision';
import { getDb } from './db';
import type { InboxVideo } from './types';

/** Interest rubric — a score answer indexes these levels. */
const INTEREST_LEVELS: string[] = [
  'Routine upload — filler, clickbait, or low-effort content',
  'Mildly interesting — might appeal to someone following the channel',
  'Worth your attention — a notable or substantive video',
  'Drop what you are doing — exceptional, must-watch content',
];

/** Blend weight: SQL relevance vs JEV interest (must sum to 1). */
const SQL_WEIGHT = 0.6;
const JEV_WEIGHT = 0.4;

/** Above this many un-cached videos, skip JEV rather than send a huge batch. */
const JEV_MAX_BATCH = 60;

/** Score rows older than this are re-judged (rubric/model may have moved). */
const SCORE_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days

/** The pinned model askDecisions used for the last call — logged for cache rows. */
let lastModel: string | null = null;
export function __lastDecisionModel(): string | null {
  return lastModel;
}

/**
 * Blend SQL relevance with cached/fresh JEV interest scores, then interleave
 * channels. `videos` must be in SQL relevance order (highest first);
 * `relevance_score` on each entry is the normalized 0-1 SQL score.
 *
 * Returns the same videos, reordered; `jev_interest` is set on each when a
 * score was available (null when JEV was skipped or failed — the blend then
 * uses the SQL score alone, i.e. input order after interleave).
 */
export async function rankInboxByInterest(
  userId: string,
  videos: InboxVideo[],
): Promise<InboxVideo[]> {
  if (videos.length < 2) return videos;

  // 1. Load cached scores for this page's videos.
  let cached = new Map<string, JevScoreEntry>();
  try {
    cached = await loadCachedScores(userId, videos.map(v => v.video_id));
  } catch {
    cached = new Map();
  }

  // 2. Judge the un-cached ones with JEV (one batched request), persist.
  const uncached = videos.filter(v => !cached.has(v.video_id));
  if (uncached.length > 0 && uncached.length <= JEV_MAX_BATCH) {
    try {
      const fresh = await scoreWithJev(uncached);
      for (const [videoId, entries] of fresh) {
        const e = entries[0];
        if (e) cached.set(videoId, e);
      }
      void persistScores(userId, fresh).catch(() => {
        /* cache write failure is non-fatal — next render re-judges */
      });
    } catch {
      // JEV unavailable — degrade to SQL order (still interleaved below).
    }
  }

  // 3. Blend: 0-3 JEV score → 0-1; combine with the SQL relevance score.
  const blended = videos.map(v => {
    const c = cached.get(v.video_id);
    const jev = c ? c.score / (INTEREST_LEVELS.length - 1) : null;
    const blendedScore =
      jev == null
        ? v.relevance_score
        : SQL_WEIGHT * v.relevance_score + JEV_WEIGHT * jev;
    return { video: v, jev, blendedScore };
  });

  // 4. Sort by blended score (stable — ties keep SQL order).
  blended.sort((a, b) => b.blendedScore - a.blendedScore);

  // 5. Interleave channels: walk the sorted list, emit at most one video per
  //    channel per round. Prevents "10 in a row from one channel" even when
  //    one channel legitimately dominates the top scores.
  const byChannel = new Map<string, typeof blended>();
  for (const entry of blended) {
    const list = byChannel.get(entry.video.channel_id) ?? [];
    list.push(entry);
    byChannel.set(entry.video.channel_id, list);
  }
  // Channel queue order = their best entry's rank (best channel first).
  const channelOrder = [...byChannel.values()].sort(
    (a, b) => b[0].blendedScore - a[0].blendedScore,
  );
  const out: InboxVideo[] = [];
  let emitted = 0;
  while (emitted < blended.length) {
    for (const list of channelOrder) {
      const entry = list.shift();
      if (entry) {
        out.push({ ...entry.video, jev_interest: entry.jev });
        emitted++;
      }
    }
  }
  return out;
}

/** One score question per video, one request — the rerankByRelevance fan-out pattern. */
type JevScoreEntry = { score: number; model: string };

async function scoreWithJev(
  videos: InboxVideo[],
): Promise<Map<string, JevScoreEntry[]>> {
  // Build the state: each video as a named field with the text JEV judges.
  const state: Record<string, string> = {};
  const questions: Record<string, DecisionQuestion> = {};
  videos.forEach((v, i) => {
    const id = `v${i}`;
    state[id] = [
      `Title: ${v.title}`,
      `Channel: ${v.channel_title}`,
      `Views: ${v.view_count ?? 'unknown'}; Likes: ${v.like_count ?? 'unknown'}`,
      `Published: ${v.published_at ? new Date(v.published_at * 1000).toISOString().slice(0, 10) : 'unknown'}`,
      `Duration: ${v.duration_seconds ? `${Math.round(v.duration_seconds / 60)} min` : 'unknown'}`,
    ].join(' | ');
    questions[`q${i}`] = {
      type: 'score',
      instructions: `Given the subscriber's subscriptions, how noteworthy is the video described in \`${id}\`? Judge only from the metadata given — routine uploads score low, exceptional or substantive videos score high.`,
      criteria: INTEREST_LEVELS,
    };
  });

  const res = await askDecisions(state, questions);
  if (!res) throw new Error('no-jev'); // unset key — caller degrades
  lastModel = res.model;

  const scored = new Map<string, JevScoreEntry[]>();
  videos.forEach((v, i) => {
    const answer = res.answers[`q${i}`];
    if (answer?.type === 'score') {
      scored.set(v.video_id, [{ score: answer.score, model: res.model }]);
    }
  });
  if (scored.size === 0) throw new Error('OpenRouter decisions returned no usable scores.');
  return scored;
}

async function loadCachedScores(
  userId: string,
  videoIds: string[],
): Promise<Map<string, JevScoreEntry>> {
  if (videoIds.length === 0) return new Map();
  const client = await getDb();
  try {
    const { rows } = await client.query<{ video_id: string; interest_score: number; model: string }>(
      `SELECT video_id, interest_score, model
       FROM jev_video_scores
       WHERE user_id = $1
         AND video_id = ANY($2)
         AND created_at > $3`,
      [userId, videoIds, Math.floor(Date.now() / 1000) - SCORE_TTL_SECONDS],
    );
    return new Map(rows.map(r => [r.video_id, { score: Number(r.interest_score), model: r.model }]));
  } finally {
    client.release();
  }
}

async function persistScores(
  userId: string,
  scored: Map<string, JevScoreEntry[]>,
): Promise<void> {
  if (scored.size === 0) return;
  const client = await getDb();
  try {
    const now = Math.floor(Date.now() / 1000);
    const values: unknown[] = [userId, now];
    const tuples: string[] = [];
    let p = 3;
    for (const [videoId, entries] of scored) {
      for (const e of entries) {
        tuples.push(`($1, $${p}, $${p + 1}, $${p + 2}, $2)`);
        values.push(videoId, e.score, e.model);
        p += 3;
      }
    }
    await client.query(
      `INSERT INTO jev_video_scores (user_id, video_id, interest_score, model, created_at)
       VALUES ${tuples.join(', ')}
       ON CONFLICT (user_id, video_id) DO UPDATE SET
         interest_score = excluded.interest_score,
         model = excluded.model,
         created_at = excluded.created_at`,
      values,
    );
  } finally {
    client.release();
  }
}
