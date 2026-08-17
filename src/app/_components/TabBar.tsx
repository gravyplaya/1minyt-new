import Link from 'next/link';

/**
 * Top-level tab navigation. 7 tabs that group the former 10 sidebar links.
 * Server component — fetches badge counts for Inbox, Library (Summarize Later),
 * Watch (unwatched queue length) and Music (unplayed queue length).
 */

export type TabId = 'channels' | 'watch' | 'music' | 'inbox' | 'library' | 'search' | 'settings';

interface TabBarProps {
  active: TabId;
  inboxCount: number;
  libraryCount: number;
  channelCount: number;
  watchCount: number;
  musicCount: number;
}

export function TabBar({ active, inboxCount, libraryCount, channelCount, watchCount, musicCount }: TabBarProps) {
  const tabs: Array<{
    id: TabId;
    label: string;
    href: string;
    badge?: number;
  }> = [
    { id: 'channels', label: 'Channels', href: '/', badge: channelCount },
    { id: 'watch', label: 'Watch', href: '/watch', badge: watchCount },
    { id: 'music', label: 'Music', href: '/music', badge: musicCount },
    { id: 'inbox', label: 'Inbox', href: '/inbox', badge: inboxCount },
    { id: 'library', label: 'Library', href: '/saved', badge: libraryCount },
    { id: 'search', label: 'Search', href: '/search' },
    { id: 'settings', label: 'Settings', href: '/settings' },
  ];

  return (
    <nav className="tab-bar" role="tablist">
      {tabs.map((tab) => (
        <Link
          key={tab.id}
          href={tab.href}
          role="tab"
          aria-selected={active === tab.id}
          className={active === tab.id ? 'tab-item tab-item-active' : 'tab-item'}
          style={{ textDecoration: 'none' }}
        >
          <span>{tab.label}</span>
          {tab.badge != null && tab.badge > 0 && (
            <span className="tab-badge">{tab.badge}</span>
          )}
        </Link>
      ))}
    </nav>
  );
}
