/**
 * Sync orchestrator — pulls subscriptions from YouTube, enriches with channel
 * details, classifies music, and writes everything into the local DB.
 *
 * Idempotent: re-running is a no-op for unchanged channels and only updates
 * the rows that actually changed.
 */

import { fetchAllSubscriptions, fetchChannels } from './youtube';
import { getValidAccessToken } from './tokens';
import { recordSyncFinish, recordSyncStart, upsertChannel } from './repo';
import { classifyMusic } from './music-classifier';
import type { ChannelRow } from './types';
import type { youtube_v3 } from 'googleapis';

export interface SyncResult {
  seen: number;
  new: number;
  updated: number;
  errors: string[];
}

export async function syncSubscriptions(): Promise<SyncResult> {
  const runId = recordSyncStart();
  const result: SyncResult = { seen: 0, new: 0, updated: 0, errors: [] };
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
      };

      const { created } = upsertChannel(row);
      if (created) result.new += 1; else result.updated += 1;
    }

    recordSyncFinish(runId, { status: 'success', seen: result.seen, new: result.new, updated: result.updated });
    return result;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    result.errors.push(msg);
    recordSyncFinish(runId, { status: 'error', seen: result.seen, new: result.new, updated: result.updated, error: msg });
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

function parseIsoDate(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
}