/**
 * YouTube Data API client.
 *
 * Phase 1: personal MVP. Authentication is done via OAuth 2.0 with the
 * `youtube.readonly` scope. The user authorizes once, we persist a refresh
 * token in the local SQLite DB, and from then on we use the access token
 * (auto-refreshed) to call the API. No API key path is supported because
 * `subscriptions.list?mine=true` requires OAuth by design.
 *
 * We also expose a fallback for `channelId`-based subscription listing which
 * DOES work with just an API key — useful for inspecting another channel's
 * public subscriptions during testing.
 */

import { google, youtube_v3 } from 'googleapis';
import type { OAuth2Client } from 'google-auth-library';

const SCOPES = ['https://www.googleapis.com/auth/youtube.readonly'];
const TOKEN_URL = 'https://oauth2.googleapis.com/token';

export interface OAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export function oauthConfig(): OAuthConfig {
  const clientId = process.env.YOUTUBE_CLIENT_ID?.trim();
  const clientSecret = process.env.YOUTUBE_CLIENT_SECRET?.trim();
  const redirectUri = process.env.YOUTUBE_REDIRECT_URI?.trim() || 'http://localhost:3000/api/oauth/callback';
  if (!clientId || !clientSecret) {
    throw new Error(
      'Missing YOUTUBE_CLIENT_ID / YOUTUBE_CLIENT_SECRET. See README for how to create them.',
    );
  }
  return { clientId, clientSecret, redirectUri };
}

export function buildAuthClient(): OAuth2Client {
  const cfg = oauthConfig();
  return new google.auth.OAuth2(cfg.clientId, cfg.clientSecret, cfg.redirectUri);
}

export function buildAuthUrl(state: string): string {
  const client = buildAuthClient();
  return client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: SCOPES,
    state,
    include_granted_scopes: true,
  });
}

export async function exchangeCode(code: string): Promise<{ access_token: string; refresh_token: string | null; expiry_date: number | null }> {
  const client = buildAuthClient();
  const { tokens } = await client.getToken(code);
  return {
    access_token: tokens.access_token ?? '',
    refresh_token: tokens.refresh_token ?? null,
    expiry_date: tokens.expiry_date ?? null,
  };
}

export async function refreshAccessToken(refreshToken: string): Promise<{ access_token: string; expiry_date: number | null }> {
  const client = buildAuthClient();
  client.setCredentials({ refresh_token: refreshToken });
  const { credentials } = await client.refreshAccessToken();
  return {
    access_token: credentials.access_token ?? '',
    expiry_date: credentials.expiry_date ?? null,
  };
}

export function youtubeClientWithToken(accessToken: string): youtube_v3.Youtube {
  const client = buildAuthClient();
  client.setCredentials({ access_token: accessToken });
  return google.youtube({ version: 'v3', auth: client });
}

/**
 * Fetch ALL subscriptions for the authenticated user. Walks nextPageToken
 * internally so the caller gets a flat array.
 */
export async function fetchAllSubscriptions(accessToken: string): Promise<youtube_v3.Schema$Subscription[]> {
  const yt = youtubeClientWithToken(accessToken);
  const out: youtube_v3.Schema$Subscription[] = [];
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
    out.push(...items);
    pageToken = res.data.nextPageToken ?? undefined;
  } while (pageToken);
  return out;
}

/**
 * Fetch the recent uploads for a single channel. Uses the channel's
 * `contentDetails.relatedPlaylists.uploads` playlist to list videos in order.
 * Returns up to `max` items (newest first).
 *
 * TAV-18: This now consumes YouTube Data API quota. For new-video detection
 * prefer {@link fetchChannelUploadsRss}, which is free. This function is kept
 * as the API fallback for when RSS is unavailable.
 */
export async function fetchChannelUploads(
  accessToken: string,
  channelId: string,
  max = 30,
): Promise<youtube_v3.Schema$PlaylistItem[]> {
  const yt = youtubeClientWithToken(accessToken);
  // Resolve the uploads playlist id for the channel.
  const chRes = await yt.channels.list({
    part: ['contentDetails'],
    id: [channelId],
    maxResults: 1,
  });
  const uploadsPlaylistId = chRes.data.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
  if (!uploadsPlaylistId) return [];

  const out: youtube_v3.Schema$PlaylistItem[] = [];
  let pageToken: string | undefined;
  do {
    const res = await yt.playlistItems.list({
      part: ['snippet', 'contentDetails'],
      playlistId: uploadsPlaylistId,
      maxResults: Math.min(50, max - out.length),
      pageToken,
    });
    out.push(...(res.data.items ?? []));
    pageToken = res.data.nextPageToken ?? undefined;
  } while (pageToken && out.length < max);
  return out.slice(0, max);
}

// ----- TAV-18: RSS-first new-video detection -----------------------------------

/**
 * A single entry parsed from a channel's YouTube RSS feed. The feed exposes a
 * subset of the Data API's fields — enough to detect new video ids and write a
 * baseline `videos` row, but it lacks duration, tags, and category. Those get
 * filled in by a `videos.list` enrichment call for the ids we don't already have.
 */
export interface RssVideoEntry {
  videoId: string;
  title: string;
  description: string | null;
  thumbnailUrl: string | null;
  /** Unix seconds, parsed from the feed's `<published>` ISO-8601 timestamp. */
  publishedAt: number | null;
  /** View count from `<media:statistics views="...">`, or null when absent. */
  viewCount: number | null;
}

/**
 * Fetch a channel's public RSS feed and parse it into lightweight entries,
 * newest first. This is free, unauthenticated, and updates faster than the
 * Data API. The feed returns the most recent ~15 uploads; `max` caps that.
 *
 * Returns `null` when the feed is unreachable or empty so callers can fall
 * back to the API path. Network/parse failures are swallowed and logged via
 * the returned `null` rather than thrown — RSS is a best-effort optimization.
 */
export async function fetchChannelUploadsRss(
  channelId: string,
  max = 15,
): Promise<RssVideoEntry[] | null> {
  const url = `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`;
  let xml: string;
  try {
    const res = await fetch(url, {
      headers: { 'Accept': 'application/rss+xml, application/xml, text/xml' },
      // No User-Agent spoofing needed — the feed is public. A short timeout
      // keeps a flaky feed from stalling the sync loop.
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    xml = await res.text();
  } catch {
    return null;
  }
  const entries = parseRssFeed(xml);
  if (entries.length === 0) return null;
  return entries.slice(0, max);
}

/**
 * Pure parser for a YouTube channel RSS feed (Atom + media: extensions).
 * Exported for unit testing — production callers use {@link fetchChannelUploadsRss}.
 *
 * We parse with regex (matching the style of `parseTimedTextXml` in
 * transcript.ts) rather than a DOM library to avoid a new dependency and keep
 * the bundle small. The feed's structure is stable and `<entry>` tags never nest.
 */
export function parseRssFeed(xml: string): RssVideoEntry[] {
  const entries: RssVideoEntry[] = [];
  const entryRegex = /<entry>([\s\S]*?)<\/entry>/g;
  let match: RegExpExecArray | null;
  while ((match = entryRegex.exec(xml)) !== null) {
    const block = match[1];
    const videoId = pickTag(block, 'yt:videoId');
    if (!videoId) continue;
    entries.push({
      videoId,
      title: decodeEntities(pickTag(block, 'title') ?? ''),
      description: decodeEntities(pickMediaDescription(block)),
      thumbnailUrl: pickMediaThumbnail(block),
      publishedAt: parseIsoToUnix(pickTag(block, 'published')),
      viewCount: pickMediaStatisticsViews(block),
    });
  }
  return entries;
}

/** Extract the inner text of the first `<tag>...</tag>` (namespace-stripped). */
function pickTag(block: string, tag: string): string | null {
  // The feed uses a default Atom namespace, so tags appear without a prefix
  // (e.g. `<title>`, `<published>`) except for the `yt:` and `media:` ones.
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`);
  const m = block.match(re);
  return m ? m[1].trim() : null;
}

/** `<media:description>` lives inside `<media:group>`; pull its text. */
function pickMediaDescription(block: string): string | null {
  const m = block.match(/<media:description[^>]*>([\s\S]*?)<\/media:description>/);
  return m ? m[1].trim() : null;
}

/** `<media:thumbnail url="...">` — extract the url attribute. */
function pickMediaThumbnail(block: string): string | null {
  const m = block.match(/<media:thumbnail[^>]*\burl="([^"]+)"/);
  return m ? m[1] : null;
}

/** `<media:statistics views="...">` — extract the views attribute as a number. */
function pickMediaStatisticsViews(block: string): number | null {
  const m = block.match(/<media:statistics[^>]*\bviews="(\d+)"/);
  return m ? parseInt(m[1], 10) : null;
}

/** Parse an ISO-8601 timestamp to unix seconds, or null when unparseable. */
function parseIsoToUnix(iso: string | null): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
}

/** Decode XML entities — named and numeric (decimal + hex) — from feed text. */
function decodeEntities(s: string | null): string {
  if (!s) return '';
  // Decode &amp; first so that escaped entities like &amp;#39; collapse to &#39;
  // and are then handled by the numeric pass below.
  return s
    .replace(/&amp;/g, '&')
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

// ----- TAV-25: Channel back-catalog search via search.list --------------------

/**
 * A single video hit from a channel back-catalog search. The `search.list`
 * response only carries id + a snippet subset (title, description, thumbnail,
 * publishedAt); richer fields like duration and view count require a follow-up
 * `videos.list` call, which the action layer makes when the user asks to
 * summarize a result. We keep the shape small here so the UI can render a
 * result list without paying for that enrichment upfront.
 */
export interface ChannelSearchResult {
  videoId: string;
  title: string;
  description: string | null;
  thumbnailUrl: string | null;
  /** Unix seconds the video was published, parsed from the search snippet. */
  publishedAt: number | null;
  /** Channel id echoed back so the caller doesn't have to thread it through. */
  channelId: string;
}

/**
 * Search a channel's entire upload history via `search.list` with
 * `channelId` + `q`. Unlike `fetchChannelUploads` (which only walks the recent
 * uploads playlist), this reaches videos uploaded years ago — the back catalog
 * a long-time follower would care about that we never cached locally.
 *
 * Quota cost: 100 units per call (search.list is the most expensive endpoint we
 * use). We cap at one page of `max` (default 25) to keep a single search at one
 * unit-of-quota; pagination is wired but intentionally not surfaced in the v1
 * UI so a stray click can't burn through quota. The `maxPages` parameter (also
 * defaulting to 1) makes that contract explicit — raise it only when a
 * "load more" UI is added that makes the extra quota cost user-initiated.
 *
 * `publishedAfter` is an ISO-8601 string (e.g. `2023-01-01T00:00:00Z`) that
 * narrows the search to videos published after that moment. Pass null to search
 * the channel's full history.
 */
export async function searchChannelVideos(
  accessToken: string,
  channelId: string,
  query: string,
  max = 25,
  publishedAfter?: string | null,
  /** Hard cap on API pages fetched (each page is a 100-unit call). Default 1. */
  maxPages = 1,
): Promise<ChannelSearchResult[]> {
  const yt = youtubeClientWithToken(accessToken);
  const out: ChannelSearchResult[] = [];
  let pageToken: string | undefined;
  let pages = 0;
  do {
    const res = await yt.search.list({
      part: ['snippet'],
      channelId,
      q: query,
      type: ['video'],
      maxResults: Math.min(50, max - out.length),
      order: 'relevance',
      pageToken,
      publishedAfter: publishedAfter ?? undefined,
    });
    const items = res.data.items ?? [];
    for (const item of items) {
      const videoId = item.id?.videoId;
      if (!videoId) continue; // search can return channel/playlist rows when type isn't respected
      const snip = item.snippet;
      out.push({
        videoId,
        channelId,
        title: snip?.title ?? '(untitled)',
        description: snip?.description ?? null,
        thumbnailUrl: snip?.thumbnails?.medium?.url
          ?? snip?.thumbnails?.high?.url
          ?? snip?.thumbnails?.default?.url
          ?? null,
        publishedAt: parseIsoToUnix(snip?.publishedAt ?? null),
      });
      if (out.length >= max) break;
    }
    pageToken = res.data.nextPageToken ?? undefined;
    pages += 1;
  } while (pageToken && out.length < max && pages < maxPages);
  return out.slice(0, max);
}

// ----- TAV-20: Community Pulse — top comments via commentThreads.list ---------

/**
 * A single top-level comment, normalized for storage and display.
 * We keep only the fields the Community Pulse feature needs — the API returns
 * far more, but trimming here keeps the DB row and the LLM prompt small.
 */
export interface VideoComment {
  comment_id: string;
  video_id: string;
  author: string;
  text: string;
  like_count: number;
  /** Unix seconds the comment was published. */
  published_at: number | null;
  /** Total reply count for this top-level comment thread. */
  reply_count: number;
}

/**
 * Fetch the top-voted comments for a video via `commentThreads.list` with
 * `order=relevance`. Returns up to `max` (default 20) top-level comments,
 * newest-relevant first.
 *
 * Quota cost: 1 unit per call (same as `videos.list`). We only fetch one page
 * because the Community Pulse summary is about signal, not volume — the top 20
 * by relevance is enough to surface corrections and context the community adds.
 *
 * Returns an empty array when comments are disabled (HTTP 403 with
 * `commentsDisabled`) so callers can treat that as "no community pulse" rather
 * than a hard error.
 */
export async function fetchTopComments(
  accessToken: string,
  videoId: string,
  max = 20,
): Promise<VideoComment[]> {
  const yt = youtubeClientWithToken(accessToken);
  try {
    const res = await yt.commentThreads.list({
      part: ['snippet'],
      videoId,
      maxResults: Math.min(50, max),
      order: 'relevance',
      textFormat: 'plainText',
    });
    const items = res.data.items ?? [];
    const out: VideoComment[] = [];
    for (const item of items) {
      const top = item.snippet?.topLevelComment?.snippet;
      if (!top) continue;
      const publishedAt = top.publishedAt ? parseIsoToUnix(top.publishedAt) : null;
      out.push({
        comment_id: item.snippet!.topLevelComment!.id ?? '',
        video_id: videoId,
        author: top.authorDisplayName ?? '',
        text: top.textDisplay ?? top.textOriginal ?? '',
        like_count: top.likeCount ?? 0,
        published_at: publishedAt,
        reply_count: item.snippet?.totalReplyCount ?? 0,
      });
      if (out.length >= max) break;
    }
    return out;
  } catch (err) {
    // commentsDisabled comes back as HTTP 403 — treat as "no comments", not a
    // crash. The structured reason lives on the response body, not the message
    // string (gaxios sets the message to "Request failed with status code 403"),
    // so matching on '403' would swallow every 403 — quota-exceeded,
    // insufficient-scopes, expired-token — as a silent "no comments". Narrow to
    // the API's documented `commentsDisabled` reason and re-throw the rest so
    // the non-fatal outer handler in runCommunityPulse can log them.
    //
    // Structured as gaxios's GaxiosError.response.data.error.errors[].reason.
    // gaxios is a transitive dep (via googleapis), so we reach it structurally
    // rather than importing its type.
    const reasons = (err as { response?: { data?: { error?: { errors?: Array<{ reason?: string }> } } } })
      ?.response?.data?.error?.errors ?? [];
    const isCommentsDisabled = reasons.some((r) => r.reason === 'commentsDisabled');
    if (isCommentsDisabled) return [];
    throw err;
  }
}

/**
 * Fetch full video details (snippet + contentDetails for duration) for a batch
 * of video IDs. Used to enrich the playlist items with ISO-8601 duration.
 */
export async function fetchVideoDetails(
  accessToken: string,
  videoIds: string[],
): Promise<youtube_v3.Schema$Video[]> {
  if (videoIds.length === 0) return [];
  const yt = youtubeClientWithToken(accessToken);
  const out: youtube_v3.Schema$Video[] = [];
  for (let i = 0; i < videoIds.length; i += 50) {
    const slice = videoIds.slice(i, i + 50);
    const res = await yt.videos.list({
      part: ['snippet', 'contentDetails', 'statistics', 'liveStreamingDetails'],
      id: slice,
      maxResults: 50,
    });
    out.push(...(res.data.items ?? []));
  }
  return out;
}

/**
 * Look up full channel details (snippet + statistics + brandingSettings + contentDetails)
 * for a batch of channel IDs. Returns whatever the API gave back; missing channels are
 * silently dropped.
 */
export async function fetchChannels(accessToken: string, channelIds: string[]): Promise<youtube_v3.Schema$Channel[]> {
  if (channelIds.length === 0) return [];
  const yt = youtubeClientWithToken(accessToken);
  const out: youtube_v3.Schema$Channel[] = [];
  // API caps at 50 ids per call.
  for (let i = 0; i < channelIds.length; i += 50) {
    const slice = channelIds.slice(i, i + 50);
    const res = await yt.channels.list({
      part: ['snippet', 'statistics', 'brandingSettings', 'contentDetails', 'topicDetails'],
      id: slice,
      maxResults: 50,
    });
    out.push(...(res.data.items ?? []));
  }
  return out;
}

export async function fetchMyChannel(accessToken: string): Promise<{ displayName: string | null; avatarUrl: string | null }> {
  const yt = youtubeClientWithToken(accessToken);
  const res = await yt.channels.list({ part: ['snippet'], mine: true, maxResults: 1 });
  const ch = res.data.items?.[0];
  return {
    displayName: ch?.snippet?.title ?? null,
    avatarUrl: ch?.snippet?.thumbnails?.default?.url ?? ch?.snippet?.thumbnails?.medium?.url ?? null,
  };
}

// ----- TAV-26: Curated channel playlists --------------------------------------

/**
 * A channel-curated public playlist, normalized for storage and display.
 * These are the creator's own "Start Here" / "Best Interviews" collections —
 * a far better entry point than the recency-sorted uploads playlist.
 */
export interface ChannelPlaylist {
  playlist_id: string;
  channel_id: string;
  title: string;
  description: string | null;
  thumbnail_url: string | null;
  /** Item count as reported by the API (contentDetails.itemCount). */
  item_count: number | null;
  /** Unix seconds the playlist was published, parsed from snippet.publishedAt. */
  published_at: number | null;
}

/**
 * A single video inside a curated playlist, normalized from `playlistItems.list`.
 * We keep only the fields the playlist detail view needs; enrichment (duration,
 * view counts) happens later via `videos.list` when the user summarizes a video.
 */
export interface PlaylistVideo {
  video_id: string;
  title: string;
  description: string | null;
  thumbnail_url: string | null;
  /** Position of the video within the playlist (0-indexed). */
  position: number;
  /** Unix seconds the video was published, parsed from the playlist item snippet. */
  published_at: number | null;
}

/**
 * Fetch a channel's public curated playlists via `playlists.list?channelId=...`.
 * Walks nextPageToken internally so the caller gets a flat array. Excludes the
 * auto-generated uploads/likes/favorites playlists the channel already exposes
 * via `contentDetails.relatedPlaylists` — those are not curated collections.
 *
 * Quota cost: 1 unit per call (playlists.list is cheap). We cap at `max` so a
 * channel with dozens of playlists doesn't burn through the daily budget.
 */
export async function fetchChannelPlaylists(
  accessToken: string,
  channelId: string,
  max = 50,
): Promise<ChannelPlaylist[]> {
  const yt = youtubeClientWithToken(accessToken);
  const out: ChannelPlaylist[] = [];
  let pageToken: string | undefined;
  do {
    const res = await yt.playlists.list({
      part: ['snippet', 'contentDetails'],
      channelId,
      maxResults: Math.min(50, max - out.length),
      pageToken,
    });
    const items = res.data.items ?? [];
    for (const item of items) {
      const snip = item.snippet;
      out.push({
        playlist_id: item.id ?? '',
        channel_id: snip?.channelId ?? channelId,
        title: snip?.title ?? '(untitled playlist)',
        description: snip?.description ?? null,
        thumbnail_url: pickPlaylistThumb(snip?.thumbnails),
        item_count: item.contentDetails?.itemCount ?? null,
        published_at: parseIsoToUnix(snip?.publishedAt ?? null),
      });
      if (out.length >= max) break;
    }
    pageToken = res.data.nextPageToken ?? undefined;
  } while (pageToken && out.length < max);
  return out.slice(0, max);
}

/** Pick the best available thumbnail URL from a playlists.list thumbnail set. */
function pickPlaylistThumb(thumbs: youtube_v3.Schema$ThumbnailDetails | null | undefined): string | null {
  if (!thumbs) return null;
  return thumbs.medium?.url ?? thumbs.high?.url ?? thumbs.standard?.url ?? thumbs.default?.url ?? null;
}

/**
 * Fetch the videos in a single playlist via `playlistItems.list`, in playlist
 * order (position ascending). Walks nextPageToken internally so the caller gets
 * a flat array up to `max`.
 *
 * Quota cost: 1 unit per call. Playlist items carry a snippet subset (title,
 * description, thumbnail, publishedAt) — richer fields like duration require a
 * follow-up `videos.list` call, which the summarize pipeline makes on demand.
 */
export async function fetchPlaylistVideos(
  accessToken: string,
  playlistId: string,
  max = 100,
): Promise<PlaylistVideo[]> {
  const yt = youtubeClientWithToken(accessToken);
  const out: PlaylistVideo[] = [];
  let pageToken: string | undefined;
  do {
    const res = await yt.playlistItems.list({
      part: ['snippet', 'contentDetails'],
      playlistId,
      maxResults: Math.min(50, max - out.length),
      pageToken,
    });
    const items = res.data.items ?? [];
    for (const item of items) {
      const videoId = item.contentDetails?.videoId;
      if (!videoId) continue;
      const snip = item.snippet;
      out.push({
        video_id: videoId,
        title: snip?.title ?? '(untitled)',
        description: snip?.description ?? null,
        thumbnail_url: pickPlaylistItemThumb(snip?.thumbnails),
        position: snip?.position ?? out.length,
        published_at: parseIsoToUnix(snip?.publishedAt ?? null),
      });
      if (out.length >= max) break;
    }
    pageToken = res.data.nextPageToken ?? undefined;
  } while (pageToken && out.length < max);
  return out.slice(0, max);
}

/** Pick the best available thumbnail URL from a playlistItems.list thumbnail set. */
function pickPlaylistItemThumb(thumbs: youtube_v3.Schema$ThumbnailDetails | null | undefined): string | null {
  if (!thumbs) return null;
  return thumbs.medium?.url ?? thumbs.high?.url ?? thumbs.standard?.url ?? thumbs.default?.url ?? null;
}

export { TOKEN_URL };