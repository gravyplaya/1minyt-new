/**
 * Channel dossier orchestration (TAV-64, option G).
 *
 * A dossier is a channel's "memory layer": an LLM distillation of every cached
 * per-video summary into a long-term profile. The library chat injects it into
 * the system prompt when the chat is scoped to that channel, and the Deep
 * Research agent can pull it via the `get_channel_profile` tool.
 *
 * Map-reduce: the per-video summaries already exist (TAV-4/TAV-8); this adds
 * the one reduce call. Requires at least 2 cached summaries — with fewer, a
 * dossier would just restate one video's TL;DR.
 */

import { getChannel } from './repo';
import { listVideosByChannel, latestSummariesByVideoIds } from './video-repo';
import { synthesizeChannelDossier } from './summarize';
import { getDossier, saveDossier } from './library-chat-repo';
import type { ChannelDossier } from './types';

/** Minimum cached summaries before a dossier is worth generating. */
const MIN_SUMMARIES = 2;

/**
 * Generate (or regenerate) the dossier for one channel from its cached
 * summaries. Returns the saved dossier.
 */
export async function generateChannelDossier(channelId: string): Promise<ChannelDossier> {
  const channel = await getChannel(channelId);
  if (!channel) throw new Error('Channel not found.');

  const videos = await listVideosByChannel(channelId, 100);
  if (videos.length === 0) {
    throw new Error('No cached videos for this channel. Refresh videos first.');
  }

  const summaryMap = await latestSummariesByVideoIds(videos.map(v => v.video_id));
  const inputs = videos
    .map(v => {
      const s = summaryMap.get(v.video_id);
      if (!s) return null;
      return { title: v.title, tldr: s.tldr, key_points: s.key_points, topics: s.topics };
    })
    .filter((x): x is { title: string; tldr: string; key_points: string[]; topics: string[] } => x !== null);

  if (inputs.length < MIN_SUMMARIES) {
    throw new Error(`Not enough cached summaries (found ${inputs.length}, need ${MIN_SUMMARIES}). Summarize more videos from this channel first.`);
  }

  const result = await synthesizeChannelDossier({
    channelTitle: channel.title,
    videoSummaries: inputs,
  });

  await saveDossier({
    channel_id: channelId,
    model: result.model,
    dossier: result.dossier,
    themes: result.themes,
    video_count: inputs.length,
    token_count: result.tokenCount,
  });

  const saved = await getDossier(channelId);
  if (!saved) throw new Error('Dossier was saved but could not be read back.');
  return saved;
}

/** Read a channel's dossier, or null when it hasn't been generated yet. */
export async function loadDossier(channelId: string): Promise<ChannelDossier | null> {
  return getDossier(channelId);
}
