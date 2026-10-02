import Link from 'next/link';
import type { UserProfile } from '@/lib/tokens';
import { PasteUrlBox } from './PasteUrlBox';
import { SyncButton } from './SyncButton';
import { SidebarUserMenu } from './SidebarUserMenu';
import { Logo } from './Logo';
import { ChannelRail } from './ChannelRail';
import { LibraryRail, type LibraryCollection } from './LibraryRail';
import { SettingsRail, type SettingsSection } from './SettingsRail';

/**
 * TAV-71: shared app layout — a fixed glass sidebar (nav + user popover)
 * plus a floating glass topbar (paste-a-URL + sync), extending the landing
 * page's visual language into the app. The old flat HeaderBar + TabBar +
 * rails chrome collapsed into this single shell.
 *
 * The contextual rail changes per active tab, as before:
 *   channels → ChannelRail (folders/tags filter tree)
 *   watch    → no rail (full-width player + queue)
 *   music    → no rail (full-width player + queue)
 *   library  → LibraryRail (Saved/Liked/History/Summarized/Summarize-Later)
 *   settings → SettingsRail (Integrations/Labs)
 *   inbox    → no rail (filters are inline in the page)
 *   search   → no rail (full width)
 *
 * Settings lives in the user popover (bottom of the sidebar), not the nav.
 *
 * Signed-out visitors (landing page + anonymous paste/watch) get the "bare"
 * shell: no sidebar, no ambient field — just the floating topbar with the
 * brand and a Sign-in link. The landing page brings its own WebGL scene.
 */

export type TabId = 'channels' | 'watch' | 'music' | 'inbox' | 'library' | 'search' | 'settings';

export async function AppShell({
  children,
  tab,
  connected,
  userId,
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
  /** TAV-68: session user id — scoped badge/rail queries. Null when signed out. */
  userId?: string | null;
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

  // Badge counts for the sidebar nav + mobile strip. Only run when
  // connected — the Watch/Music queue builders are multi-CTE ranking
  // queries we don't want to pay for on the disconnected landing page.
  // TAV-68: counts are scoped to the session user.
  const badgeProps = connected && userId ? await getBadgeCounts(userId) : null;

  return (
    <div className={`app-shell${connected ? '' : ' app-shell-bare'}`}>
      {/* Ambient gradient field — skipped on the landing page (own canvas) */}
      {connected && (
        <div className="app-ambient" aria-hidden="true">
          <div className="app-ambient-grid" />
        </div>
      )}

      {/* Glass sidebar — connected users only */}
      {connected && (
        <aside className="app-sidebar">
          <div className="app-sidebar-inner">
            <Link className="sidebar-brand" href="/">
              <Logo size={30} />
              <span className="sidebar-brand-name">1minyt</span>
              <span className="sidebar-brand-beta">beta</span>
            </Link>

            <nav className="sidebar-nav" aria-label="Main">
              <SidebarNav tab={tab} libraryActive={libraryActive} badges={badgeProps} />
            </nav>

            <div className="sidebar-foot">
              <SidebarUserMenu
                connected={connected}
                displayName={profile?.displayName ?? 'Account'}
                avatarUrl={profile?.avatarUrl ?? null}
                lastSyncLabel={lastSync ? humanAgo(lastSync) : null}
              />
            </div>
          </div>
        </aside>
      )}

      <div className="app-main">
        {/* Floating glass topbar: brand (signed out) / paste + sync (signed in) */}
        <div className="app-topbar">
          {!connected && (
            <Link className="topbar-brand" href="/">
              <Logo size={24} />
              1minyt
            </Link>
          )}
          {connected && <PasteUrlBox />}
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 10, alignItems: 'center' }}>
            {connected ? (
              <SyncButton lastSync={lastSync ?? null} />
            ) : (
              <a href="/api/oauth/start" className="btn btn-primary" style={{ textDecoration: 'none' }}>
                Sign in
              </a>
            )}
          </div>
        </div>

        {/* Mobile nav strip — sidebar collapses to chips under 960px */}
        {connected && (
          <nav className="app-mobile-nav" aria-label="Main">
            <SidebarNavLinks tab={tab} libraryActive={libraryActive} badges={badgeProps} />
          </nav>
        )}

        <div className={`app-body${hasRail ? ' has-rail' : ''}`}>
          {hasRail && (
            <div className="app-rail">
              {tab === 'channels' && (
                <ChannelRail
                  userId={userId ?? ''}
                  activeFolder={activeFolder}
                  activeTag={activeTag}
                  showMusic={showMusic}
                  showHidden={showHidden}
                  activeHome={activeHome}
                />
              )}
              {tab === 'library' && libraryActive && (
                <LibraryRail active={libraryActive} userId={userId ?? ''} />
              )}
              {tab === 'settings' && settingsActive && (
                <SettingsRail active={settingsActive} />
              )}
            </div>
          )}
          <main className="main-content" style={mainStyle}>
            {children}
          </main>
        </div>
      </div>
    </div>
  );
}

/** Sidebar nav groups: one idea per group, Settings lives in the user popover. */
function SidebarNav({
  tab,
  libraryActive,
  badges,
}: {
  tab: TabId;
  libraryActive?: LibraryCollection;
  badges: BadgeCounts | null;
}) {
  return <SidebarNavLinks tab={tab} libraryActive={libraryActive} badges={badges} nav />;
}

/** Shared link list — renders inside both the sidebar and the mobile strip. */
function SidebarNavLinks({
  tab,
  libraryActive,
  badges,
  nav = false,
}: {
  tab: TabId;
  libraryActive?: LibraryCollection;
  badges: BadgeCounts | null;
  nav?: boolean;
}) {
  // /chat renders under the library tab — highlight "Chat", not "Library".
  const activeId: NavId = tab === 'library' && libraryActive === 'chat' ? 'chat' : tab;
  const groups: Array<{
    label: string;
    items: ReturnType<typeof item>[];
  }> = [
    {
      label: 'Watch',
      items: [
        item('channels', 'Home', '/', badges?.channelCount, <HomeIcon />),
        item('watch', 'Watch', '/watch', badges?.watchCount, <WatchIcon />, true),
        item('music', 'Music', '/music', badges?.musicCount, <MusicIcon />),
      ],
    },
    {
      label: 'Organize',
      items: [
        item('inbox', 'Inbox', '/inbox', badges?.inboxCount, <InboxIcon />),
        item('library', 'Library', '/saved', badges?.libraryCount, <LibraryIcon />),
      ],
    },
    {
      label: 'Think',
      items: [
        item('search', 'Search', '/search', undefined, <SearchIcon />),
        item('chat', 'Chat', '/chat', undefined, <ChatIcon />),
      ],
    },
  ];

  if (!nav) {
    // Mobile strip: flat chip list
    return (
      <>
        {groups.flatMap(g => g.items.map(i => (
          <Link
            key={i.id + i.href}
            href={i.href}
            className={activeId === i.id ? 'active' : undefined}
          >
            {i.label}
            {i.badge != null && i.badge > 0 ? ` · ${i.badge}` : ''}
          </Link>
        )))}
      </>
    );
  }

  return (
    <>
      {groups.map(g => (
        <div key={g.label}>
          <div className="sidebar-nav-label">{g.label}</div>
          {g.items.map(i => (
            <Link
              key={i.id + i.href}
              className={`sidebar-nav-item${activeId === i.id ? ' active' : ''}`}
              href={i.href}
            >
              {i.icon}
              <span>{i.label}</span>
              {i.badge != null && i.badge > 0 && (
                <span className={`sidebar-nav-badge${i.hot ? ' hot' : ''}`}>{i.badge}</span>
              )}
            </Link>
          ))}
        </div>
      ))}
    </>
  );
}

type BadgeCounts = {
  inboxCount: number;
  libraryCount: number;
  channelCount: number;
  watchCount: number;
  musicCount: number;
};

/** Sidebar nav ids — 'chat' maps onto the library tab (LibraryChatPanel). */
type NavId = TabId | 'chat';

function item(
  id: NavId,
  label: string,
  href: string,
  badge: number | undefined,
  icon: React.ReactNode,
  hot = false,
) {
  return { id, label, href, badge, icon, hot };
}

/* Inline nav icons — 19px stroke icons matching the landing style. */

function HomeIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M3 10.5 12 3l9 7.5V21H3z" />
      <path d="M9 21v-7h6v7" />
    </svg>
  );
}
function WatchIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <rect x="2" y="4" width="20" height="16" rx="3" />
      <path d="m10 9 5 3-5 3z" />
    </svg>
  );
}
function MusicIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M9 18V6l10-2v12" />
      <circle cx="7" cy="18" r="2.5" />
      <circle cx="17" cy="16" r="2.5" />
    </svg>
  );
}
function InboxIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M22 12h-6l-2 3h-4l-2-3H2" />
      <path d="M5 4h14l3 8v8H2v-8z" />
    </svg>
  );
}
function LibraryIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M12 21C7 17 3 13.5 3 9.5 3 6.5 5.5 4 8.5 4c2 0 3 1 3.5 2 .5-1 1.5-2 3.5-2 3 0 5.5 2.5 5.5 5.5 0 4-4 7.5-9 11.5z" />
    </svg>
  );
}
function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <circle cx="11" cy="11" r="7" />
      <path d="m21 21-4.3-4.3" />
    </svg>
  );
}
function ChatIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}

/**
 * Fetch badge counts for the sidebar nav.
 * These are cheap aggregate queries that run in parallel.
 *
 * The Watch and Music badges show the queue length (unwatched/unplayed count)
 * — same treatment as the Inbox badge. We use the queue builders from
 * `src/lib/queue.ts` (TAV-54 / TAV-55) with a limit of 50 and report the
 * returned row count, so the badge reflects how many items the queue would
 * surface (capped at the limit). This is intentionally a row count, not a
 * full `COUNT(*)`, to bound the cost of the multi-CTE ranking queries.
 */
async function getBadgeCounts(userId: string): Promise<BadgeCounts> {
  const { countInboxNew } = await import('@/lib/inbox');
  const { countQueued } = await import('@/lib/summarize-queue');
  const { countChannels } = await import('@/lib/queries');
  const { buildWatchQueue, buildMusicQueue } = await import('@/lib/queue');

  const [inboxCount, libraryCount, channelCount, watchQueue, musicQueue] = await Promise.all([
    countInboxNew(userId),
    countQueued(userId),
    countChannels(userId),
    buildWatchQueue(userId, 50),
    buildMusicQueue(userId, 50),
  ]);

  return {
    inboxCount,
    libraryCount,
    channelCount: channelCount.total,
    watchCount: watchQueue.length,
    musicCount: musicQueue.length,
  };
}

function humanAgo(unixSeconds: number): string {
  const diff = Math.floor(Date.now() / 1000) - unixSeconds;
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}
