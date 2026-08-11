import Link from 'next/link';
import { countChannels } from '@/lib/queries';
import { listFolders, listTags } from '@/lib/repo';
import type { FolderRow, TagRow } from '@/lib/types';
import { AddFolderForm, AddTagForm } from './AddFolderTagForms';

/**
 * Adaptive rail for the Channels tab.
 * Contains the folder/tag filter tree that used to live in GlobalSidebar.
 * Server component — fetches its own data.
 */

const railHeading: React.CSSProperties = {
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  fontSize: 11,
  color: '#8b8b94',
  marginBottom: 8,
  fontWeight: 600,
};

export async function ChannelRail({
  activeFolder = null,
  activeTag = null,
  showMusic = false,
  showHidden = false,
  activeHome = false,
}: {
  activeFolder?: string | null;
  activeTag?: string | null;
  showMusic?: boolean;
  showHidden?: boolean;
  activeHome?: boolean;
}) {
  const [counts, folders, tags] = await Promise.all([
    countChannels(),
    listFolders(),
    listTags(),
  ]);

  return (
    <aside className="rail" style={{ padding: '20px 16px', display: 'flex', flexDirection: 'column', gap: 24, overflow: 'auto' }}>
      <section>
        <h3 style={railHeading}>Channels</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <RailLink href="/" active={activeHome && !activeFolder && !activeTag && !showMusic && !showHidden}>
            <span>📺</span> All <Badge>{counts.total}</Badge>
          </RailLink>
          <RailLink href="/?folder=none" active={activeFolder === 'none'}>
            <span>🗂</span> Unfiled <Badge>{counts.unfiled}</Badge>
          </RailLink>
          <RailLink href="/?showMusic=1" active={showMusic}>
            <span>🎵</span> Music <Badge>{counts.music}</Badge>
          </RailLink>
          <RailLink href="/?showHidden=1" active={showHidden}>
            <span>🙈</span> Hidden <Badge>{counts.hidden}</Badge>
          </RailLink>
        </div>
      </section>

      <section>
        <h3 style={railHeading}>Folders</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {folders.map((f: FolderRow) => (
            <RailLink
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
            </RailLink>
          ))}
        </div>
        <div style={{ marginTop: 8 }}>
          <AddFolderForm />
        </div>
      </section>

      <section>
        <h3 style={railHeading}>Tags</h3>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {tags.length === 0 && (
            <span style={{ color: '#5a5a64', fontSize: 12 }}>no tags yet</span>
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
    </aside>
  );
}

function RailLink({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
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
