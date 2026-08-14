/**
 * Sync orchestrator — pulls subscriptions from YouTube, enriches with channel
 * details, classifies music, and writes everything into the Postgres DB.
 *
 * Idempotent: re-running is a no-op for unchanged channels and only updates
 * the rows that actually changed.
 */

import { fetchChannels, fetchLikedVideos, fetchChannelUploadsRss, youtubeClientWithToken, type RssVideoEntry } from './youtube';
import { getValidAccessToken } from './tokens';
import { recordSyncFinish, recordSyncStart, upsertChannels, listRecentlySyncedChannelIds } from './repo';
import { classifyMusic } from './music-classifier';
import { recordLikedVideos, upsertVideosFromRss } from './video-repo';
import type { ChannelRow } from './types';
import type { youtube_v3 } from 'googleapis';

/** Skip fetching channel details for channels synced within this window. */
const SYNC_SKIP_SECONDS = 3600;

/** Max concurrent RSS feed fetches. Each is a free, unauthenticated HTTP
 *  request with a 10s timeout. 10 is conservative — YouTube's CDN can handle
 *  it easily and it keeps us from opening 200 sockets at once. */
const RSS_CONCURRENCY = 10;

export interface SyncResult {
  seen: number;
  new: number;
  updated: number;
  /** Total liked videos pulled from YouTube during this sync. */
  likesSynced: number;
  /** New `video_likes` rows actually inserted (re-synced videos are skipped). */
  likesInserted: number;
  /** Total RSS video entries fetched across all channels. */
  videosSynced: number;
  /** New `videos` rows actually inserted by the RSS sync. */
  videosInserted: number;
  errors: string[];
}

export async function syncSubscriptions(): Promise<SyncResult> {
  const runId = await recordSyncStart();
  const result: SyncResult = { seen: 0, new: 0, updated: 0, likesSynced: 0, likesInserted: 0, videosSynced: 0, videosInserted: 0, errors: [] };
  try {
    const accessToken = await getValidAccessToken();
    const yt = youtubeClientWithToken(accessToken);

    // --- Pipelined subscription fetch + channel detail fetch ----------------
    // Walk subscription pages sequentially (nextPageToken is inherently serial),
    // but kick off fetchChannels for each page's channel IDs as soon as the
    // page arrives — those API calls run in parallel while the next subscription
    // page is being fetched. We also skip channel details for channels synced
    // within SYNC_SKIP_SECONDS to save API quota on repeat syncs.
    const recentlySynced = await listRecentlySyncedChannelIds(SYNC_SKIP_SECONDS);

    const allSubs: youtube_v3.Schema$Subscription[] = [];
    const channelDetailPromises: Promise<youtube_v3.Schema$Channel[]>[] = [];
    let pageToken: string | undefined;

    do {
      const res = await yt.subscriptions.list({
        part: ['snippet', 'contentDetails'],
        mine: true,
        maxResults: 50,
        pageToken,
        order: 'alphabetical',
      });
      const items = res.data.items ?? [];
      allSubs.push(...items);

      // Extract channel IDs from this page and start fetching details for
      // the ones we don't already have fresh data for.
      const pageIds = items
        .map(s => s.snippet?.resourceId?.channelId)
        .filter((x): x is string => Boolean(x));
      const staleIds = pageIds.filter(id => !recentlySynced.has(id));
      if (staleIds.length > 0) {
        channelDetailPromises.push(fetchChannels(accessToken, staleIds));
      }

      pageToken = res.data.nextPageToken ?? undefined;
    } while (pageToken);

    result.seen = allSubs.length;

    // Await all channel detail fetches (they've been running in parallel).
    const channelResults = await Promise.all(channelDetailPromises);
    const channelById = new Map<string, youtube_v3.Schema$Channel>();
    for (const batch of channelResults) {
      for (const ch of batch) {
        if (ch.id) channelById.set(ch.id, ch);
      }
    }

    // --- Build ChannelRow[] for batch upsert --------------------------------
    const now = Math.floor(Date.now() / 1000);
    const rows: ChannelRow[] = allSubs.map(sub => {
      const channelId = sub.snippet?.resourceId?.channelId;
      // channelId is always present here because we filtered earlier, but TS
      // doesn't know that — fall back to an empty string to satisfy the type.
      const cid = channelId ?? '';
      const ch = channelById.get(cid);
      const fallbackTitle = sub.snippet?.title ?? undefined;
      const cls = classifyMusic(ch, fallbackTitle);

      const row: ChannelRow = {
        channel_id: cid,
        title: ch?.snippet?.title ?? fallbackTitle ?? '(unknown)',
        handle: ch?.snippet?.title?.startsWith('@') ? ch.snippet.title : extractHandle(ch),
        description: ch?.snippet?.description ?? null,
        thumbnail_url: pickBestThumb(ch?.snippet?.thumbnails),
        subscriber_count: numeric(ch?.statistics?.subscriberCount),
        video_count: numeric(ch?.statistics?.videoCount),
        country: ch?.snippet?.country ?? null,
        custom_url: ch?.snippet?.customUrl ?? null,
        music_flag: cls.flag,
        music_score: cls.score,
        hidden: 0,
        notes: null,
        subscribed_at: parseIsoDate(sub.snippet?.publishedAt),
        synced_at: now,
        created_at: now,
        updated_at: now,
        topic_categories: jsonString(ch?.topicDetails?.topicCategories ?? null),
        banner_image_url: ch?.brandingSettings?.image?.bannerImageUrl ?? null,
        branding_keywords: jsonString(ch?.brandingSettings?.channel?.keywords ?? null),
      };
      return row;
    }).filter(r => r.channel_id !== '');

    // --- Batch upsert: single query instead of N×(SELECT+INSERT/UPDATE) ------
    const { created, updated } = await upsertChannels(rows);
    result.new = created;
    result.updated = updated;

    // --- RSS video sync: fetch recent uploads for all channels in parallel ---
    // Each channel's RSS feed is free and unauthenticated. We fetch them with
    // bounded concurrency (RSS_CONCURRENCY) so we don't open 200 sockets at
    // once. All entries are collected and upserted in a single batch query —
    // no per-video DB round-trips. API enrichment (duration, tags, category)
    // is skipped here to avoid burning quota; it happens lazily when the user
    // visits a channel page or summarizes a video.
    try {
      const channelIds = rows.map(r => r.channel_id);
      const rssEntries = await fetchAllRssFeeds(channelIds, RSS_CONCURRENCY);
      result.videosSynced = rssEntries.length;
      if (rssEntries.length > 0) {
        const { inserted } = await upsertVideosFromRss(rssEntries);
        result.videosInserted = inserted;
      }
    } catch (err) {
      result.errors.push(`RSS video sync: ${err instanceof Error ? err.message : String(err)}`);
    }

    // TAV-41: also pull the user's liked videos. Liking is independent of
    // subscribing — a user can like a video from a channel they don't
    // subscribe to. recordLikedVideos runs the whole batch in a single
    // transaction so we don't acquire/release the pg pool once per row.
    // Failures here are non-fatal: a quota blip on this endpoint shouldn't
    // invalidate the subscription sync we already completed.
    try {
      const likes = await fetchLikedVideos(accessToken, 100);
      if (likes.length > 0) {
        const likedAt = Math.floor(Date.now() / 1000);
        const { inserted, skipped } = await recordLikedVideos(
          likes.map(v => ({
            video_id: v.video_id,
            channel_id: v.channel_id,
            channel_title: v.channel_title,
            title: v.title,
            description: v.description,
            thumbnail_url: v.thumbnail_url,
            duration_seconds: v.duration_seconds,
            published_at: v.published_at,
            liked_at: likedAt,
          })),
        );
        result.likesSynced = likes.length;
        result.likesInserted = inserted;
        // `skipped` is just re-syncs of already-known likes — not an error.
        void skipped;
      }
    } catch (err) {
      result.errors.push(`Liked-videos sync: ${err instanceof Error ? err.message : String(err)}`);
    }

    await recordSyncFinish(runId, { status: 'success', seen: result.seen, new: result.new, updated: result.updated });
    return result;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    result.errors.push(msg);
    await recordSyncFinish(runId, { status: 'error', seen: result.seen, new: result.new, updated: result.updated, error: msg });
    return result;
  }
}

// ----- helpers --------------------------------------------------------------

function extractHandle(ch: { snippet?: { customUrl?: string | null } } | undefined): string | null {
  const cu = ch?.snippet?.customUrl;
  if (!cu) return null;
  return cu.startsWith('@') ? cu : `@${cu}`;
}

function pickBestThumb(thumbs: youtube_v3.Schema$ThumbnailDetails | null | undefined): string | null {
  if (!thumbs) return null;
  // Prefer medium → high → default.
  return thumbs.medium?.url ?? thumbs.high?.url ?? thumbs.default?.url ?? null;
}

function numeric(v: string | null | undefined): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * JSON-encode an array-or-string value that arrives from the YouTube API.
 * Returns null when the input is null/empty so the column stays clean.
 */
function jsonString(v: string[] | string | null | undefined): string | null {
  if (v == null) return null;
  if (typeof v === 'string') return v.trim() === '' ? null : JSON.stringify(v.trim());
  if (Array.isArray(v)) return v.length === 0 ? null : JSON.stringify(v);
  return null;
}

function parseIsoDate(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
}

/**
 * Fetch RSS feeds for all channel IDs with bounded concurrency.
 * Returns a flat array of entries, each tagged with its channelId.
 * Failed feeds (network errors, empty feeds, HTTP errors) are silently
 * skipped — RSS is best-effort, and a single channel's feed being down
 * shouldn't block the sync.
 */
async function fetchAllRssFeeds(
  channelIds: string[],
  concurrency: number,
): Promise<(RssVideoEntry & { videoId: string; channelId: string })[]> {
  const results: (RssVideoEntry & { videoId: string; channelId: string })[] = [];

  for (let i = 0; i < channelIds.length; i += concurrency) {
    const batch = channelIds.slice(i, i + concurrency);
    const settled = await Promise.allSettled(
      batch.map(async (channelId) => {
        const entries = await fetchChannelUploadsRss(channelId, 15);
        if (!entries) return [];
        return entries.map(e => ({ ...e, videoId: e.videoId, channelId }));
      }),
    );
    for (const s of settled) {
      if (s.status === 'fulfilled') results.push(...s.value);
    }
  }

  return results;
}
