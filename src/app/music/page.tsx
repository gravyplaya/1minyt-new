import { redirect } from 'next/navigation';
import { buildMusicQueue, listMusicLibrary } from '@/lib/queue';
import { getVideo } from '@/lib/video-repo';
import { computeMusicVideoPresentation } from '@/lib/music-video-pref';
import { isConnected, getUserProfile } from '@/lib/tokens';
import { AppShell } from '../_components/AppShell';
import { MusicQueue, MusicLibrarySection } from '../_components/MusicQueue';
import type { MusicLibraryGroup, MusicQueueItem } from '@/lib/types';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<{ v?: string; queue?: string }>;
}

/**
 * TAV-57: /music route — a player-first music consumption surface.
 *
 * Server component: calls buildMusicQueue(20) and listMusicLibrary(), passing
 * both to the client MusicQueue component.
 *
 * Now-playing resolution: an explicit `?v=` naming any track from a
 * music-flagged channel plays that track and turns Up Next into the rest of
 * that artist's catalogue ("artist radio"). A `?v=<id>&queue=1` view keeps
 * the ranked queue as Up Next instead. Cold load (or an unresolvable `?v=`)
 * never renders unpinned: it redirects to the top-ranked track with
 * `queue=1`, pinning now-playing in the URL. Without the pin the server
 * re-resolves now-playing from buildMusicQueue() on every render — and the
 * play-history write that fires every 30 seconds of playback refreshes this
 * route while the playing track sits under the queue's 24h played-cooldown,
 * so each re-render swapped in a new "top" track mid-song (tracks changed
 * every ~30 seconds). Pinned, the song only changes when it completes
 * (MusicQueue's onEnded advance) or when the user picks a track.
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

  // `queue=1` marks a queue-driven view (the cold-load redirect below): the
  // ranked Music queue stays as Up Next instead of switching to artist radio.
  const queueView = params.queue === '1';

  // Resolve an explicit track pick against the full library (every music
  // track, not just the ranked page) — no extra query needed.
  const libraryMatch = requestedId
    ? library.flatMap((g) => g.tracks).find((t) => t.video_id === requestedId) ?? null
    : null;

  // Pin the queue-driven now-playing in the URL (see header comment): cold
  // load — or a `?v=` that resolves to nothing — redirects to the top-ranked
  // track so re-renders can't silently swap the playing song. The
  // `pinId !== requestedId` guard prevents a redirect loop if the top-ranked
  // track somehow isn't in the library (then the unpinned cold-load branch
  // below renders, as before).
  const pinId = !libraryMatch && queue.length > 0 ? queue[0].video_id : null;
  if (pinId && pinId !== requestedId) {
    redirect(`/music?v=${encodeURIComponent(pinId)}&queue=1`);
  }

  let nowPlaying: MusicQueueItem | null;
  let orderedQueue: MusicQueueItem[];

  if (libraryMatch) {
    // Artist radio: play the picked track; Up Next = the rest of that
    // artist's catalogue (seen/skipped tracks excluded so skip/defer stick).
    // Prefer the queue's own row for now-playing when present — same display
    // fields, but keeps the real score/is_pinned values. When the pick isn't
    // on the queue page, hydrate its video presentation from the cached row
    // (the library shape doesn't carry tags/category/video_pref).
    nowPlaying =
      queue.find((q) => q.video_id === libraryMatch.video_id) ??
      (await hydrateLibraryTrackAsQueueItem(libraryMatch));
    if (queueView) {
      // Queue-driven view: Up Next is the ranked queue minus the playing
      // track — what a cold load showed before now-playing was pinned.
      orderedQueue = queue
        .filter((q) => q.video_id !== libraryMatch.video_id)
        .slice(0, 19);
    } else {
      const artist = library.find((g) => g.channel_title === libraryMatch.channel_title);
      orderedQueue = (artist?.tracks ?? [])
        .filter((t) => t.video_id !== libraryMatch.video_id && !t.is_seen)
        .slice(0, 19)
        .map((t) => ({
          ...t,
          score: 0,
          is_pinned: false,
          // Up Next rows never render the player; compute presentation from the
          // fields the library shape has (title + channel) so the type holds and
          // the toggle labels stay sensible if one becomes now-playing.
          ...presentationFromLibraryTrack(t),
        }));
    }
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

/**
 * TAV-62: Turn a browsable-library track into a full MusicQueueItem for
 * now-playing. The library shape lacks tags/category/video_pref, so fetch the
 * cached videos row once and compute the video presentation from it. Falls
 * back to heuristic inputs already available on the track when the row is
 * missing (deleted between renders — never in practice).
 */
async function hydrateLibraryTrackAsQueueItem(
  track: MusicLibraryGroup['tracks'][number],
): Promise<MusicQueueItem> {
  const row = await getVideo(track.video_id);
  const presentation = computeMusicVideoPresentation({
    title: row?.title ?? track.title,
    channelTitle: track.channel_title,
    tags: row?.tags ?? null,
    categoryId: row?.category_id ?? null,
    videoPref: row?.video_pref ?? null,
  });
  return {
    video_id: track.video_id,
    title: track.title,
    channel_title: track.channel_title,
    thumbnail_url: track.thumbnail_url,
    duration_seconds: track.duration_seconds,
    published_at: track.published_at,
    score: 0,
    is_pinned: false,
    video_pref: presentation.pref,
    video_pref_source: presentation.source,
  };
}

/**
 * TAV-62: presentation fields for a library track when no cached row is
 * fetched (Up Next rows). Title + channel cover most of the heuristic.
 */
function presentationFromLibraryTrack(
  track: MusicLibraryGroup['tracks'][number],
): Pick<MusicQueueItem, 'video_pref' | 'video_pref_source'> {
  const { pref, source } = computeMusicVideoPresentation({
    title: track.title,
    channelTitle: track.channel_title,
  });
  return { video_pref: pref, video_pref_source: source };
}
