import { buildMusicQueue } from '@/lib/queue';
import { isConnected, getUserProfile } from '@/lib/tokens';
import { AppShell } from '../_components/AppShell';
import { MusicQueue } from '../_components/MusicQueue';
import type { MusicQueueItem } from '@/lib/types';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<{ v?: string }>;
}

/**
 * TAV-57: /music route — a player-first music consumption surface.
 *
 * Server component: calls buildMusicQueue(20) and passes the full queue to the
 * client MusicQueue component. The "now playing" track is the top-ranked queue
 * item unless the `?v=` query param selects a specific one.
 *
 * Unlike the /watch route, there is no best-effort YouTube API fetch for videos
 * missing from the local cache — music queue items are self-contained (title +
 * channel + thumbnail) and the view strips all AI tooling (no summaries, no
 * transcripts, no chapters, no chat, no references). If `?v=` names a video not
 * in the queue, we fall back to the first queue item.
 */
export default async function MusicPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const [connected, profile, queue] = await Promise.all([
    isConnected(),
    getUserProfile(),
    buildMusicQueue(20),
  ]);

  if (queue.length === 0) {
    return (
      <AppShell tab="music" connected={connected} profile={profile} mainStyle={{ maxWidth: 'none', width: '100%' }}>
        <EmptyMusicState connected={connected} />
      </AppShell>
    );
  }

  // Determine the "now playing" track: prefer ?v= if it's in the queue, else
  // the top-ranked item. No best-effort fetch — music items are self-contained.
  const requestedId = params.v?.trim();
  const nowPlayingId =
    requestedId && queue.some((q) => q.video_id === requestedId)
      ? requestedId
      : queue[0].video_id;

  const nowPlaying =
    queue.find((q) => q.video_id === nowPlayingId) ?? queue[0];

  // The "Up Next" list excludes the currently-playing track.
  const orderedQueue: MusicQueueItem[] = queue
    .filter((q) => q.video_id !== nowPlayingId)
    .slice(0, 19);

  return (
    <AppShell tab="music" connected={connected} profile={profile} mainStyle={{ maxWidth: 'none', width: '100%' }}>
      <MusicQueue queue={orderedQueue} nowPlaying={nowPlaying} />
    </AppShell>
  );
}

function EmptyMusicState({ connected }: { connected: boolean }) {
  return (
    <div style={{ maxWidth: 540, margin: '60px auto', textAlign: 'center' }}>
      <h2 style={{ fontSize: 22, fontWeight: 600, marginBottom: 8 }}>
        Nothing to play yet
      </h2>
      <p style={{ color: '#8b8b94', fontSize: 14, lineHeight: 1.5 }}>
        {connected
          ? 'Your Music queue is empty. Flag channels as music in the Channels tab to build a listening queue from the artists you love.'
          : 'Connect your YouTube account to build a Music queue from your subscriptions.'}
      </p>
    </div>
  );
}
