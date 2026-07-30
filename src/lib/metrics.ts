/**
 * TAV-6: Basic Metrics — read-only query layer over interaction data already
 * stored by the summarizer (summaries) and chat (chat_messages) features.
 *
 * No new tables or data collection. Every function here is a cheap SQLite
 * aggregate over existing rows. The dashboard at /metrics consumes the union
 * of these results.
 */

import { getDb } from './db';

// ----- types -----------------------------------------------------------------

export interface ChannelInteraction {
  channel_id: string;
  title: string;
  thumbnail_url: string | null;
  handle: string | null;
  summaries: number;      // number of summaries generated for this channel
  chats: number;         // number of user-side chat messages for this channel
  total: number;         // summaries + chats — the combined interaction score
}

export interface VideoInteraction {
  video_id: string;
  title: string;
  thumbnail_url: string | null;
  channel_id: string;
  channel_title: string;
  summaries: number;
  chats: number;
  total: number;
  last_interaction: number | null;  // unix seconds of most recent summary or chat
}

export interface TopicCount {
  /** folder or tag id (or 'untagged' for the catch-all bucket) */
  id: string;
  name: string;
  color: string | null;
  kind: 'folder' | 'tag' | 'untagged';
  total: number;
}

export interface MetricsSummary {
  total_channels: number;
  total_videos_cached: number;
  total_summaries: number;
  total_chats: number;
  total_interactions: number;
}

export interface MetricsResult {
  summary: MetricsSummary;
  top_channels: ChannelInteraction[];
  top_videos: VideoInteraction[];
  top_topics: TopicCount[];
}

// ----- queries ---------------------------------------------------------------

/**
 * Top channels by combined interaction (summaries + user chat messages).
 * A channel ranks higher when you summarize its videos more often and ask
 * more questions about those videos.
 */
export function topChannelsByInteraction(limit = 10): ChannelInteraction[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT
      c.channel_id,
      c.title,
      c.thumbnail_url,
      c.handle,
      COALESCE(s.cnt, 0) AS summaries,
      COALESCE(ch.cnt, 0) AS chats,
      (COALESCE(s.cnt, 0) + COALESCE(ch.cnt, 0)) AS total
    FROM channels c
    LEFT JOIN (
      SELECT v.channel_id, COUNT(*) AS cnt
      FROM summaries sm
      JOIN videos v ON v.video_id = sm.video_id
      GROUP BY v.channel_id
    ) s ON s.channel_id = c.channel_id
    LEFT JOIN (
      SELECT v.channel_id, COUNT(*) AS cnt
      FROM chat_messages cm
      JOIN videos v ON v.video_id = cm.video_id
      WHERE cm.role = 'user'
      GROUP BY v.channel_id
    ) ch ON ch.channel_id = c.channel_id
    WHERE (COALESCE(s.cnt, 0) + COALESCE(ch.cnt, 0)) > 0
    ORDER BY total DESC, summaries DESC, c.title COLLATE NOCASE ASC
    LIMIT ?
  `).all(limit) as ChannelInteraction[];
  return rows;
}

/**
 * Most-summarized / most-chatted videos across all channels.
 */
export function topVideosByInteraction(limit = 10): VideoInteraction[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT
      v.video_id,
      v.title,
      v.thumbnail_url,
      v.channel_id,
      c.title AS channel_title,
      COALESCE(s.cnt, 0) AS summaries,
      COALESCE(ch.cnt, 0) AS chats,
      (COALESCE(s.cnt, 0) + COALESCE(ch.cnt, 0)) AS total,
      COALESCE(s.last_ts, ch.last_ts) AS last_interaction
    FROM videos v
    JOIN channels c ON c.channel_id = v.channel_id
    LEFT JOIN (
      SELECT video_id, COUNT(*) AS cnt, MAX(created_at) AS last_ts
      FROM summaries
      GROUP BY video_id
    ) s ON s.video_id = v.video_id
    LEFT JOIN (
      SELECT video_id, COUNT(*) AS cnt, MAX(created_at) AS last_ts
      FROM chat_messages
      WHERE role = 'user'
      GROUP BY video_id
    ) ch ON ch.video_id = v.video_id
    WHERE (COALESCE(s.cnt, 0) + COALESCE(ch.cnt, 0)) > 0
    ORDER BY total DESC, summaries DESC, v.title COLLATE NOCASE ASC
    LIMIT ?
  `).all(limit) as (VideoInteraction & { last_interaction: number | null })[];
  return rows.map(r => ({
    ...r,
    last_interaction: r.last_interaction ?? null,
  }));
}

/**
 * Topics the user engages with most, derived from folder/tag assignments on
 * channels they interact with. Interactions flow through the channel — a video
 * belongs to a channel, a channel belongs to folders and tags — so we count
 * each channel's interaction total against every folder and tag that channel
 * is a member of. Channels with no folder or tag assignment roll up into an
 * "untagged" bucket.
 */
export function topTopicsByInteraction(limit = 10): TopicCount[] {
  const db = getDb();

  // Per-channel interaction totals (same logic as topChannelsByInteraction,
  // but we only need the channel_id + total columns here).
  const channelTotals = db.prepare(`
    SELECT c.channel_id,
           (COALESCE(s.cnt, 0) + COALESCE(ch.cnt, 0)) AS total
    FROM channels c
    LEFT JOIN (
      SELECT v.channel_id, COUNT(*) AS cnt
      FROM summaries sm JOIN videos v ON v.video_id = sm.video_id
      GROUP BY v.channel_id
    ) s ON s.channel_id = c.channel_id
    LEFT JOIN (
      SELECT v.channel_id, COUNT(*) AS cnt
      FROM chat_messages cm JOIN videos v ON v.video_id = cm.video_id
      WHERE cm.role = 'user'
      GROUP BY v.channel_id
    ) ch ON ch.channel_id = c.channel_id
    WHERE (COALESCE(s.cnt, 0) + COALESCE(ch.cnt, 0)) > 0
  `).all() as { channel_id: string; total: number }[];

  const totalMap = new Map(channelTotals.map(r => [r.channel_id, r.total]));

  // Folder rollup.
  const folderRows = db.prepare(`
    SELECT cf.folder_id AS id, f.name, f.color, cf.channel_id
    FROM channel_folders cf
    JOIN folders f ON f.id = cf.folder_id
  `).all() as { id: string; name: string; color: string | null; channel_id: string }[];

  // Tag rollup.
  const tagRows = db.prepare(`
    SELECT ct.tag_id AS id, t.name, t.color, ct.channel_id
    FROM channel_tags ct
    JOIN tags t ON t.id = ct.tag_id
  `).all() as { id: string; name: string; color: string | null; channel_id: string }[];

  const topicMap = new Map<string, TopicCount>();
  const seenChannels = new Set<string>();

  function bump(key: string, name: string, color: string | null, kind: TopicCount['kind'], channelId: string) {
    const t = totalMap.get(channelId);
    if (!t) return;
    seenChannels.add(channelId);
    const existing = topicMap.get(key);
    if (existing) {
      existing.total += t;
    } else {
      topicMap.set(key, { id: key, name, color, kind, total: t });
    }
  }

  for (const f of folderRows) bump(`folder:${f.id}`, f.name, f.color, 'folder', f.channel_id);
  for (const t of tagRows) bump(`tag:${t.id}`, t.name, t.color, 'tag', t.channel_id);

  // Untagged bucket: channels with interactions but no folder or tag assignment.
  let untaggedTotal = 0;
  for (const [channelId, total] of totalMap) {
    if (!seenChannels.has(channelId)) untaggedTotal += total;
  }
  if (untaggedTotal > 0) {
    topicMap.set('untagged', { id: 'untagged', name: 'Untagged', color: null, kind: 'untagged', total: untaggedTotal });
  }

  return [...topicMap.values()]
    .sort((a, b) => b.total - a.total)
    .slice(0, limit);
}

/** Headline numbers for the dashboard header. */
export function metricsSummary(): MetricsSummary {
  const db = getDb();
  const one = (sql: string) => (db.prepare(sql).get() as { n: number }).n;

  const total_channels = one(`SELECT COUNT(DISTINCT v.channel_id) AS n
                              FROM summaries sm JOIN videos v ON v.video_id = sm.video_id`);
  const total_videos_cached = one(`SELECT COUNT(DISTINCT video_id) AS n
                                   FROM (SELECT video_id FROM summaries
                                         UNION
                                         SELECT video_id FROM chat_messages WHERE role = 'user')`);
  const total_summaries = one('SELECT COUNT(*) AS n FROM summaries');
  const total_chats = one(`SELECT COUNT(*) AS n FROM chat_messages WHERE role = 'user'`);

  return {
    total_channels,
    total_videos_cached,
    total_summaries,
    total_chats,
    total_interactions: total_summaries + total_chats,
  };
}

/** Convenience: all the dashboard data in one call. */
export function getMetrics(): MetricsResult {
  return {
    summary: metricsSummary(),
    top_channels: topChannelsByInteraction(10),
    top_videos: topVideosByInteraction(10),
    top_topics: topTopicsByInteraction(10),
  };
}
