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

  // Fetch badge counts for the tab bar
  const badgeProps = await getBadgeCounts();

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <HeaderBar connected={connected} profile={profile} lastSync={lastSync} />
      {connected && (
        <TabBar
          active={tab}
          inboxCount={badgeProps.inboxCount}
          libraryCount={badgeProps.libraryCount}
          channelCount={badgeProps.channelCount}
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
 */
async function getBadgeCounts(): Promise<{
  inboxCount: number;
  libraryCount: number;
  channelCount: number;
}> {
  const { countInboxNew } = await import('@/lib/inbox');
  const { countQueued } = await import('@/lib/summarize-queue');
  const { countChannels } = await import('@/lib/queries');

  const [inboxCount, libraryCount, channelCount] = await Promise.all([
    countInboxNew(),
    countQueued(),
    countChannels(),
  ]);

  return {
    inboxCount,
    libraryCount,
    channelCount: channelCount.total,
  };
}
