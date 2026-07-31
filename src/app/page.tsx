import Link from 'next/link';
import { countChannels, CHANNEL_PAGE_SIZE, PAGE_SIZE_OPTIONS } from '@/lib/queries';
import { listFolders, listTags, latestSyncRun } from '@/lib/repo';
import { isConnected, getUserProfile } from '@/lib/tokens';
import { SyncButton } from './_components/SyncButton';
import { ExportButton } from './_components/ExportButton';
import { AddFolderForm, AddTagForm } from './_components/AddFolderTagForms';
import { disconnectAction } from '@/app/actions';
import { HeaderBar } from './_components/HeaderBar';
import { ChannelList } from './_components/ChannelList';
import { ResponsiveSidebar } from './_components/ResponsiveSidebar';

interface PageProps {
  searchParams: Promise<{
    q?: string;
    folder?: string;
    tag?: string;
    sort?: string;
    dir?: string;
    showMusic?: string;
    showHidden?: string;
    page?: string;
    pageSize?: string;
  }>;
}

export default async function HomePage({ searchParams }: PageProps) {
  const params = await searchParams;
  const [connected, profile, lastSync, folders, tags, counts] = await Promise.all([
    isConnected(),
    getUserProfile(),
    latestSyncRun(),
    listFolders(),
    listTags(),
    countChannels(),
  ]);

  const activeFolder = params.folder ?? null;
  const activeTag = params.tag ?? null;
  const search = params.q ?? '';
  const showMusic = params.showMusic === '1';
  const showHidden = params.showHidden === '1';
  const sort = (params.sort as 'recent' | 'alpha' | 'alpha-desc' | 'subscribers' | 'videos' | 'updated') ?? 'alpha';
  const dir = (params.dir as 'asc' | 'desc') ?? undefined;
  const page = Math.max(1, parseInt(params.page ?? '1', 10) || 1);
  const pageSize = PAGE_SIZE_OPTIONS.includes(Number(params.pageSize) as typeof PAGE_SIZE_OPTIONS[number])
    ? Number(params.pageSize)
    : CHANNEL_PAGE_SIZE;

  const baseQuery: Record<string, string> = {};
  if (search) baseQuery.q = search;
  if (activeFolder) baseQuery.folder = activeFolder;
  if (activeTag) baseQuery.tag = activeTag;
  if (showMusic) baseQuery.showMusic = '1';
  if (showHidden) baseQuery.showHidden = '1';
  if (sort !== 'alpha') baseQuery.sort = sort;
  if (dir) baseQuery.dir = dir;
  if (pageSize !== CHANNEL_PAGE_SIZE) baseQuery.pageSize = String(pageSize);

  function urlWith(overrides: Record<string, string | null | undefined>): string {
    const merged = { ...baseQuery };
    for (const [k, v] of Object.entries(overrides)) {
      if (v == null) delete merged[k];
      else merged[k] = v;
    }
    const qs = new URLSearchParams(merged).toString();
    return qs ? `/?${qs}` : '/';
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <HeaderBar connected={connected} profile={profile} />

      <div className="app-grid" style={{ display: 'grid', gridTemplateColumns: '280px 1fr', flex: 1 }}>
        {/* Sidebar */}
        <ResponsiveSidebar>
          <section>
            <h3 style={sidebarHeading}>Library</h3>
            <SidebarLink href={urlWith({ folder: null, tag: null, showMusic: null })} active={!activeFolder && !activeTag && !showMusic}>
              <span>📺</span> All channels <Badge>{counts.total}</Badge>
            </SidebarLink>
            <SidebarLink href={urlWith({ folder: 'none', tag: null, showMusic: null })} active={activeFolder === 'none'}>
              <span>🗂</span> Unfiled <Badge>{counts.unfiled}</Badge>
            </SidebarLink>
            <SidebarLink href={urlWith({ showMusic: '1', folder: null, tag: null })} active={showMusic}>
              <span>🎵</span> Music <Badge>{counts.music}</Badge>
            </SidebarLink>
            <SidebarLink href={urlWith({ showHidden: showHidden ? null : '1', folder: null, tag: null })} active={showHidden}>
              <span>🙈</span> Hidden <Badge>{counts.hidden}</Badge>
            </SidebarLink>
          </section>

          <section>
            <h3 style={sidebarHeading}>Folders</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {folders.map((f: typeof folders[number]) => (
                <SidebarLink
                  key={f.id}
                  href={urlWith({ folder: activeFolder === f.id ? null : f.id, tag: null })}
                  active={activeFolder === f.id}
                >
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: f.color ?? '#5b9eff', display: 'inline-block' }} />
                  <span style={{ flex: 1 }}>{f.name}</span>
                </SidebarLink>
              ))}
            </div>
            <div style={{ marginTop: 8 }}>
              <AddFolderForm />
            </div>
          </section>

          <section>
            <h3 style={sidebarHeading}>Tags</h3>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {tags.length === 0 && (
                <span style={{ color: '#5a5a64', fontSize: 12 }}>no tags yet</span>
              )}
              {tags.map((t: typeof tags[number]) => (
                <Link
                  key={t.id}
                  href={urlWith({ tag: activeTag === t.id ? null : t.id, folder: null })}
                  className="chip"
                  style={{
                    background: activeTag === t.id ? '#5b9eff' : '#1f1f26',
                    color: activeTag === t.id ? '#0a0a0c' : '#c2c2cb',
                    borderColor: activeTag === t.id ? '#5b9eff' : '#2a2a33',
                  }}
                >
                  #{t.name}
                </Link>
              ))}
            </div>
            <div style={{ marginTop: 8 }}>
              <AddTagForm />
            </div>
          </section>

          <div style={{ marginTop: 'auto', borderTop: '1px solid #2a2a33', paddingTop: 16, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <SyncButton lastSync={lastSync?.started_at ?? null} />
            {connected && (
              <div style={{ marginTop: 8, width: '100%' }}>
                <ExportButton />
              </div>
            )}
            {connected && (
              <form action={disconnectAction} style={{ marginTop: 8, width: '100%' }}>
                <button className="btn btn-ghost" type="submit" style={{ fontSize: 11, width: '100%' }}>
                  Disconnect YouTube
                </button>
              </form>
            )}
          </div>
        </ResponsiveSidebar>

        {/* Main */}
        <main className="main-content" style={{ padding: '24px 32px', overflow: 'auto' }}>
          {!connected ? (
            <ConnectPrompt />
          ) : counts.total === 0 ? (
            <FirstRunSync lastSync={lastSync} />
          ) : (
            <ChannelList
              search={search}
              folderId={activeFolder}
              tagId={activeTag}
              showMusic={showMusic}
              showHidden={showHidden}
              sort={sort}
              dir={dir}
              page={page}
              pageSize={pageSize}
              folders={folders}
              tags={tags}
              urlWith={urlWith}
            />
          )}
        </main>
      </div>
    </div>
  );
}

const sidebarHeading: React.CSSProperties = {
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  fontSize: 11,
  color: '#8b8b94',
  marginBottom: 8,
  fontWeight: 600,
};

function SidebarLink({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '6px 8px',
        borderRadius: 6,
        fontSize: 13,
        color: active ? '#fff' : '#c2c2cb',
        background: active ? '#1f1f26' : 'transparent',
        textDecoration: 'none',
      }}
    >
      {children}
    </Link>
  );
}

function Badge({ children }: { children: React.ReactNode }) {
  return <span style={{ marginLeft: 'auto', fontSize: 11, color: '#8b8b94' }}>{children}</span>;
}

function ConnectPrompt() {
  return (
    <div style={{ maxWidth: 540, margin: '60px auto', textAlign: 'center' }}>
      <h1 style={{ fontSize: 32, fontWeight: 700, marginBottom: 8 }}>Welcome to 1minyt</h1>
      <p style={{ color: '#8b8b94', marginBottom: 28, fontSize: 15, lineHeight: 1.5 }}>
        Connect your YouTube account once. We pull your subscriptions, classify music automatically,
        and let you organize everything with folders, tags, and search.
      </p>
      <a className="btn btn-primary" href="/api/oauth/start" style={{ padding: '10px 24px', fontSize: 14 }}>
        Connect YouTube
      </a>
      <p style={{ color: '#5a5a64', fontSize: 12, marginTop: 24 }}>
        YouTube Data API v3 · scope: <code>youtube.readonly</code> · tokens stored locally in SQLite
      </p>
    </div>
  );
}

function FirstRunSync({ lastSync }: { lastSync: { started_at: number; status: string; channels_seen: number; channels_new: number; channels_updated: number; error: string | null } | null }) {
  return (
    <div style={{ maxWidth: 540, margin: '60px auto', textAlign: 'center' }}>
      <h2 style={{ fontSize: 22, fontWeight: 600, marginBottom: 8 }}>You&apos;re connected</h2>
      <p style={{ color: '#8b8b94', marginBottom: 28 }}>
        Hit <strong>Sync now</strong> in the sidebar to pull your subscriptions.
        We&apos;ll classify music channels automatically so you can hide them from your main view.
      </p>
      {lastSync?.error && (
        <div style={{ background: 'rgba(255, 99, 99, 0.1)', border: '1px solid rgba(255, 99, 99, 0.3)', padding: 12, borderRadius: 8, color: '#ff6363', fontSize: 13 }}>
          Last sync failed: {lastSync.error}
        </div>
      )}
    </div>
  );
}