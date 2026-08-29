/**
 * Channel back-catalog search: swappable data source.
 *
 * Two implementations live behind one interface:
 *
 *   1. `innertube` (default) — LuanRT/YouTube.js (npm: youtubei.js), which
 *      speaks YouTube's private InnerTube API. Zero Data API quota. This is
 *      the same API family the YouTube apps themselves use, and the same
 *      approach `transcript.ts` already takes for captions (TAV-19).
 *
 *   2. `data-api` — the official `search.list` endpoint via googleapis.
 *      Costs 100 quota units per call (the most expensive endpoint the app
 *      uses) but carries a Google contract. Kept as the fallback so a
 *      public launch never depends on an unofficial path alone.
 *
 * Selection is env-driven: `CHANNEL_SEARCH_PROVIDER=innertube|data-api`.
 * Unset/invalid falls back to `innertube` (the kitchen-sink default). The
 * caller (actions.ts) is oblivious — it calls `searchChannelCatalog()` and
 * gets the same shape back either way.
 *
 * Quota math (why this exists): at 10,000 Data API units/day per project,
 * official-API search caps the whole app at ~95 users doing one search/day.
 * Everything else the app does costs 1 unit; search costs 100. Multi-user
 * future-proofing = move search off the metered API.
 */

import type { ChannelSearchResult } from './youtube';
import { YTNodes } from 'youtubei.js';

export type ChannelSearchProvider = 'innertube' | 'data-api';

/** Which implementation `searchChannelCatalog` will use, from env. */
export function channelSearchProvider(): ChannelSearchProvider {
  const raw = process.env.CHANNEL_SEARCH_PROVIDER?.trim().toLowerCase();
  return raw === 'data-api' ? 'data-api' : 'innertube';
}

/**
 * Search a channel's upload history. Contract is identical to
 * `searchChannelVideos` in youtube.ts: newest-relevance subset of videos
 * whose title/description match `query`, up to `max`, optionally narrowed
 * to videos published after `publishedAfter` (ISO-8601; null = full history).
 *
 * Quota: 0 units on `innertube`, 100 units × pages on `data-api`.
 */
export async function searchChannelCatalog(
  accessToken: string,
  channelId: string,
  query: string,
  max = 25,
  publishedAfter?: string | null,
): Promise<ChannelSearchResult[]> {
  // Env can force a provider, but availability wins: if the library import
  // fails for any reason, fall back rather than hard-fail the search.
  const provider = channelSearchProvider();
  if (provider === 'data-api') {
    return searchDataApi(accessToken, channelId, query, max, publishedAfter);
  }
  try {
    return await searchInnertube(channelId, query, max, publishedAfter);
  } catch (err) {
    console.warn('[channel-search] Innertube path failed, falling back to Data API:', err);
    try {
      return await searchDataApi(accessToken, channelId, query, max, publishedAfter);
    } catch {
      // Data API fallback also failed — surface the original Innertube error.
      throw err;
    }
  }
}

// ----- Innertube (youtubei.js) implementation ---------------------------------

/**
 * Module-level singleton. `Innertube.create()` fetches client config from
 * YouTube on first use (session tokens, client version). Creating one per
 * request would multiply that handshake; one per process is what the library
 * authors recommend for server use.
 */
let innertubePromise: Promise<InnertubeClient> | null = null;

type InnertubeClient = Awaited<ReturnType<typeof createInnertube>>;

async function createInnertube() {
  const { Innertube } = await import('youtubei.js');
  return Innertube.create();
}

function getInnertube(): Promise<InnertubeClient> {
  if (!innertubePromise) {
    innertubePromise = createInnertube().catch((err) => {
      // Don't cache a failed init — let the next call retry.
      innertubePromise = null;
      throw err;
    });
  }
  return innertubePromise;
}

/**
 * Relative-date strings ("2 years ago") from search cards are coarse. When
 * the caller narrows by date we need a comparable number, so we parse the
 * relative form. Absolute forms ("Premiered Jan 12, 2024") are returned
 * as-is in the result; the Data API path returns precise ISO dates, so
 * callers should treat `publishedAt` as best-effort on this path.
 */
function parseRelativeDate(text: string | null | undefined): number | null {
  if (!text) return null;
  const m = /(\d+)\s+(second|minute|hour|day|week|month|year)s?\s+ago/i.exec(text);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  const unitSec: Record<string, number> = {
    second: 1, minute: 60, hour: 3600, day: 86_400,
    week: 604_800, month: 2_629_800, year: 31_557_600,
  };
  const unit = unitSec[m[2].toLowerCase()];
  return unit ? Math.floor(Date.now() / 1000) - n * unit : null;
}

/** Map a youtubei.js thumbnail list to the best available URL. */
function pickThumb(thumbs: Array<{ url?: string }> | undefined | null): string | null {
  if (!thumbs || thumbs.length === 0) return null;
  return thumbs[thumbs.length - 1]?.url ?? null;
}

async function searchInnertube(
  channelId: string,
  query: string,
  max: number,
  publishedAfter?: string | null,
): Promise<ChannelSearchResult[]> {
  const yt = await getInnertube();
  const channel = await yt.getChannel(channelId);
  const results = await channel.search(query);

  const hits: ChannelSearchResult[] = [];
  for (const node of await results.videos) {
    // Channel search results are Video nodes, but the feed can also carry
    // LockupView/ReelItem variants; narrow to the shape we know how to read.
    if (!node.is(YTNodes.Video)) continue;
    const v: YTNodes.Video = node;
    const videoId = v.video_id ?? v.id;
    if (!videoId) continue;
    const publishedText = v.published?.toString();
    const publishedAt = parseRelativeDate(publishedText);
    hits.push({
      videoId,
      channelId,
      title: v.title?.toString() ?? '(untitled)',
      description: v.description_snippet?.toString() ?? null,
      thumbnailUrl: pickThumb(v.thumbnails),
      publishedAt,
    });
    if (hits.length >= max) break;
  }

  // Date narrowing (client-side; InnerTube has no publishedAfter param here).
  if (publishedAfter) {
    const cutoff = Math.floor(Date.parse(publishedAfter) / 1000);
    if (Number.isFinite(cutoff)) {
      const filtered = hits.filter(h => h.publishedAt === null || h.publishedAt >= cutoff);
      return filtered.slice(0, max);
    }
  }
  return hits.slice(0, max);
}

// ----- Official Data API implementation (fallback) ------------------------------

async function searchDataApi(
  accessToken: string,
  channelId: string,
  query: string,
  max: number,
  publishedAfter?: string | null,
): Promise<ChannelSearchResult[]> {
  // Late import keeps googleapis out of the Innertube-only path's module
  // graph at runtime (it's already a serverExternalPackage, but the intent
  // stays explicit).
  const { searchChannelVideos } = await import('./youtube');
  return searchChannelVideos(accessToken, channelId, searchQueryForDataApi(query), max, publishedAfter);
}

/**
 * InnerTube channel search matches title/description text. The Data API's
 * `search.list` q parameter behaves similarly for these long-tail queries;
 * no transformation is needed, but the seam exists if the two providers ever
 * disagree about relevance ranking.
 */
function searchQueryForDataApi(query: string): string {
  return query;
}
