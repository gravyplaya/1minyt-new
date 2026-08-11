import Link from 'next/link';

/**
 * Top-level tab navigation. 5 tabs that group the former 10 sidebar links.
 * Server component — fetches badge counts for Inbox and Library (Summarize Later).
 */

export type TabId = 'channels' | 'inbox' | 'library' | 'search' | 'settings';

interface TabBarProps {
  active: TabId;
  inboxCount: number;
  libraryCount: number;
  channelCount: number;
}

export function TabBar({ active, inboxCount, libraryCount, channelCount }: TabBarProps) {
  const tabs: Array<{
    id: TabId;
    label: string;
    href: string;
    badge?: number;
  }> = [
    { id: 'channels', label: 'Channels', href: '/', badge: channelCount },
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
