import Link from 'next/link';
import { queryChannelsFromParams } from '@/lib/queries';
import type { FolderRow, TagRow } from '@/lib/types';
import { ChannelRowItem } from './ChannelRowItem';

interface Props {
  search: string;
  folderId: string | null;
  tagId: string | null;
  showMusic: boolean;
  showHidden: boolean;
  sort: 'recent' | 'alpha' | 'subscribers' | 'videos' | 'updated';
  dir: 'asc' | 'desc' | undefined;
  folders: FolderRow[];
  tags: TagRow[];
  urlWith: (overrides: Record<string, string | null | undefined>) => string;
}

const SORT_OPTIONS = [
  { value: 'alpha',       label: 'A → Z' },
  { value: 'recent',      label: 'Recently subscribed' },
  { value: 'subscribers', label: 'Most subscribers' },
  { value: 'videos',      label: 'Most videos' },
  { value: 'updated',     label: 'Recently updated' },
] as const;

export function ChannelList({ search, folderId, tagId, showMusic, showHidden, sort, dir, folders, tags, urlWith }: Props) {
  const channels = queryChannelsFromParams({ q: search, folder: folderId, tag: tagId, sort, dir, showMusic: showMusic ? '1' : undefined, showHidden: showHidden ? '1' : undefined });

  const folderById = new Map(folders.map(f => [f.id, f] as const));
  const tagById = new Map(tags.map(t => [t.id, t] as const));

  return (
    <div>
      {/* Toolbar */}
      <form action="/" method="get" style={{ display: 'flex', gap: 8, marginBottom: 18, flexWrap: 'wrap', alignItems: 'center' }}>
        <input
          className="input"
          type="search"
          name="q"
          defaultValue={search}
          placeholder="Search channels, handles, descriptions…"
          style={{ flex: 1, minWidth: 240 }}
        />
        {folderId && <input type="hidden" name="folder" value={folderId} />}
        {tagId && <input type="hidden" name="tag" value={tagId} />}
        {showMusic && <input type="hidden" name="showMusic" value="1" />}
        {showHidden && <input type="hidden" name="showHidden" value="1" />}
        <select
          className="input"
          name="sort"
          defaultValue={sort}
          onChange={e => (e.currentTarget.form as HTMLFormElement).submit()}
          style={{ width: 'auto', minWidth: 160 }}
        >
          {SORT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <button className="btn" type="submit">Search</button>
        {(search || folderId || tagId) && (
          <Link className="btn btn-ghost" href="/">Clear</Link>
        )}
      </form>

      {/* Summary */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, color: '#8b8b94', fontSize: 13 }}>
        <strong style={{ color: '#e7e7ea' }}>{channels.length}</strong>
        <span>{channels.length === 1 ? 'channel' : 'channels'}</span>
        {search && <span>matching &ldquo;{search}&rdquo;</span>}
        {folderId && folderId !== 'none' && folderById.get(folderId) && (
          <span>in <span className="chip" style={{ background: folderById.get(folderId)!.color ?? undefined, color: '#0a0a0c', borderColor: 'transparent' }}>{folderById.get(folderId)!.name}</span></span>
        )}
        {folderId === 'none' && <span>unfiled</span>}
        {tagId && tagId !== 'none' && tagById.get(tagId) && <span>tagged <span className="chip">#{tagById.get(tagId)!.name}</span></span>}
        {showMusic && <span className="chip chip-music">🎵 music</span>}
        {showHidden && <span className="chip">hidden</span>}
      </div>

      {/* List */}
      {channels.length === 0 ? (
        <EmptyState folderId={folderId} tagId={tagId} search={search} />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {channels.map(c => (
            <ChannelRowItem key={c.channel_id} channel={c} folders={folders} tags={tags} />
          ))}
        </div>
      )}
    </div>
  );
}

function EmptyState({ folderId, tagId, search }: { folderId: string | null; tagId: string | null; search: string }) {
  let msg = 'No channels yet.';
  if (search) msg = `No channels match "${search}".`;
  else if (folderId === 'none') msg = 'No unfiled channels — everything is in a folder.';
  else if (folderId) msg = 'This folder is empty.';
  else if (tagId === 'none') msg = 'No untagged channels.';
  else if (tagId) msg = 'No channels with this tag yet.';
  return (
    <div style={{ padding: '60px 20px', textAlign: 'center', color: '#8b8b94', border: '1px dashed #2a2a33', borderRadius: 12 }}>
      <div style={{ fontSize: 32, marginBottom: 8 }}>🪹</div>
      <div>{msg}</div>
    </div>
  );
}