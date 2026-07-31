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
      part: ['snippet', 'contentDetails', 'statistics'],
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

export { TOKEN_URL };