/**
 * TAV-67: Ingest a single arbitrary YouTube video by id.
 *
 * Promoted from the /watch page's private bestEffortFetchVideo (TAV-56) so the
 * paste-a-URL flow (TAV-67) and the /watch?v= ad-hoc fallback share one
 * implementation instead of duplicating the pipeline.
 *
 * Two data sources:
 *  1. Official Data API (connected users): `videos.list` by id (1 quota unit)
 *     — full snippet + contentDetails + statistics, so the row is born with
 *     real metadata (duration, stats, tags), unlike the catalog-hit path
 *     which stores nulls.
 *  2. Innertube (anonymous users): youtubei.js `getBasicInfo` — no OAuth, no
 *     quota, no API key. Covers most public videos; a client that gets
 *     bot-walled is retried on other clients before giving up.
 *     Also used as a fallback when the Data API call itself fails (quota
 *     blips, network) so a connected user's paste still succeeds.
 *
 * Either way we then ensure the channels row exists — for a channel new to
 * the library we insert a full ChannelRow when we have an access token
 * (thumbnail, handle, stats, music classification), otherwise the minimal
 * ensureChannelRow stub (the videos.channel_id FK just needs a row) — and
 * upsert the video. Idempotent — re-ingesting refreshes metadata and
 * preserves transcript/summary state via upsertVideo's COALESCE rules.
 */

import type { youtube_v3 } from 'googleapis';
import { fetchChannels, fetchVideoDetails } from './youtube';
import { ensureChannelRow, upsertVideo } from './video-repo';
import { getChannel, upsertChannel } from './repo';
import { classifyMusic } from './music-classifier';
import { getValidAccessToken } from './tokens';
import { getInnertube } from './innertube';
import type { ChannelRow } from './types';

/** Why an ingest failed — mapped to a friendly message by the action layer. */
export type IngestVideoReason = 'not-found' | 'api';

export interface IngestVideoResult {
  ok: boolean;
  videoId: string;
  channelId: string | null;
  /** Specific failure reason when ok is false. */
  reason?: IngestVideoReason;
  error?: string;
}

export async function ingestVideoById(videoId: string): Promise<IngestVideoResult> {
  // Connected users go through the official Data API; anonymous pasteers
  // (TAV-67: no sign-in) go straight to Innertube. A missing/invalid token
  // is not an error — it just picks the path.
  let accessToken: string | null = null;
  try {
    accessToken = await getValidAccessToken();
  } catch {
    accessToken = null;
  }

  if (!accessToken) {
    return ingestVideoViaInnertube(videoId);
  }

  const result = await ingestVideoViaDataApi(videoId, accessToken);
  // Quota blip / network error on the Data API path — the paste should still
  // succeed if Innertube can see the video. (Not-found is final: the video
  // really isn't resolvable via an authorized account either.)
  if (!result.ok && result.reason === 'api') {
    console.warn(
      `ingestVideoById: Data API failed for ${videoId} (${result.error}), falling back to Innertube.`,
    );
    return ingestVideoViaInnertube(videoId);
  }
  return result;
}

/** Official Data API path: `videos.list` by id with full metadata. */
async function ingestVideoViaDataApi(videoId: string, accessToken: string): Promise<IngestVideoResult> {
  let details: youtube_v3.Schema$Video[];
  try {
    details = await fetchVideoDetails(accessToken, [videoId]);
  } catch (err) {
    return {
      ok: false,
      videoId,
      channelId: null,
      reason: 'api',
      error: err instanceof Error ? err.message : String(err),
    };
  }

  const det = details[0];
  const snip = det?.snippet;
  // An empty items list means the id doesn't resolve: private, deleted, or wrong.
  if (!det || !snip) {
    return {
      ok: false,
      videoId,
      channelId: null,
      reason: 'not-found',
      error: 'Video not found — it may be private, deleted, or the ID is wrong.',
    };
  }

  const channelId = snip.channelId ?? null;

  try {
    await ensureChannelWithDetails(accessToken, channelId, snip.channelTitle ?? null);

    await upsertVideo({
      video_id: videoId,
      channel_id: channelId ?? 'unknown',
      title: snip.title ?? '(untitled)',
      description: snip.description ?? null,
      thumbnail_url:
        snip.thumbnails?.medium?.url ??
        snip.thumbnails?.high?.url ??
        snip.thumbnails?.default?.url ??
        null,
      duration_seconds: parseIsoDuration(det.contentDetails?.duration ?? null),
      published_at: parseIsoDate(snip.publishedAt),
      view_count: numeric(det.statistics?.viewCount),
      like_count: numeric(det.statistics?.likeCount),
      comment_count: numeric(det.statistics?.commentCount),
      favorite_count: numeric(det.statistics?.favoriteCount),
      tags: tagsToJson(snip.tags ?? null),
      category_id: numeric(snip.categoryId),
      is_live: det.liveStreamingDetails || snip.liveBroadcastContent === 'live' ? 1 : 0,
      live_streaming_details: det.liveStreamingDetails ? JSON.stringify(det.liveStreamingDetails) : null,
    });
  } catch (err) {
    return {
      ok: false,
      videoId,
      channelId,
      reason: 'api',
      error: err instanceof Error ? err.message : String(err),
    };
  }

  return { ok: true, videoId, channelId };
}

/**
 * Anonymous Innertube path (TAV-67): youtubei.js `getBasicInfo` — no OAuth, no
 * quota, no API key. Metadata is slightly thinner than the Data API path
 * (no publish date / comment count), which the columns happily accept as
 * null. The channel row is the minimal ensureChannelRow stub — good enough
 * for the FK and the channel page; a later subscription sync or connected
 * paste can enrich it.
 *
 * Client-retry chain (ANDROID → IOS → WEB): YouTube's bot check is
 * intermittent and client-specific — a request that parses to a shell with
 * no videoDetails (LOGIN_REQUIRED / UNPLAYABLE with empty basic_info) on one
 * client often succeeds on another. ANDROID leads for the same reason
 * transcript.ts uses it: it's the most bot-wall-resistant client. Only a
 * thrown "unavailable" (playability ERROR — deleted/private/wrong id) is
 * treated as definitively not found; anything else retries on the next
 * client before giving up with a bot-check error rather than a false
 * "not found".
 */
const INNERTUBE_INGEST_CLIENTS = ['ANDROID', 'IOS', 'WEB'] as const;

async function ingestVideoViaInnertube(videoId: string): Promise<IngestVideoResult> {
  let lastFailure = 'no attempts';

  for (const client of INNERTUBE_INGEST_CLIENTS) {
    let info;
    try {
      const yt = await getInnertube();
      info = await yt.getBasicInfo(videoId, { client });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // youtubei.js throws 'This video is unavailable' (InnertubeError) when
      // playability is ERROR — deleted, private, or a wrong id. Definitive
      // for every client; don't burn the retry chain on it.
      if (/unavailable/i.test(msg)) {
        return {
          ok: false,
          videoId,
          channelId: null,
          reason: 'not-found',
          error: 'Video not found — it may be private, deleted, or the ID is wrong.',
        };
      }
      // Network blip / parser hiccup — the next client may still get through.
      lastFailure = `${client}: ${msg}`;
      continue;
    }

    const b = info.basic_info;

    if (b.is_private) {
      return {
        ok: false,
        videoId,
        channelId: null,
        reason: 'not-found',
        error: 'Video not found — it may be private, deleted, or the ID is wrong.',
      };
    }

    // Usable = videoDetails actually populated. A bot-walled response parses
    // to a shell with no title (verified: TV/WEB under bot check) — retry the
    // next client instead of reporting "not found" for a video that exists.
    if (b.id && b.title) {
      const channelId = b.channel_id ?? b.channel?.id ?? null;
      const channelName = b.channel?.name ?? b.author ?? channelId;

      try {
        await ensureChannelRow(channelId, channelName ?? null);

        await upsertVideo({
          video_id: videoId,
          channel_id: channelId ?? 'unknown',
          title: b.title,
          description: b.short_description ?? null,
          thumbnail_url: pickInnertubeThumb(b.thumbnail),
          duration_seconds: finiteOrNull(b.duration),
          published_at: null,
          view_count: finiteOrNull(b.view_count),
          like_count: finiteOrNull(b.like_count),
          comment_count: null,
          favorite_count: null,
          tags: tagsToJson(b.tags ?? b.keywords ?? null),
          // basic_info.category is a display string ("Gaming"), not the numeric
          // category id the column expects — leave null rather than store garbage.
          category_id: null,
          is_live: b.is_live || b.is_live_content ? 1 : 0,
          live_streaming_details: null,
        });
      } catch (err) {
        return {
          ok: false,
          videoId,
          channelId,
          reason: 'api',
          error: err instanceof Error ? err.message : String(err),
        };
      }

      return { ok: true, videoId, channelId };
    }

    // Shell response (LOGIN_REQUIRED / UNPLAYABLE / empty videoDetails) for
    // THIS client — most likely the bot wall. Try the next client.
    lastFailure = `${client}: playability ${info.playability_status?.status ?? 'unknown'}, no video details`;
  }

  console.warn(`ingestVideoViaInnertube: all clients failed for ${videoId} (${lastFailure})`);
  return {
    ok: false,
    videoId,
    channelId: null,
    reason: 'api',
    error:
      'YouTube blocked the anonymous request (bot check). Try again in a moment — or connect your YouTube account, which uses the official API.',
  };
}

/** youtubei.js shells can carry NaN counts — keep them out of the DB. */
function finiteOrNull(n: number | undefined | null): number | null {
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
}

/** youtubei.js thumbnails are ordered small → large; prefer the last. */
function pickInnertubeThumb(thumbs: Array<{ url?: string }> | undefined | null): string | null {
  if (!thumbs || thumbs.length === 0) return null;
  return thumbs[thumbs.length - 1]?.url ?? null;
}

/**
 * Ensure the channels row exists. When the channel is new to the library,
 * fetch its full details and insert a proper ChannelRow (real thumbnail,
 * handle, stats, music classification — mirrors sync.ts's mapping so the
 * channel page renders fully). Falls back to the minimal ensureChannelRow
 * stub on any failure. Never touches channels we already know — their
 * metadata belongs to the subscription sync.
 */
async function ensureChannelWithDetails(
  accessToken: string,
  channelId: string | null,
  channelTitle: string | null,
): Promise<void> {
  if (!channelId) return;
  const existing = await getChannel(channelId);
  if (existing) return;

  try {
    const [ch] = await fetchChannels(accessToken, [channelId]);
    if (ch && ch.id) {
      await upsertChannel(channelRowFromApi(ch));
      return;
    }
  } catch (err) {
    // Non-fatal: the stub below still satisfies the FK.
    console.error('Channel details fetch failed (non-fatal):', err instanceof Error ? err.message : err);
  }
  await ensureChannelRow(channelId, channelTitle);
}

/** Map a `channels.list` item to a ChannelRow — same shape as sync.ts's mapping. */
function channelRowFromApi(ch: youtube_v3.Schema$Channel): ChannelRow {
  const now = Math.floor(Date.now() / 1000);
  const cls = classifyMusic(ch, ch.snippet?.title ?? undefined);
  return {
    channel_id: ch.id ?? '',
    title: ch.snippet?.title ?? '(unknown)',
    handle: extractHandle(ch),
    description: ch.snippet?.description ?? null,
    thumbnail_url: pickBestThumb(ch.snippet?.thumbnails),
    subscriber_count: numeric(ch.statistics?.subscriberCount),
    video_count: numeric(ch.statistics?.videoCount),
    country: ch.snippet?.country ?? null,
    custom_url: ch.snippet?.customUrl ?? null,
    music_flag: cls.flag,
    music_score: cls.score,
    hidden: 0,
    notes: null,
    // Not an actual subscription — this channel entered via a pasted video.
    subscribed_at: null,
    synced_at: now,
    created_at: now,
    updated_at: now,
    topic_categories: jsonString(ch.topicDetails?.topicCategories ?? null),
    banner_image_url: ch.brandingSettings?.image?.bannerImageUrl ?? null,
    branding_keywords: jsonString(ch.brandingSettings?.channel?.keywords ?? null),
  };
}

// ----- small pure helpers (private copies, matching sync.ts / watch page convention) -----

function extractHandle(ch: { snippet?: { customUrl?: string | null } } | undefined): string | null {
  const cu = ch?.snippet?.customUrl;
  if (!cu) return null;
  return cu.startsWith('@') ? cu : `@${cu}`;
}

function pickBestThumb(thumbs: youtube_v3.Schema$ThumbnailDetails | null | undefined): string | null {
  if (!thumbs) return null;
  return thumbs.medium?.url ?? thumbs.high?.url ?? thumbs.default?.url ?? null;
}

function numeric(v: string | null | undefined): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function jsonString(v: string[] | string | null | undefined): string | null {
  if (v == null) return null;
  if (typeof v === 'string') return v.trim() === '' ? null : JSON.stringify(v.trim());
  if (Array.isArray(v)) return v.length === 0 ? null : JSON.stringify(v);
  return null;
}

function tagsToJson(tags: string[] | null | undefined): string | null {
  if (!tags || tags.length === 0) return null;
  return JSON.stringify(tags);
}

function parseIsoDate(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
}

function parseIsoDuration(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const m = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso);
  if (!m) return null;
  const hours = Number(m[1] ?? 0);
  const minutes = Number(m[2] ?? 0);
  const seconds = Number(m[3] ?? 0);
  return hours * 3600 + minutes * 60 + seconds;
}
