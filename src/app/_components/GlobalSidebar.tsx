import Link from 'next/link';
import { countChannels } from '@/lib/queries';
import { listFolders, listTags } from '@/lib/repo';
import { countInboxNew } from '@/lib/inbox';
import { countQueued } from '@/lib/summarize-queue';
import { countSummarizedVideos } from '@/lib/video-repo';
import type { FolderRow, TagRow } from '@/lib/types';
import { ResponsiveSidebar } from './ResponsiveSidebar';
import { AddFolderForm, AddTagForm } from './AddFolderTagForms';

/**
 * The one global left sidebar, shared by the homepage and every sub-page.
 *
 * Fetches its own badge counts, channel aggregates, folders, and tags so it
 * stays self-contained. Takes `active` for page highlighting plus optional
 * folder/tag/filter active states (used by the homepage to reflect the
 * current filter selection).
 *
 * Server component.
 */

const sidebarHeading: React.CSSProperties = {
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  fontSize: 11,
  color: '#8b8b94',
  marginBottom: 8,
  fontWeight: 600,
};

export async function GlobalSidebar({
  active = '',
  activeFolder = null,
  activeTag = null,
  showMusic = false,
  showHidden = false,
}: {
  active?: string;
  activeFolder?: string | null;
  activeTag?: string | null;
  showMusic?: boolean;
  showHidden?: boolean;
}) {
  const [inboxCount, queuedCount, summarizedCount, counts, folders, tags] = await Promise.all([
    countInboxNew(),
    countQueued(),
    countSummarizedVideos(),
    countChannels(),
    listFolders(),
    listTags(),
  ]);

  return (
    <ResponsiveSidebar>
      <section>
        <h3 style={sidebarHeading}>Library</h3>
        <SidebarLink href="/inbox" active={active === 'inbox'}>
          <span>📥</span> Inbox{' '}
          {inboxCount > 0 && <Badge>{inboxCount}</Badge>}
        </SidebarLink>
        <SidebarLink href="/summarize-later" active={active === 'summarize-later'}>
          <span>🔖</span> Summarize Later{' '}
          {queuedCount > 0 && <Badge>{queuedCount}</Badge>}
        </SidebarLink>
        <SidebarLink href="/search" active={active === 'search'}>
          <span>🔍</span> Search
        </SidebarLink>
        <SidebarLink href="/saved" active={active === 'saved'}>
          <span>★</span> Saved
        </SidebarLink>
        <SidebarLink href="/likes" active={active === 'likes'}>
          <span>♥</span> Liked
        </SidebarLink>
        <SidebarLink href="/history" active={active === 'history'}>
          <span>◷</span> History
        </SidebarLink>
        <SidebarLink href="/summarized" active={active === 'summarized'}>
          <span>✦</span> Summarized{' '}
          {summarizedCount > 0 && <Badge>{summarizedCount}</Badge>}
        </SidebarLink>
        <SidebarLink href="/metrics" active={active === 'metrics'}>
          <span>📊</span> Metrics
        </SidebarLink>
        <SidebarLink href="/settings" active={active === 'settings'}>
          <span>⚙</span> Settings
        </SidebarLink>
      </section>

      <section>
        <h3 style={sidebarHeading}>Folders</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <SidebarLink href="/" active={!activeFolder && !activeTag && !showMusic && !showHidden && active === 'home'}>
            <span>📺</span> All channels <Badge>{counts.total}</Badge>
          </SidebarLink>
          <SidebarLink href="/?folder=none" active={activeFolder === 'none'}>
            <span>🗂</span> Unfiled <Badge>{counts.unfiled}</Badge>
          </SidebarLink>
          <SidebarLink href="/?showMusic=1" active={showMusic}>
            <span>🎵</span> Music <Badge>{counts.music}</Badge>
          </SidebarLink>
          <SidebarLink href="/?showHidden=1" active={showHidden}>
            <span>🙈</span> Hidden <Badge>{counts.hidden}</Badge>
          </SidebarLink>
        </div>
        <div style={{ borderTop: '1px solid #2a2a33', margin: '6px 0', }} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {folders.map((f: FolderRow) => (
            <SidebarLink
              key={f.id}
              href={`/?folder=${encodeURIComponent(f.id)}`}
              active={activeFolder === f.id}
            >
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  background: f.color ?? '#5b9eff',
                  display: 'inline-block',
                }}
              />
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
            <span style={{ color: '#5a5a64', fontSize: 12 }}>
              no tags yet
            </span>
          )}
          {tags.map((t: TagRow) => (
            <Link
              key={t.id}
              href={`/?tag=${encodeURIComponent(t.id)}`}
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
    </ResponsiveSidebar>
  );
}

function SidebarLink({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
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
  return (
    <span style={{ marginLeft: 'auto', fontSize: 11, color: '#8b8b94' }}>
      {children}
    </span>
  );
}