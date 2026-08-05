import type { UserProfile } from '@/lib/tokens';
import { HeaderBar } from './HeaderBar';
import { GlobalSidebar } from './GlobalSidebar';

/**
 * Shared app layout: top HeaderBar + global left sidebar + main content.
 *
 * The sidebar is the single GlobalSidebar instance — identical on every page.
 * Sub-pages pass `active` for link highlighting; the homepage passes the
 * additional filter/folder/tag state so the sidebar reflects the active view.
 */

export async function AppShell({
  children,
  active = '',
  connected,
  profile,
  lastSync,
  mainStyle,
  activeFolder,
  activeTag,
  showMusic,
  showHidden,
}: {
  children: React.ReactNode;
  active?: string;
  connected: boolean;
  profile?: UserProfile | null;
  lastSync?: number | null;
  mainStyle?: React.CSSProperties;
  activeFolder?: string | null;
  activeTag?: string | null;
  showMusic?: boolean;
  showHidden?: boolean;
}) {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <HeaderBar connected={connected} profile={profile} lastSync={lastSync} />
      <div
        className="app-grid"
        style={{ display: 'grid', gridTemplateColumns: '280px 1fr', flex: 1 }}
      >
        <GlobalSidebar
          active={active}
          activeFolder={activeFolder}
          activeTag={activeTag}
          showMusic={showMusic}
          showHidden={showHidden}
        />
        <main
          className="main-content"
          style={{ padding: '24px 32px', overflow: 'auto', ...mainStyle }}
        >
          {children}
        </main>
      </div>
    </div>
  );
}