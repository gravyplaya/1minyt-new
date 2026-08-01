/**
 * Video sync — pulls recent uploads for a channel and caches them as `videos`
 * rows so the summary UI (and Chat-with-Video, TAV-3) can list them without
 * hitting the API each time.
 *
 * Idempotent: re-running only updates rows whose YouTube-side metadata changed.
 *
 * TAV-18: sync is now RSS-first. We poll the channel's free, unauthenticated
 * RSS feed to detect new video ids, then call the Data API (`videos.list`) only
 * for the ids we don't already have cached — to enrich them with duration,
 * tags, category, and live-stream details. If RSS is unavailable we fall back
 * to the original `playlistItems.list` path so existing sync behaviour is
 * preserved for every channel.
 */

import type { youtube_v3 } from 'googleapis';
import { fetchChannelUploads, fetchChannelUploadsRss, fetchVideoDetails } from './youtube';
import { getValidAccessToken } from './tokens';
import { getChannel } from './repo';
import { upsertVideo } from './video-repo';
import { listVideoIdsByChannel } from './video-repo';
import { parseIso8601Duration } from '../app/_lib/format';

export interface VideoSyncResult {
  channelId: string;
  fetched: number;
  errors: string[];
  /** TAV-18: how many of the fetched videos came from the free RSS feed. */
  rss: boolean;
}

/**
 * Refresh recent uploads for a channel.
 *
 * RSS-first path:
 *   1. Fetch the channel's RSS feed (free, no auth).
 *   2. Diff the feed's video ids against what we already have cached.
 *   3. Write a baseline row for every feed entry (so new videos appear
 *      immediately), then enrich only the *new* ids via `videos.list` to fill
 *      in duration, tags, category, and live-stream details.
 *
 * API fallback path (used when RSS returns null — feed down, parse empty, etc.):
 *   - The original `fetchChannelUploads` + `fetchVideoDetails` flow, unchanged.
 */
export async function syncChannelVideos(channelId: string, max = 30): Promise<VideoSyncResult> {
  const result: VideoSyncResult = { channelId, fetched: 0, errors: [], rss: false };
  const channel = await getChannel(channelId);
  if (!channel) {
    result.errors.push('Channel not found in local DB');
    return result;
  }

  try {
    const accessToken = await getValidAccessToken();

    // 1. Try the free RSS feed for new-video detection.
    const rssEntries = await fetchChannelUploadsRss(channelId, Math.min(max, 15));
    if (rssEntries && rssEntries.length > 0) {
      result.rss = true;
      result.fetched = rssEntries.length;

      // Snapshot the ids we already have so we only pay for enrichment on new ones.
      const existingIds = await listVideoIdsByChannel(channelId);
      const newEntries = rssEntries.filter(e => !existingIds.has(e.videoId));

      // Write a baseline row for every feed entry first — this makes new videos
      // visible in the UI immediately, and refreshes title/description/thumbnail
      // for existing ones (RSS is a fine source for those fields).
      for (const entry of rssEntries) {
        await upsertVideo({
          video_id: entry.videoId,
          channel_id: channelId,
          title: entry.title || '(untitled)',
          description: entry.description,
          thumbnail_url: entry.thumbnailUrl,
          duration_seconds: null, // RSS doesn't expose duration; enriched below.
          published_at: entry.publishedAt,
          view_count: entry.viewCount,
          like_count: null,
          comment_count: null,
          favorite_count: null,
          tags: null,
          category_id: null,
          is_live: 0,
          live_streaming_details: null,
        });
      }

      if (newEntries.length === 0) return result;

      // Enrich only the new ids with duration, tags, category, stats, and live
      // details. This is the single API call the RSS-first path makes per channel.
      const newIds = newEntries.map(e => e.videoId);
      const details = await fetchVideoDetails(accessToken, newIds);
      const detailById = new Map<string, youtube_v3.Schema$Video>();
      for (const v of details) if (v.id) detailById.set(v.id, v);

      for (const entry of newEntries) {
        const det = detailById.get(entry.videoId);
        if (!det) continue;
        const snip = det.snippet;
        if (!snip) continue;

        await upsertVideo({
          video_id: entry.videoId,
          channel_id: channelId,
          title: snip.title ?? entry.title,
          description: snip.description ?? entry.description,
          thumbnail_url: pickBestThumb(snip.thumbnails) ?? entry.thumbnailUrl,
          duration_seconds: parseIso8601Duration(det.contentDetails?.duration ?? null),
          published_at: parseIsoDate(snip.publishedAt) ?? entry.publishedAt,
          view_count: numeric(det.statistics?.viewCount) ?? entry.viewCount,
          like_count: numeric(det.statistics?.likeCount),
          comment_count: numeric(det.statistics?.commentCount),
          favorite_count: numeric(det.statistics?.favoriteCount),
          tags: tagsToJson(det.snippet?.tags ?? null),
          category_id: numeric(det.snippet?.categoryId),
          is_live: det.liveStreamingDetails || det.snippet?.liveBroadcastContent === 'live' ? 1 : 0,
          live_streaming_details: det.liveStreamingDetails
            ? JSON.stringify(det.liveStreamingDetails)
            : null,
        });
      }
      return result;
    }

    // 2. RSS unavailable — fall back to the original API-only path.
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
        // TAV-17: persist previously-discarded fields from the videos.list response.
        view_count: numeric(det?.statistics?.viewCount),
        like_count: numeric(det?.statistics?.likeCount),
        comment_count: numeric(det?.statistics?.commentCount),
        favorite_count: numeric(det?.statistics?.favoriteCount),
        tags: tagsToJson(det?.snippet?.tags ?? null),
        category_id: numeric(det?.snippet?.categoryId),
        is_live: det?.liveStreamingDetails || det?.snippet?.liveBroadcastContent === 'live' ? 1 : 0,
        live_streaming_details: det?.liveStreamingDetails
          ? JSON.stringify(det.liveStreamingDetails)
          : null,
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

/**
 * YouTube API statistics and categoryId arrive as strings; coerce to a
 * nullable number. Tolerates null/undefined/empty.
 */
function numeric(v: string | null | undefined): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * JSON-encode snippet.tags (a string[]). Returns null for an empty/missing
 * array so the column stays clean for old rows.
 */
function tagsToJson(tags: string[] | null | undefined): string | null {
  if (!tags || tags.length === 0) return null;
  return JSON.stringify(tags);
}
