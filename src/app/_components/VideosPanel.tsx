'use client';

import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { VideoWithSummary } from '@/lib/types';
import { fetchTranscriptAction, getUnsummarizedVideosAction, refreshChannelVideosAction, summarizeVideoAction } from '@/app/actions';
import { VideoSummaryRow } from './VideoSummaryRow';

/**
 * The "Videos" section of the channel page. Loads cached video rows on first
 * render (passed from the server), then offers a "Refresh from YouTube" button
 * that pulls the latest uploads and updates the list in place.
 *
 * Each row is a `VideoSummaryRow` — the 1-click summarize interaction lives
 * there. This panel only handles the list-level refresh.
 */
const PAGE_SIZE = 30;

export function VideosPanel({
  channelId,
  initialVideos,
  connected,
}: {
  channelId: string;
  initialVideos: VideoWithSummary[];
  connected: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [loadingMore, startLoadingMore] = useTransition();
  const [videos, setVideos] = useState<VideoWithSummary[]>(initialVideos);
  const [error, setError] = useState<string | null>(null);
  const [topicFilter, setTopicFilter] = useState<string>('');
  const [fetchMax, setFetchMax] = useState(PAGE_SIZE);
  const [hasMore, setHasMore] = useState(initialVideos.length >= PAGE_SIZE);

  // ----- TAV-9: Batch summarize state -----
  interface BatchState {
    running: boolean;
    completed: number;
    total: number;
    currentTitle: string | null;
    error: string | null;
    cancelled: boolean;
  }
  const [batch, setBatch] = useState<BatchState>({
    running: false, completed: 0, total: 0, currentTitle: null, error: null, cancelled: false,
  });
  const cancelRef = useRef(false);

  // Keep local state in sync if the server re-renders with new data (e.g. after
  // a summarize action calls router.refresh()).
  useEffect(() => {
    setVideos(initialVideos);
  }, [initialVideos]);

  // Distinct set of topics across visible summaries, sorted alphabetically.
  const allTopics = useMemo(() => {
    const set = new Set<string>();
    for (const v of videos) {
      for (const t of v.summary?.topics ?? []) set.add(t);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [videos]);

  const visibleVideos = topicFilter
    ? videos.filter(v => (v.summary?.topics ?? []).includes(topicFilter))
    : videos;

  const refresh = () => {
    setError(null);
    start(async () => {
      try {
        const fresh = await refreshChannelVideosAction(channelId, fetchMax);
        setVideos(fresh);
        setHasMore(fresh.length >= fetchMax);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    });
  };

  const loadMore = () => {
    setError(null);
    const nextMax = fetchMax + PAGE_SIZE;
    startLoadingMore(async () => {
      try {
        const fresh = await refreshChannelVideosAction(channelId, nextMax);
        setFetchMax(nextMax);
        setVideos(fresh);
        setHasMore(fresh.length >= nextMax);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    });
  };

  // ----- TAV-9: Batch summarize -----
  const summarizeAll = () => {
    cancelRef.current = false;
    setBatch({ running: true, completed: 0, total: 0, currentTitle: null, error: null, cancelled: false });
    start(async () => {
      try {
        const pending = await getUnsummarizedVideosAction(channelId);
        if (pending.length === 0) {
          setBatch({ running: false, completed: 0, total: 0, currentTitle: null, error: null, cancelled: false });
          return;
        }
        setBatch(b => ({ ...b, total: pending.length }));
        let completed = 0;
        for (const video of pending) {
          if (cancelRef.current) {
            setBatch(b => ({ ...b, running: false, cancelled: true, currentTitle: null }));
            router.refresh();
            return;
          }
          setBatch(b => ({ ...b, currentTitle: video.title }));
          try {
            // Stage 1: fetch transcript (skips if cached).
            const t = await fetchTranscriptAction(video.video_id);
            if (!t.ok) {
              setBatch(b => ({
                ...b, running: false, currentTitle: null,
                error: `"${video.title}" — ${t.error ?? 'Transcript fetch failed.'}`,
              }));
              router.refresh();
              return;
            }
            // Stage 2: summarize with the now-cached transcript.
            const s = await summarizeVideoAction(video.video_id);
            if (!s.ok) {
              setBatch(b => ({
                ...b, running: false, currentTitle: null,
                error: `"${video.title}" — ${s.error ?? 'Summarization failed.'}`,
              }));
              router.refresh();
              return;
            }
            completed += 1;
            setBatch(b => ({ ...b, completed }));
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            setBatch(b => ({
              ...b, running: false, currentTitle: null,
              error: `"${video.title}" — ${msg}`,
            }));
            router.refresh();
            return;
          }
        }
        setBatch(b => ({ ...b, running: false, currentTitle: null }));
        router.refresh();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setBatch(b => ({ ...b, running: false, currentTitle: null, error: msg }));
      }
    });
  };

  const cancelBatch = () => {
    cancelRef.current = true;
  };

  const unsummarizedCount = useMemo(
    () => videos.filter(v => !v.summary && v.transcript_status !== 'unavailable').length,
    [videos],
  );

  return (
    <section id="videos" style={{ marginTop: 32, scrollMarginTop: 80 }}>
      <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, flexWrap: 'wrap', gap: 8 }}>
        <h2 style={{ fontSize: 16, fontWeight: 600 }}>
          Recent videos
          <span style={{ color: '#5a5a64', fontSize: 13, fontWeight: 400, marginLeft: 8 }}>
            1-click summaries, inline
          </span>
        </h2>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {connected && unsummarizedCount > 0 && !batch.running && (
            <button
              type="button"
              className="btn btn-primary"
              onClick={summarizeAll}
              disabled={pending}
              style={{ fontSize: 12 }}
              title={`Summarize ${unsummarizedCount} un-summarized video${unsummarizedCount === 1 ? '' : 's'}`}
            >
              ⚡ Summarize all new ({unsummarizedCount})
            </button>
          )}
          {batch.running && (
            <button
              type="button"
              className="btn btn-danger"
              onClick={cancelBatch}
              style={{ fontSize: 12 }}
            >
              Cancel batch
            </button>
          )}
          {connected && (
            <button type="button" className="btn" onClick={refresh} disabled={pending} style={{ fontSize: 12 }}>
              {pending ? 'Refreshing…' : '↻ Refresh from YouTube'}
            </button>
          )}
        </div>
      </header>

      {/* TAV-9: Batch progress bar */}
      {batch.total > 0 && (batch.running || batch.completed > 0 || batch.error || batch.cancelled) && (
        <div style={{ marginBottom: 14, padding: '12px 14px', border: '1px solid #2a2a33', borderRadius: 10, background: '#15151a' }}>
          {batch.running && (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#c2c2cb', marginBottom: 6 }}>
                <span>
                  Summarizing… {batch.completed}/{batch.total}
                </span>
                {batch.currentTitle && (
                  <span style={{ color: '#8b8b94', fontStyle: 'italic', maxWidth: 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {batch.currentTitle}
                  </span>
                )}
              </div>
              <div style={{ height: 6, borderRadius: 3, background: '#1f1f26', overflow: 'hidden' }}>
                <div
                  style={{
                    height: '100%',
                    width: `${batch.total > 0 ? (batch.completed / batch.total) * 100 : 0}%`,
                    background: '#5b9eff',
                    borderRadius: 3,
                    transition: 'width .3s ease',
                  }}
                />
              </div>
            </>
          )}
          {!batch.running && batch.completed > 0 && !batch.error && !batch.cancelled && (
            <div style={{ fontSize: 13, color: '#5cd9a3' }}>
              ✓ Batch complete — {batch.completed} summar{batch.completed === 1 ? 'y' : 'ies'} generated.
            </div>
          )}
          {batch.cancelled && (
            <div style={{ fontSize: 13, color: '#8b8b94' }}>
              Batch cancelled at {batch.completed}/{batch.total}.{' '}
              <button
                type="button"
                className="btn btn-ghost"
                onClick={summarizeAll}
                disabled={pending}
                style={{ fontSize: 12, padding: '2px 8px', display: 'inline-flex' }}
              >
                Resume
              </button>
            </div>
          )}
          {batch.error && (
            <div style={{ fontSize: 13, color: '#ff6363' }}>
              ⚠ Batch stopped: {batch.error}{' '}
              <button
                type="button"
                className="btn btn-ghost"
                onClick={summarizeAll}
                disabled={pending}
                style={{ fontSize: 12, padding: '2px 8px', display: 'inline-flex' }}
              >
                Resume
              </button>
            </div>
          )}
        </div>
      )}

      {allTopics.length > 0 && (
        <div style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
          <label htmlFor="topic-filter" style={{ fontSize: 12, color: '#8b8b94' }}>Topic:</label>
          <select
            id="topic-filter"
            value={topicFilter}
            onChange={e => setTopicFilter(e.target.value)}
            style={{
              background: '#15151a',
              color: '#e7e7ea',
              border: '1px solid #2a2a33',
              borderRadius: 8,
              padding: '6px 10px',
              fontSize: 12,
            }}
          >
            <option value="">All topics</option>
            {allTopics.map(t => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
          {topicFilter && (
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => setTopicFilter('')}
              style={{ fontSize: 12, padding: '4px 8px' }}
            >
              Clear
            </button>
          )}
        </div>
      )}

      {error && (
        <div style={{ color: '#ff6363', fontSize: 13, marginBottom: 12 }}>
          {error}{' '}
          <button type="button" className="btn btn-ghost" onClick={refresh} disabled={pending} style={{ fontSize: 12 }}>
            Retry
          </button>
        </div>
      )}

      {videos.length === 0 ? (
        <div style={{ padding: '40px 20px', textAlign: 'center', color: '#8b8b94', border: '1px dashed #2a2a33', borderRadius: 12 }}>
          <div style={{ fontSize: 28, marginBottom: 8 }}>📹</div>
          <div>
            {connected
              ? 'No videos cached yet. Hit "Refresh from YouTube" to load recent uploads.'
              : 'Connect your YouTube account to load this channel\'s recent videos.'}
          </div>
        </div>
      ) : visibleVideos.length === 0 ? (
        <div style={{ padding: '24px 20px', textAlign: 'center', color: '#8b8b94', border: '1px dashed #2a2a33', borderRadius: 12, fontSize: 13 }}>
          No videos match the topic <strong>{topicFilter}</strong>.{' '}
          <button type="button" className="btn btn-ghost" onClick={() => setTopicFilter('')} style={{ fontSize: 12, padding: '2px 8px' }}>
            Clear filter
          </button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {visibleVideos.map(v => (
            <VideoSummaryRow key={v.video_id} video={v} channelId={channelId} />
          ))}
        </div>
      )}
      {hasMore && connected && !topicFilter && (
        <div style={{ textAlign: 'center', marginTop: 16 }}>
          <button
            type="button"
            className="btn"
            onClick={loadMore}
            disabled={loadingMore || pending}
            style={{ fontSize: 13 }}
          >
            {loadingMore ? 'Loading…' : 'Load more'}
          </button>
        </div>
      )}
    </section>
  );
}
