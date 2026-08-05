/**
 * Sync orchestrator — pulls subscriptions from YouTube, enriches with channel
 * details, classifies music, and writes everything into the Postgres DB.
 *
 * Idempotent: re-running is a no-op for unchanged channels and only updates
 * the rows that actually changed.
 */

import { fetchAllSubscriptions, fetchChannels, fetchLikedVideos } from './youtube';
import { getValidAccessToken } from './tokens';
import { recordSyncFinish, recordSyncStart, upsertChannel } from './repo';
import { classifyMusic } from './music-classifier';
import { recordLikedVideos } from './video-repo';
import type { ChannelRow } from './types';
import type { youtube_v3 } from 'googleapis';

export interface SyncResult {
  seen: number;
  new: number;
  updated: number;
  /** Total liked videos pulled from YouTube during this sync. */
  likesSynced: number;
  /** New `video_likes` rows actually inserted (re-synced videos are skipped). */
  likesInserted: number;
  errors: string[];
}

export async function syncSubscriptions(): Promise<SyncResult> {
  const runId = await recordSyncStart();
  const result: SyncResult = { seen: 0, new: 0, updated: 0, likesSynced: 0, likesInserted: 0, errors: [] };
  try {
    const accessToken = await getValidAccessToken();
    const subs = await fetchAllSubscriptions(accessToken);
    result.seen = subs.length;

    // Extract channel ids and skip subscriptions whose snippet is missing.
    const ids = subs
      .map(s => s.snippet?.resourceId?.channelId)
      .filter((x): x is string => Boolean(x));

    // Fetch channel details in batches of 50.
    const channels = await fetchChannels(accessToken, ids);
    const channelById = new Map<string, typeof channels[number]>();
    for (const ch of channels) {
      if (ch.id) channelById.set(ch.id, ch);
    }

    const now = Math.floor(Date.now() / 1000);

    for (const sub of subs) {
      const channelId = sub.snippet?.resourceId?.channelId;
      if (!channelId) continue;
      const ch = channelById.get(channelId);
      const fallbackTitle = sub.snippet?.title ?? undefined;
      const cls = classifyMusic(ch, fallbackTitle);

      const row: ChannelRow = {
        channel_id: channelId,
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
        // TAV-17: persist previously-discarded fields.
        topic_categories: jsonString(ch?.topicDetails?.topicCategories ?? null),
        banner_image_url: ch?.brandingSettings?.image?.bannerImageUrl ?? null,
        branding_keywords: jsonString(ch?.brandingSettings?.channel?.keywords ?? null),
      };

      const { created } = await upsertChannel(row);
      if (created) result.new += 1; else result.updated += 1;
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
