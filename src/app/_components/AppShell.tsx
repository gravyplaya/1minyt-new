import type { UserProfile } from '@/lib/tokens';
import { HeaderBar } from './HeaderBar';
import { TabBar, type TabId } from './TabBar';
import { ChannelRail } from './ChannelRail';
import { LibraryRail, type LibraryCollection } from './LibraryRail';
import { SettingsRail, type SettingsSection } from './SettingsRail';

/**
 * Shared app layout: top HeaderBar + TabBar + adaptive contextual rail + main content.
 *
 * The rail changes per active tab:
 *   channels → ChannelRail (folders/tags filter tree)
 *   watch    → no rail (full-width player + queue)
 *   music    → no rail (full-width player + queue)
 *   library  → LibraryRail (Saved/Liked/History/Summarized/Summarize-Later)
 *   settings → SettingsRail (Integrations/Labs)
 *   inbox    → no rail (filters are inline in the page)
 *   search   → no rail (full width)
 *
 * Pass `noRail` to suppress the rail even on tabs that normally have one
 * (used by channel detail pages where we want full width).
 */

const RAIL_WIDTH: Record<TabId, string> = {
  channels: '220px',
  watch: '0',
  music: '0',
  library: '220px',
  settings: '220px',
  inbox: '0',
  search: '0',
};

export async function AppShell({
  children,
  tab,
  connected,
  profile,
  lastSync,
  mainStyle,
  // Channel rail props
  activeFolder,
  activeTag,
  showMusic,
  showHidden,
  activeHome,
  // Library rail
  libraryActive,
  // Settings rail
  settingsActive,
  // Suppress rail entirely (channel detail, etc.)
  noRail = false,
}: {
  children: React.ReactNode;
  tab: TabId;
  connected: boolean;
  profile?: UserProfile | null;
  lastSync?: number | null;
  mainStyle?: React.CSSProperties;
  activeFolder?: string | null;
  activeTag?: string | null;
  showMusic?: boolean;
  showHidden?: boolean;
  activeHome?: boolean;
  libraryActive?: LibraryCollection;
  settingsActive?: SettingsSection;
  noRail?: boolean;
}) {
  const hasRail =
    connected &&
    !noRail &&
    ((tab === 'channels') ||
     (tab === 'library' && libraryActive) ||
     (tab === 'settings' && settingsActive));

  const railWidth = hasRail ? RAIL_WIDTH[tab] : '0';

  // Fetch badge counts for the tab bar. Only run when connected — the TabBar
  // is only rendered when connected, and the Watch/Music queue builders are
  // multi-CTE ranking queries we don't want to pay for on the disconnected
  // landing page.
  const badgeProps = connected ? await getBadgeCounts() : null;

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <HeaderBar connected={connected} profile={profile} lastSync={lastSync} />
      {connected && badgeProps && (
        <TabBar
          active={tab}
          inboxCount={badgeProps.inboxCount}
          libraryCount={badgeProps.libraryCount}
          channelCount={badgeProps.channelCount}
          watchCount={badgeProps.watchCount}
          musicCount={badgeProps.musicCount}
        />
      )}
      <div
        className="app-body"
        style={{
          display: 'grid',
          gridTemplateColumns: hasRail ? `${railWidth} 1fr` : '1fr',
          flex: 1,
        }}
      >
        {hasRail && (
          <div className="rail-container" style={{ borderRight: '1px solid #2a2a33', background: '#0e0e12', overflow: 'auto' }}>
            {tab === 'channels' && (
              <ChannelRail
                activeFolder={activeFolder}
                activeTag={activeTag}
                showMusic={showMusic}
                showHidden={showHidden}
                activeHome={activeHome}
              />
            )}
            {tab === 'library' && libraryActive && (
              <LibraryRail active={libraryActive} />
            )}
            {tab === 'settings' && settingsActive && (
              <SettingsRail active={settingsActive} />
            )}
          </div>
        )}
        <main
          className="main-content"
          style={{ padding: '24px 32px', overflow: 'auto', width: '100%', ...mainStyle }}
        >
          {children}
        </main>
      </div>
    </div>
  );
}

/**
 * Fetch badge counts for the tab bar.
 * These are cheap aggregate queries that run in parallel.
 *
 * The Watch and Music badges show the queue length (unwatched/unplayed count)
 * — same treatment as the existing Inbox badge. We use the queue builders from
 * `src/lib/queue.ts` (TAV-54 / TAV-55) with a limit of 50 and report the
 * returned row count, so the badge reflects how many items the queue would
 * surface (capped at the limit). This is intentionally a row count, not a
 * full `COUNT(*)`, to bound the cost of the multi-CTE ranking queries.
 */
async function getBadgeCounts(): Promise<{
  inboxCount: number;
  libraryCount: number;
  channelCount: number;
  watchCount: number;
  musicCount: number;
}> {
  const { countInboxNew } = await import('@/lib/inbox');
  const { countQueued } = await import('@/lib/summarize-queue');
  const { countChannels } = await import('@/lib/queries');
  const { buildWatchQueue, buildMusicQueue } = await import('@/lib/queue');

  const [inboxCount, libraryCount, channelCount, watchQueue, musicQueue] = await Promise.all([
    countInboxNew(),
    countQueued(),
    countChannels(),
    buildWatchQueue(50),
    buildMusicQueue(50),
  ]);

  return {
    inboxCount,
    libraryCount,
    channelCount: channelCount.total,
    watchCount: watchQueue.length,
    musicCount: musicQueue.length,
  };
}
