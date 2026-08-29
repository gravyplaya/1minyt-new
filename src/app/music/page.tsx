import { buildMusicQueue, listMusicLibrary } from '@/lib/queue';
import { isConnected, getUserProfile } from '@/lib/tokens';
import { AppShell } from '../_components/AppShell';
import { MusicQueue, MusicLibrarySection } from '../_components/MusicQueue';
import type { MusicQueueItem } from '@/lib/types';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<{ v?: string }>;
}

/**
 * TAV-57: /music route — a player-first music consumption surface.
 *
 * Server component: calls buildMusicQueue(20) and listMusicLibrary(), passing
 * both to the client MusicQueue component.
 *
 * Now-playing resolution: an explicit `?v=` naming any track from a
 * music-flagged channel plays that track and turns Up Next into the rest of
 * that artist's catalogue ("artist radio"). Without `?v=` (cold load), the
 * top-ranked queue item plays and Up Next shows the ranked queue.
 *
 * Unlike the /watch route, there is no best-effort YouTube API fetch for
 * videos missing from the local cache — music items are self-contained
 * (title + channel + thumbnail) and the view strips all AI tooling (no
 * summaries, no transcripts, no chapters, no chat, no references).
 */
export default async function MusicPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const [connected, profile, queue, library] = await Promise.all([
    isConnected(),
    getUserProfile(),
    buildMusicQueue(20),
    listMusicLibrary(),
  ]);

  const requestedId = params.v?.trim();

  // Resolve an explicit track pick against the full library (every music
  // track, not just the ranked page) — no extra query needed.
  const libraryMatch = requestedId
    ? library.flatMap((g) => g.tracks).find((t) => t.video_id === requestedId) ?? null
    : null;

  let nowPlaying: MusicQueueItem | null;
  let orderedQueue: MusicQueueItem[];

  if (libraryMatch) {
    // Artist radio: play the picked track; Up Next = the rest of that
    // artist's catalogue (seen/skipped tracks excluded so skip/defer stick).
    // Prefer the queue's own row for now-playing when present — same display
    // fields, but keeps the real score/is_pinned values.
    nowPlaying =
      queue.find((q) => q.video_id === libraryMatch.video_id) ??
      { ...libraryMatch, score: 0, is_pinned: false };
    const artist = library.find((g) => g.channel_title === libraryMatch.channel_title);
    orderedQueue = (artist?.tracks ?? [])
      .filter((t) => t.video_id !== libraryMatch.video_id && !t.is_seen)
      .slice(0, 19)
      .map((t) => ({ ...t, score: 0, is_pinned: false }));
  } else if (queue.length > 0) {
    // Cold load (or an unknown/non-music ?v=): top-ranked track + ranked queue.
    nowPlaying = queue[0];
    orderedQueue = queue
      .filter((q) => q.video_id !== nowPlaying!.video_id)
      .slice(0, 19);
  } else {
    nowPlaying = null;
    orderedQueue = [];
  }

  if (!nowPlaying) {
    return (
      <AppShell tab="music" connected={connected} profile={profile} mainStyle={{ maxWidth: 'none', width: '100%' }}>
        {library.length > 0 ? (
          <div style={{ maxWidth: 720, margin: '0 auto' }}>
            <h2 style={{ fontSize: 22, fontWeight: 600, margin: '40px 0 8px' }}>
              Pick something to play
            </h2>
            <p style={{ color: '#8b8b94', fontSize: 14, marginBottom: 24 }}>
              Your queue is empty, but your music library is all here.
            </p>
            <MusicLibrarySection groups={library} activeId={null} />
          </div>
        ) : (
          <EmptyMusicState connected={connected} />
        )}
      </AppShell>
    );
  }

  return (
    <AppShell tab="music" connected={connected} profile={profile} mainStyle={{ maxWidth: 'none', width: '100%' }}>
      <MusicQueue queue={orderedQueue} nowPlaying={nowPlaying} library={library} />
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
