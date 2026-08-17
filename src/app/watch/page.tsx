import { notFound } from 'next/navigation';
import { buildWatchQueue } from '@/lib/queue';
import { ensureChannelRow, getVideoWithSummary, upsertVideo } from '@/lib/video-repo';
import { fetchVideoDetails } from '@/lib/youtube';
import { isConnected, getUserProfile, getValidAccessToken } from '@/lib/tokens';
import { parseIso8601Duration } from '@/app/_lib/format';
import { AppShell } from '../_components/AppShell';
import { WatchQueue } from '../_components/WatchQueue';
import type { WatchQueueItem } from '@/lib/types';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<{ v?: string }>;
}

/**
 * TAV-56: /watch route — a player-first consumption surface.
 *
 * Server component: calls buildWatchQueue(20) and fetches the full
 * VideoWithSummary for the "now playing" video, then passes both to the client
 * WatchQueue component. The "now playing" video is the top-ranked queue item
 * unless the `?v=` query param selects a specific one.
 *
 * When `?v=` names a video not in the local cache, we best-effort fetch it via
 * the YouTube Data API and upsert it so the watch page can surface it without
 * requiring a channel sync first. The fetch is non-fatal — if it fails, we
 * fall back to the first queue item.
 */
export default async function WatchPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const [connected, profile, queue] = await Promise.all([
    isConnected(),
    getUserProfile(),
    buildWatchQueue(20),
  ]);

  if (queue.length === 0) {
    return (
      <AppShell tab="watch" connected={connected} profile={profile} mainStyle={{ maxWidth: 'none', width: '100%' }}>
        <EmptyWatchState connected={connected} />
      </AppShell>
    );
  }

  // Determine the "now playing" video: prefer ?v= if it's in the queue, else
  // the top-ranked item. If ?v= is set but missing from the local cache, try
  // to fetch it from the YouTube API (best-effort), then fall back to the first
  // queue item on any failure.
  const requestedId = params.v?.trim();
  let nowPlayingId = queue[0].video_id;

  if (requestedId && requestedId !== nowPlayingId) {
    const inQueue = queue.some((q) => q.video_id === requestedId);
    if (inQueue) {
      nowPlayingId = requestedId;
    } else {
      nowPlayingId = await bestEffortFetchVideo(requestedId) ?? queue[0].video_id;
    }
  }

  const nowPlaying = await getVideoWithSummary(nowPlayingId);
  if (!nowPlaying) {
    notFound();
  }

  // The "Up Next" list excludes the currently-playing video so the queue
  // always shows what's coming next.
  const orderedQueue: WatchQueueItem[] = queue
    .filter((q) => q.video_id !== nowPlayingId)
    .slice(0, 19);

  return (
    <AppShell tab="watch" connected={connected} profile={profile} mainStyle={{ maxWidth: 'none', width: '100%' }}>
      <WatchQueue queue={orderedQueue} nowPlaying={nowPlaying} />
    </AppShell>
  );
}

/**
 * Best-effort: fetch a single video's metadata from the YouTube Data API and
 * upsert it into the local cache so getVideoWithSummary can hydrate it. Returns
 * the video id on success, or null on any failure (no token, API error, private
 * video). Non-fatal — the caller falls back to the first queue item.
 */
async function bestEffortFetchVideo(videoId: string): Promise<string | null> {
  try {
    const accessToken = await getValidAccessToken();
    const details = await fetchVideoDetails(accessToken, [videoId]);
    const det = details[0];
    const snip = det?.snippet;
    if (!det || !snip) return null;

    // Ensure a minimal channels row exists before inserting the video, so the
    // videos.channel_id FK constraint is satisfied. Mirrors recordLikedVideos.
    const channelId = snip.channelId ?? null;
    await ensureChannelRow(channelId, snip.channelTitle ?? null);

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
      duration_seconds: parseIso8601Duration(det.contentDetails?.duration ?? null),
      published_at: parseIsoDate(snip.publishedAt),
      view_count: numeric(det.statistics?.viewCount),
      like_count: numeric(det.statistics?.likeCount),
      comment_count: numeric(det.statistics?.commentCount),
      favorite_count: numeric(det.statistics?.favoriteCount),
      tags: tagsToJson(det.snippet?.tags ?? null),
      category_id: numeric(det.snippet?.categoryId),
      is_live: det.liveStreamingDetails || snip.liveBroadcastContent === 'live' ? 1 : 0,
      live_streaming_details: det.liveStreamingDetails
        ? JSON.stringify(det.liveStreamingDetails)
        : null,
    });
    return videoId;
  } catch {
    return null;
  }
}

function parseIsoDate(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
}

function numeric(v: string | null | undefined): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function tagsToJson(tags: string[] | null | undefined): string | null {
  if (!tags || tags.length === 0) return null;
  return JSON.stringify(tags);
}

function EmptyWatchState({ connected }: { connected: boolean }) {
  return (
    <div style={{ maxWidth: 540, margin: '60px auto', textAlign: 'center' }}>
      <h2 style={{ fontSize: 22, fontWeight: 600, marginBottom: 8 }}>
        Nothing to watch yet
      </h2>
      <p style={{ color: '#8b8b94', fontSize: 14, lineHeight: 1.5 }}>
        {connected
          ? 'Your Watch queue is empty. Summarize a few videos or sync your subscriptions to build a recommendation queue — the watch tab blends what you haven\u2019t seen, what matches your topics, and what your saved videos cite.'
          : 'Connect your YouTube account to build a personalised Watch queue from your subscriptions.'}
      </p>
    </div>
  );
}
