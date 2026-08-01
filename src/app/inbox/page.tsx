import Link from 'next/link';
import { HeaderBar } from '../_components/HeaderBar';
import { InboxFeed } from '../_components/InboxFeed';
import { FilterSelect } from '../_components/FilterSelect';
import { listInboxVideos, listInboxCategories, listInboxChannels, INBOX_PAGE_SIZE } from '@/lib/inbox';
import { isConnected, getUserProfile } from '@/lib/tokens';
import { formatCount } from '../_lib/format';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: '1minyt — Inbox',
  description: 'Unified triage feed of new videos across all your subscriptions, ranked by relevance.',
};

interface PageProps {
  searchParams: Promise<{
    scope?: string;
    channel?: string;
    category?: string;
    uncaptioned?: string;
    page?: string;
  }>;
}

/**
 * YouTube category id → human label, for the topic filter dropdown.
 * Only the categories that commonly appear in subscription feeds.
 */
const CATEGORY_LABELS: Record<number, string> = {
  1: 'Film & Animation',
  2: 'Autos & Vehicles',
  10: 'Music',
  15: 'Pets & Animals',
  17: 'Sports',
  19: 'Travel & Events',
  20: 'Gaming',
  22: 'People & Blogs',
  23: 'Comedy',
  24: 'Entertainment',
  25: 'News & Politics',
  26: 'Howto & Style',
  27: 'Education',
  28: 'Science & Tech',
  29: 'Nonprofits & Activism',
};

export default async function InboxPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const scope = params.scope === 'saved' ? 'saved' : 'new';
  const channelId = params.channel ?? null;
  const categoryId = params.category ? Number(params.category) : null;
  const onlyUncaptioned = params.uncaptioned === '1';
  const page = Math.max(1, parseInt(params.page ?? '1', 10) || 1);
  const offset = (page - 1) * INBOX_PAGE_SIZE;

  const [connected, profile, categories, channels, result] = await Promise.all([
    isConnected(),
    getUserProfile(),
    listInboxCategories(),
    listInboxChannels(),
    listInboxVideos({
      scope,
      channelId: channelId && channelId !== 'all' ? channelId : null,
      categoryId: categoryId != null && Number.isFinite(categoryId) ? categoryId : null,
      onlyUncaptioned,
      limit: INBOX_PAGE_SIZE,
      offset,
    }),
  ]);

  const totalPages = Math.max(1, Math.ceil(result.total / INBOX_PAGE_SIZE));

  // Build a query-string helper for filter links.
  const baseQuery: Record<string, string> = { scope };
  if (channelId && channelId !== 'all') baseQuery.channel = channelId;
  if (categoryId != null && Number.isFinite(categoryId)) baseQuery.category = String(categoryId);
  if (onlyUncaptioned) baseQuery.uncaptioned = '1';

  function urlWith(overrides: Record<string, string | null | undefined>): string {
    const merged = { ...baseQuery };
    for (const [k, v] of Object.entries(overrides)) {
      if (v == null || v === 'all') delete merged[k];
      else merged[k] = v;
    }
    merged.page = '1'; // any filter change resets to page 1
    const qs = new URLSearchParams(merged).toString();
    return qs ? `/inbox?${qs}` : '/inbox';
  }

  function pageUrl(p: number): string {
    const merged = { ...baseQuery, page: String(p) };
    const qs = new URLSearchParams(merged).toString();
    return qs ? `/inbox?${qs}` : '/inbox';
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <HeaderBar connected={connected} profile={profile} />
      <main style={{ padding: '24px 32px', maxWidth: 900, margin: '0 auto', width: '100%' }}>
        <div style={{ marginBottom: 14 }}>
          <Link href="/" style={{ color: '#8b8b94', fontSize: 13, textDecoration: 'none' }}>← Back to subscriptions</Link>
        </div>

        <div style={{ marginBottom: 20 }}>
          <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 4 }}>📥 Inbox</h1>
          <p style={{ color: '#8b8b94', fontSize: 13, maxWidth: 600 }}>
            A unified feed of new videos across all your subscriptions, ranked by relevance (engagement × recency × channel interaction). Triage with dismiss, save, or summarize.
          </p>
        </div>

        {/* Scope toggle */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          <Link
            href={urlWith({ scope: 'new' })}
            className="chip"
            style={{
              background: scope === 'new' ? '#5b9eff' : '#1f1f26',
              color: scope === 'new' ? '#0a0a0c' : '#c2c2cb',
              borderColor: scope === 'new' ? '#5b9eff' : '#2a2a33',
              padding: '4px 12px',
              fontSize: 12,
            }}
          >
            New {scope === 'new' && result.total > 0 ? `(${result.total})` : ''}
          </Link>
          <Link
            href={urlWith({ scope: 'saved' })}
            className="chip"
            style={{
              background: scope === 'saved' ? '#f5c542' : '#1f1f26',
              color: scope === 'saved' ? '#0a0a0c' : '#c2c2cb',
              borderColor: scope === 'saved' ? '#f5c542' : '#2a2a33',
              padding: '4px 12px',
              fontSize: 12,
            }}
          >
            ★ Saved
          </Link>
        </div>

        {/* Filters — only relevant in the 'new' scope. */}
        {scope === 'new' && (
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 20, alignItems: 'center' }}>
            {/* Channel filter */}
            <FilterSelect
              value={channelId ?? 'all'}
              baseQuery={baseQuery}
              filterKey="channel"
              options={[
                { value: 'all', label: 'All channels' },
                ...channels.map(ch => ({ value: ch.channel_id, label: `${ch.channel_title} (${ch.video_count})` })),
              ]}
              style={{ width: 'auto', minWidth: 160, fontSize: 12, padding: '6px 10px' }}
            />

            {/* Category filter */}
            <FilterSelect
              value={categoryId != null ? String(categoryId) : 'all'}
              baseQuery={baseQuery}
              filterKey="category"
              options={[
                { value: 'all', label: 'All topics' },
                ...categories.map(cat => ({
                  value: String(cat.category_id),
                  label: `${CATEGORY_LABELS[cat.category_id] ?? `Category ${cat.category_id}`} (${cat.video_count})`,
                })),
              ]}
              style={{ width: 'auto', minWidth: 160, fontSize: 12, padding: '6px 10px' }}
            />

            {/* Uncaptioned toggle */}
            <Link
              href={urlWith({ uncaptioned: onlyUncaptioned ? null : '1' })}
              className="chip"
              style={{
                background: onlyUncaptioned ? 'rgba(255,155,107,0.12)' : '#1f1f26',
                color: onlyUncaptioned ? '#ff9b6b' : '#c2c2cb',
                borderColor: onlyUncaptioned ? 'rgba(255,155,107,0.35)' : '#2a2a33',
                padding: '4px 12px',
                fontSize: 12,
                textDecoration: 'none',
              }}
            >
              {onlyUncaptioned ? '✓ ' : ''}Only uncaptioned
            </Link>
          </div>
        )}

        {/* Feed */}
        <InboxFeed videos={result.videos} scope={scope} />

        {/* Pagination */}
        {totalPages > 1 && (
          <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginTop: 24, alignItems: 'center' }}>
            {page > 1 && (
              <Link href={pageUrl(page - 1)} className="btn btn-ghost" style={{ fontSize: 12, padding: '6px 12px' }}>
                ← Prev
              </Link>
            )}
            <span style={{ color: '#8b8b94', fontSize: 12 }}>
              Page {page} of {totalPages}
            </span>
            {page < totalPages && (
              <Link href={pageUrl(page + 1)} className="btn btn-ghost" style={{ fontSize: 12, padding: '6px 12px' }}>
                Next →
              </Link>
            )}
          </div>
        )}

        {/* Stats footer */}
        {result.videos.length > 0 && (
          <div style={{ marginTop: 24, color: '#5a5a64', fontSize: 11, textAlign: 'center' }}>
            {formatCount(result.total)} video{result.total === 1 ? '' : 's'} · sorted by relevance
          </div>
        )}
      </main>
    </div>
  );
}
