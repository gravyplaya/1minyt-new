/**
 * Video sync — pulls recent uploads for a channel and caches them as `videos`
 * rows so the summary UI (and Chat-with-Video, TAV-3) can list them without
 * hitting the API each time.
 *
 * Idempotent: re-running only updates rows whose YouTube-side metadata changed.
 */

import type { youtube_v3 } from 'googleapis';
import { fetchChannelUploads, fetchVideoDetails } from './youtube';
import { getValidAccessToken } from './tokens';
import { getChannel } from './repo';
import { upsertVideo } from './video-repo';
import { parseIso8601Duration } from '../app/_lib/format';

export interface VideoSyncResult {
  channelId: string;
  fetched: number;
  errors: string[];
}

/**
 * Refresh recent uploads for a channel.
 */
export async function syncChannelVideos(channelId: string, max = 30): Promise<VideoSyncResult> {
  const result: VideoSyncResult = { channelId, fetched: 0, errors: [] };
  const channel = await getChannel(channelId);
  if (!channel) {
    result.errors.push('Channel not found in local DB');
    return result;
  }

  try {
    const accessToken = await getValidAccessToken();
    const items = await fetchChannelUploads(accessToken, channelId, max);
    result.fetched = items.length;
    if (items.length === 0) return result;

    const videoIds = items
      .map(it => it.contentDetails?.videoId)
      .filter((x): x is string => Boolean(x));

    // Enrich with duration + better thumbnails from videos.list.
    const details = await fetchVideoDetails(accessToken, videoIds);
    const detailById = new Map<string, youtube_v3.Schema$Video>();
    for (const v of details) if (v.id) detailById.set(v.id, v);

    for (const item of items) {
      const videoId = item.contentDetails?.videoId;
      if (!videoId) continue;
      const det = detailById.get(videoId);
      const snip = det?.snippet ?? item.snippet;
      if (!snip) continue;

      await upsertVideo({
        video_id: videoId,
        channel_id: channelId,
        title: snip.title ?? '(untitled)',
        description: snip.description ?? null,
        thumbnail_url: pickBestThumb(det?.snippet?.thumbnails ?? snip.thumbnails),
        duration_seconds: parseIso8601Duration(det?.contentDetails?.duration ?? null),
        published_at: parseIsoDate(snip.publishedAt),
      });
    }
  } catch (err) {
    result.errors.push(err instanceof Error ? err.message : String(err));
  }

  return result;
}

// ----- helpers ---------------------------------------------------------------

function pickBestThumb(thumbs: youtube_v3.Schema$ThumbnailDetails | null | undefined): string | null {
  if (!thumbs) return null;
  return thumbs.medium?.url ?? thumbs.high?.url ?? thumbs.standard?.url ?? thumbs.default?.url ?? null;
}

function parseIsoDate(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
}
