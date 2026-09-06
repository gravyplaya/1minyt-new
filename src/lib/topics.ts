/**
 * Topic mind map (TAV-66, option I).
 *
 * Builds a topic graph live from the cached summaries' LLM topic tags
 * (summaries.topics, extracted at summarize time — TAV-8). No extraction pass
 * here: the tags already exist, so the graph is always as fresh as the last
 * summarize run and costs zero tokens to build.
 *
 * Structure:
 *  - nodes: normalized topics, ranked by how many summarized videos carry them
 *  - edges: co-occurrence — two topics linked once they appear in the same
 *    video, weighted by how many videos carry both
 *
 * Capped (top MAX_TOPICS topics, top MAX_EDGES edges) to keep the serialized
 * payload small enough to hand straight to the client-side graph renderer.
 */

import { query } from './db';
import type { TopicEdge, TopicGraph, TopicNode } from './types';

const MAX_TOPICS = 40;
const MAX_EDGES = 150;
const VIDEOS_PER_NODE = 8;

/**
 * Build the topic graph from all cached summaries.
 */
export async function buildTopicGraph(): Promise<TopicGraph> {
  const { rows } = await query(
    `SELECT s.topics, v.video_id, v.title, v.channel_id, c.title AS channel_title
     FROM summaries s
     JOIN videos v   ON v.video_id = s.video_id
     JOIN channels c ON c.channel_id = v.channel_id`,
  );

  /** topic → videos carrying it */
  const byTopic = new Map<string, {
    videos: Map<string, { videoId: string; title: string; channelId: string; channelTitle: string }>;
  }>();

  /** "a\u0000b" sorted pair → shared video count */
  const pairCount = new Map<string, { a: string; b: string; weight: number }>();

  let summarizedVideos = 0;

  for (const row of rows as Array<{ topics: string | null; video_id: string; title: string; channel_id: string; channel_title: string }>) {
    if (!row.topics) continue;
    let topics: string[];
    try {
      const parsed = JSON.parse(row.topics) as unknown;
      topics = Array.isArray(parsed) ? parsed.map(String).map(s => s.trim().toLowerCase()).filter(Boolean) : [];
    } catch {
      continue;
    }
    // De-duplicate within one video so weights don't inflate.
    const unique = Array.from(new Set(topics));
    if (unique.length === 0) continue;
    summarizedVideos += 1;

    for (const t of unique) {
      let entry = byTopic.get(t);
      if (!entry) {
        entry = { videos: new Map() };
        byTopic.set(t, entry);
      }
      if (!entry.videos.has(row.video_id)) {
        entry.videos.set(row.video_id, {
          videoId: row.video_id,
          title: row.title,
          channelId: row.channel_id,
          channelTitle: row.channel_title,
        });
      }
    }

    for (let i = 0; i < unique.length; i++) {
      for (let j = i + 1; j < unique.length; j++) {
        const [a, b] = unique[i] < unique[j] ? [unique[i], unique[j]] : [unique[j], unique[i]];
        const key = `${a}\u0000${b}`;
        const existing = pairCount.get(key);
        if (existing) {
          existing.weight += 1;
        } else {
          pairCount.set(key, { a, b, weight: 1 });
        }
      }
    }
  }

  // Keep only the strongest topics — the long tail turns the graph into soup.
  const topTopics = Array.from(byTopic.entries())
    .sort((x, y) => y[1].videos.size - x[1].videos.size)
    .slice(0, MAX_TOPICS);
  const keep = new Set(topTopics.map(([t]) => t));

  const nodes: TopicNode[] = topTopics.map(([topic, entry]) => {
    const all = Array.from(entry.videos.values());
    const channels = new Set(all.map(v => v.channelId));
    const sample = all
      .sort((x, y) => (x.title < y.title ? -1 : 1))
      .slice(0, VIDEOS_PER_NODE);
    return {
      topic,
      videoCount: all.length,
      channelCount: channels.size,
      videos: sample,
    };
  });

  const edges: TopicEdge[] = Array.from(pairCount.values())
    .filter(e => keep.has(e.a) && keep.has(e.b))
    .sort((x, y) => y.weight - x.weight)
    .slice(0, MAX_EDGES)
    .map(e => ({ a: e.a, b: e.b, weight: e.weight }));

  return { nodes, edges, summarizedVideos, generatedAt: Math.floor(Date.now() / 1000) };
}
