import { notFound } from 'next/navigation';
import { buildWatchQueue } from '@/lib/queue';
import { getVideoWithSummary } from '@/lib/video-repo';
import { ingestVideoById } from '@/lib/video-ingest';
import { isConnected, getUserProfile } from '@/lib/tokens';
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
 * When `?v=` names a video not in the local cache, we best-effort ingest it via
 * lib/video-ingest (YouTube Data API, shared with the paste-a-URL flow,
 * TAV-67) so the watch page can surface it without requiring a channel sync
 * first. The ingest is non-fatal — if it fails, we fall back to the first
 * queue item, or an empty-state message when there is no queue either.
 */
export default async function WatchPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const [connected, profile, queue] = await Promise.all([
    isConnected(),
    getUserProfile(),
    buildWatchQueue(20),
  ]);

  // Determine the "now playing" video: prefer ?v= if it's in the queue, else
  // the top-ranked item. If ?v= is set but missing from the local cache, try
  // to ingest it from the YouTube API (best-effort, shared with the paste-a-
  // URL flow — TAV-56/TAV-67), then fall back to the first queue item on any
  // failure. Unlike the original TAV-56 flow, an ad-hoc video now plays even
  // when the queue is empty — pasting a URL must always land somewhere.
  const requestedId = params.v?.trim();
  let nowPlayingId = queue[0]?.video_id ?? null;

  if (requestedId && requestedId !== nowPlayingId) {
    const inQueue = queue.some((q) => q.video_id === requestedId);
    if (inQueue) {
      nowPlayingId = requestedId;
    } else {
      const ingested = await ingestVideoById(requestedId);
      if (ingested.ok) nowPlayingId = requestedId;
    }
  }

  if (!nowPlayingId) {
    return (
      <AppShell tab="watch" connected={connected} profile={profile} mainStyle={{ maxWidth: 'none', width: '100%' }}>
        <EmptyWatchState connected={connected} failedRequested={Boolean(requestedId)} />
      </AppShell>
    );
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

function EmptyWatchState({ connected, failedRequested }: { connected: boolean; failedRequested: boolean }) {
  return (
    <div style={{ maxWidth: 540, margin: '60px auto', textAlign: 'center' }}>
      <h2 style={{ fontSize: 22, fontWeight: 600, marginBottom: 8 }}>
        {failedRequested ? 'Could not load that video' : 'Nothing to watch yet'}
      </h2>
      <p style={{ color: '#8b8b94', fontSize: 14, lineHeight: 1.5 }}>
        {failedRequested
          ? 'The video could not be fetched — it may be private, deleted, or the ID is wrong. Double-check the URL and try pasting it again.'
          : connected
            ? 'Your Watch queue is empty. Summarize a few videos or sync your subscriptions to build a recommendation queue — the watch tab blends what you haven\u2019t seen, what matches your topics, and what your saved videos cite.'
            : 'Connect your YouTube account to build a personalised Watch queue from your subscriptions.'}
      </p>
    </div>
  );
}
