/**
 * TAV-6: Basic Metrics — read-only query layer over interaction data already
 * stored by the summarizer (summaries) and chat (chat_messages) features.
 */

import { getDb } from './db';

// ----- types -----------------------------------------------------------------

export interface ChannelInteraction {
  channel_id: string;
  title: string;
  thumbnail_url: string | null;
  handle: string | null;
  summaries: number;
  chats: number;
  total: number;
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
  last_interaction: number | null;
}

export interface TopicCount {
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

export async function topChannelsByInteraction(limit = 10): Promise<ChannelInteraction[]> {
  const client = await getDb();
  try {
    const { rows } = await client.query<ChannelInteraction>(
      `SELECT
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
      ORDER BY total DESC, summaries DESC, c.title ASC
      LIMIT $1`,
      [limit],
    );
    return rows;
  } finally {
    client.release();
  }
}

export async function topVideosByInteraction(limit = 10): Promise<VideoInteraction[]> {
  const client = await getDb();
  try {
    const { rows } = await client.query(
      `SELECT
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
      ORDER BY total DESC, summaries DESC, v.title ASC
      LIMIT $1`,
      [limit],
    );
    return rows.map((r: any) => ({
      ...r,
      last_interaction: r.last_interaction ?? null,
    })) as VideoInteraction[];
  } finally {
    client.release();
  }
}

export async function topTopicsByInteraction(limit = 10): Promise<TopicCount[]> {
  const client = await getDb();
  try {
    // Per-channel interaction totals
    const { rows: channelTotals } = await client.query(
      `SELECT c.channel_id,
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
      WHERE (COALESCE(s.cnt, 0) + COALESCE(ch.cnt, 0)) > 0`,
    );
    const totalMap = new Map<string, number>();
    for (const r of channelTotals as { channel_id: string; total: string | number }[]) {
      totalMap.set(r.channel_id, Number(r.total));
    }

    const { rows: folderRows } = await client.query(
      `SELECT cf.folder_id AS id, f.name, f.color, cf.channel_id
       FROM channel_folders cf
       JOIN folders f ON f.id = cf.folder_id`,
    );
    const { rows: tagRows } = await client.query(
      `SELECT ct.tag_id AS id, t.name, t.color, ct.channel_id
       FROM channel_tags ct
       JOIN tags t ON t.id = ct.tag_id`,
    );

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

    for (const f of folderRows as { id: string; name: string; color: string | null; channel_id: string }[]) {
      bump(`folder:${f.id}`, f.name, f.color, 'folder', f.channel_id);
    }
    for (const t of tagRows as { id: string; name: string; color: string | null; channel_id: string }[]) {
      bump(`tag:${t.id}`, t.name, t.color, 'tag', t.channel_id);
    }

    // Untagged bucket
    let untaggedTotal = 0;
    for (const [channelId, total] of totalMap) {
      if (!seenChannels.has(channelId)) untaggedTotal += total;
    }
    if (untaggedTotal > 0) {
      topicMap.set('untagged', { id: 'untagged', name: 'Untagged', color: null, kind: 'untagged', total: untaggedTotal });
    }

    return [...topicMap.values()].sort((a, b) => b.total - a.total).slice(0, limit);
  } finally {
    client.release();
  }
}

export async function metricsSummary(): Promise<MetricsSummary> {
  const client = await getDb();
  try {
    const one = async (sql: string): Promise<number> => {
      const { rows } = await client.query(sql);
      return Number(rows[0].n);
    };

    const total_channels = await one(`SELECT COUNT(DISTINCT v.channel_id) AS n
                                      FROM summaries sm JOIN videos v ON v.video_id = sm.video_id`);
    const total_videos_cached = await one(`SELECT COUNT(DISTINCT video_id) AS n
                                            FROM (SELECT video_id FROM summaries
                                                  UNION
                                                  SELECT video_id FROM chat_messages WHERE role = 'user') AS t`);
    const total_summaries = await one('SELECT COUNT(*) AS n FROM summaries');
    const total_chats = await one(`SELECT COUNT(*) AS n FROM chat_messages WHERE role = 'user'`);

    return {
      total_channels,
      total_videos_cached,
      total_summaries,
      total_chats,
      total_interactions: total_summaries + total_chats,
    };
  } finally {
    client.release();
  }
}

export async function getMetrics(): Promise<MetricsResult> {
  const [summary, top_channels, top_videos, top_topics] = await Promise.all([
    metricsSummary(),
    topChannelsByInteraction(10),
    topVideosByInteraction(10),
    topTopicsByInteraction(10),
  ]);
  return { summary, top_channels, top_videos, top_topics };
}
