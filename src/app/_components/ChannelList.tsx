import Link from 'next/link';
import { queryChannelsFromParams, PAGE_SIZE_OPTIONS } from '@/lib/queries';
import type { FolderRow, TagRow } from '@/lib/types';
import { ChannelRowItem } from './ChannelRowItem';
import { ChannelToolbar } from './ChannelToolbar';
import { PageHead } from './PageHead';
import { FolderActions } from './FolderActions';
import { PageSizeSelect } from './PageSizeSelect';
import { TagActions } from './TagActions';

interface Props {
  /** TAV-68: owner of the channel list being queried. */
  userId: string;
  search: string;
  folderId: string | null;
  tagId: string | null;
  showMusic: boolean;
  showHidden: boolean;
  sort: 'recent' | 'alpha' | 'alpha-desc' | 'subscribers' | 'videos' | 'updated';
  dir: 'asc' | 'desc' | undefined;
  page: number;
  pageSize: number;
  folders: FolderRow[];
  tags: TagRow[];
  urlWith: (overrides: Record<string, string | null | undefined>) => string;
}

const SORT_OPTIONS = [
  { value: 'alpha',       label: 'A → Z' },
  { value: 'alpha-desc',  label: 'Z → A' },
  { value: 'recent',      label: 'Recently subscribed' },
  { value: 'subscribers', label: 'Most subscribers' },
  { value: 'videos',      label: 'Most videos' },
  { value: 'updated',     label: 'Recently updated' },
] as const;

export async function ChannelList({ userId, search, folderId, tagId, showMusic, showHidden, sort, dir, page, pageSize, folders, tags, urlWith }: Props) {
  const { channels, total } = await queryChannelsFromParams(userId, {
    q: search,
    folder: folderId,
    tag: tagId,
    sort,
    dir,
    showMusic: showMusic ? '1' : undefined,
    showHidden: showHidden ? '1' : undefined,
    page,
    pageSize,
  });

  const folderById = new Map(folders.map(f => [f.id, f] as const));
  const tagById = new Map(tags.map(t => [t.id, t] as const));

  const totalPages = Math.ceil(total / pageSize);
  const safePage = Math.min(Math.max(1, page), Math.max(1, totalPages));
  const hasPrev = safePage > 1;
  const hasNext = safePage < totalPages;
  const startIdx = total === 0 ? 0 : (safePage - 1) * pageSize + 1;
  const endIdx = Math.min(safePage * pageSize, total);

  return (
    <div>
      <PageHead
        kicker="Your subscriptions"
        title={<>Channels <span className="grad-text">{total}</span></>}
        sub="Everything you follow, summarized and connected. Click a channel to open its dossier."
        actions={<span className="count-pill">{total} {total === 1 ? 'channel' : 'channels'}</span>}
      />

      {/* Toolbar (client component — auto-submits on sort change) */}
      <ChannelToolbar
        search={search}
        folderId={folderId}
        tagId={tagId}
        showMusic={showMusic}
        showHidden={showHidden}
        sort={sort}
        sortOptions={SORT_OPTIONS}
      />
      {(search || folderId || tagId) && (
        <div style={{ marginBottom: 12 }}>
          <Link className="btn btn-ghost" href="/">Clear</Link>
        </div>
      )}

      {/* Summary + top pagination */}
      <div className="channel-summary" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', color: '#8b8b94', fontSize: 14 }}>
          {search && <span>matching &ldquo;{search}&rdquo;</span>}
          {folderId && folderId !== 'none' && folderById.get(folderId) && (
            <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
              in <span className="chip" style={{ background: folderById.get(folderId)!.color ?? undefined, color: '#0a0a0c', borderColor: 'transparent' }}>{folderById.get(folderId)!.name}</span>
              <FolderActions folderId={folderId} folderName={folderById.get(folderId)!.name} />
            </span>
          )}
          {folderId === 'none' && <span>unfiled</span>}
          {tagId && tagId !== 'none' && tagById.get(tagId) && (
            <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
              tagged <span className="chip">#{tagById.get(tagId)!.name}</span>
              <TagActions tagId={tagId} tagName={tagById.get(tagId)!.name} />
            </span>
          )}
          {showMusic && <span className="chip chip-music">🎵 music</span>}
          {showHidden && <span className="chip">hidden</span>}
        </div>
        <div className="channel-summary-controls" style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
          {totalPages > 1 && (
            <CompactPagination
              page={safePage}
              totalPages={totalPages}
              hasPrev={hasPrev}
              hasNext={hasNext}
              urlWith={urlWith}
            />
          )}
          <PageSizeSelect
            pageSize={pageSize}
            options={PAGE_SIZE_OPTIONS.map(n => ({
              value: n,
              href: urlWith({ pageSize: n === 25 ? null : String(n), page: null }),
            }))}
          />
        </div>
      </div>

      {/* Grid */}
      {channels.length === 0 ? (
        <EmptyState folderId={folderId} tagId={tagId} search={search} />
      ) : (
        <>
          <div className="channel-grid">
            {channels.map(c => (
              <ChannelRowItem key={c.channel_id} channel={c} folders={folders} tags={tags} />
            ))}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <Pagination
              page={safePage}
              totalPages={totalPages}
              hasPrev={hasPrev}
              hasNext={hasNext}
              startIdx={startIdx}
              endIdx={endIdx}
              total={total}
              urlWith={urlWith}
            />
          )}
        </>
      )}
    </div>
  );
}

/** Shared button styles for pagination controls. */
const pageBtnStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  minWidth: 34,
  height: 34,
  padding: '0 10px',
  borderRadius: 999,
  fontSize: 14,
  fontWeight: 500,
  textDecoration: 'none',
  border: '1px solid #2a2a33',
  background: 'rgba(20, 20, 26, 0.7)',
  color: '#c2c2cb',
};
const activePageBtnStyle: React.CSSProperties = {
  ...pageBtnStyle,
  background: 'linear-gradient(135deg, #5b9eff, #7c5cff)',
  color: '#fff',
  borderColor: 'transparent',
  fontWeight: 700,
  boxShadow: '0 4px 18px rgba(91, 158, 255, 0.35)',
};
const disabledPageBtnStyle: React.CSSProperties = {
  ...pageBtnStyle,
  opacity: 0.4,
  pointerEvents: 'none' as const,
};

/** Compact prev/next + "page X of Y" for the top summary row. */
function CompactPagination({
  page,
  totalPages,
  hasPrev,
  hasNext,
  urlWith,
}: {
  page: number;
  totalPages: number;
  hasPrev: boolean;
  hasNext: boolean;
  urlWith: (overrides: Record<string, string | null | undefined>) => string;
}) {
  function pageHref(p: number): string {
    return urlWith({ page: p === 1 ? null : String(p) });
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
      {hasPrev ? (
        <Link href={pageHref(page - 1)} style={pageBtnStyle} aria-label="Previous page">‹</Link>
      ) : (
        <span style={disabledPageBtnStyle} aria-disabled>‹</span>
      )}
      <span style={{ fontSize: 12, color: '#8b8b94', whiteSpace: 'nowrap' }}>
        {page} / {totalPages}
      </span>
      {hasNext ? (
        <Link href={pageHref(page + 1)} style={pageBtnStyle} aria-label="Next page">›</Link>
      ) : (
        <span style={disabledPageBtnStyle} aria-disabled>›</span>
      )}
    </div>
  );
}

function Pagination({
  page,
  totalPages,
  hasPrev,
  hasNext,
  startIdx,
  endIdx,
  total,
  urlWith,
}: {
  page: number;
  totalPages: number;
  hasPrev: boolean;
  hasNext: boolean;
  startIdx: number;
  endIdx: number;
  total: number;
  urlWith: (overrides: Record<string, string | null | undefined>) => string;
}) {
  // Build a compact page-number list with ellipsis gaps.
  const pages: (number | 'ellipsis')[] = [];
  const window = 1; // pages on each side of current
  for (let i = 1; i <= totalPages; i++) {
    if (
      i === 1 ||
      i === totalPages ||
      (i >= page - window && i <= page + window)
    ) {
      pages.push(i);
    } else if (pages[pages.length - 1] !== 'ellipsis') {
      pages.push('ellipsis');
    }
  }

  function pageHref(p: number): string {
    return urlWith({ page: p === 1 ? null : String(p) });
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, marginTop: 20, paddingTop: 16, borderTop: '1px solid #2a2a33' }}>
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', justifyContent: 'center', alignItems: 'center' }}>
        {hasPrev ? (
          <Link href={pageHref(page - 1)} style={pageBtnStyle} aria-label="Previous page">
            ‹ Prev
          </Link>
        ) : (
          <span style={disabledPageBtnStyle} aria-disabled>‹ Prev</span>
        )}

        {pages.map((p, idx) =>
          p === 'ellipsis' ? (
            <span key={`e${idx}`} style={{ color: '#5a5a64', padding: '0 4px', fontSize: 13 }}>…</span>
          ) : p === page ? (
            <span key={p} style={activePageBtnStyle} aria-current="page">{p}</span>
          ) : (
            <Link key={p} href={pageHref(p)} style={pageBtnStyle}>{p}</Link>
          ),
        )}

        {hasNext ? (
          <Link href={pageHref(page + 1)} style={pageBtnStyle} aria-label="Next page">
            Next ›
          </Link>
        ) : (
          <span style={disabledPageBtnStyle} aria-disabled>Next ›</span>
        )}
      </div>

      <div style={{ color: '#8b8b94', fontSize: 12 }}>
        Showing {startIdx}–{endIdx} of {total}
      </div>
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
    <div style={{ padding: '60px 20px', textAlign: 'center', color: '#8b8b94', fontSize: 15, border: '1px dashed rgba(91, 158, 255, 0.35)', borderRadius: 16, background: 'rgba(91, 158, 255, 0.04)' }}>
      <div style={{ fontSize: 32, marginBottom: 8 }}>🪹</div>
      <div>{msg}</div>
    </div>
  );
}
