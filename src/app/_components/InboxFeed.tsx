'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import type { InboxVideo } from '@/lib/types';
import { dismissVideoAction, saveVideoAction, untriageVideoAction, inboxSummarizeAction, addToQueueAction } from '@/app/actions';
import { formatCount, formatRelative, youtubeVideoUrl } from '../_lib/format';

type Stage = 'idle' | 'working' | 'done' | 'error';

/**
 * Inbox feed list. Each row shows thumbnail, title, channel, engagement stats,
 * a relevance bar, and three actions: dismiss (✕), save (★), summarize (⚡).
 *
 * The component is optimistic for dismiss/save — the row animates out while the
 * server action runs. Summarize runs the 2-stage fetch+summarize pipeline and
 * shows inline progress; the summary itself lives on the channel page, so we
 * link there once it's ready.
 */
export function InboxFeed({ videos, scope }: { videos: InboxVideo[]; scope: 'new' | 'saved' }) {
  if (videos.length === 0) {
    return (
      <div
        style={{
          marginTop: 48,
          padding: 32,
          textAlign: 'center',
          color: '#8b8b94',
          fontSize: 14,
          border: '1px dashed #2a2a33',
          borderRadius: 12,
          background: '#15151a',
        }}
      >
        <div style={{ fontSize: 32, marginBottom: 8 }}>{scope === 'new' ? '📭' : '☆'}</div>
        <div>
          {scope === 'new'
            ? 'Inbox zero — no untriaged videos. Run a sync or digest to pull new uploads.'
            : 'No saved videos yet. Tap ★ on any inbox video to bookmark it here.'}
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {videos.map(v => (
        <InboxRow key={v.video_id} video={v} scope={scope} />
      ))}
    </div>
  );
}

function InboxRow({ video, scope }: { video: InboxVideo; scope: 'new' | 'saved' }) {
  const router = useRouter();
  const [dismissPending, startDismiss] = useTransition();
  const [savePending, startSave] = useTransition();
  const [queuePending, startQueue] = useTransition();
  const [summaryStage, setSummaryStage] = useState<Stage>('idle');
  const [summaryError, setSummaryError] = useState<string | null>(null);
  // TAV-23: track whether this video was added to the Summarize Later queue.
  const [queued, setQueued] = useState(false);
  // Track whether this row has been optimistically removed (dismissed/saved
  // in the 'new' scope). Once removed we stop rendering it.
  const [removed, setRemoved] = useState(false);
  // Triage error (dismiss / save / unsave). Shown inline so a failed action
  // doesn't silently leave the video looking triaged when it wasn't.
  const [triageError, setTriageError] = useState<string | null>(null);

  if (removed) return null;

  const dismiss = () => {
    setTriageError(null);
    setRemoved(true);
    startDismiss(async () => {
      const res = await dismissVideoAction(video.video_id);
      if (!res.ok) {
        setRemoved(false);
        setTriageError(res.error ?? 'Failed to dismiss.');
        return;
      }
      router.refresh();
    });
  };

  const save = () => {
    setTriageError(null);
    if (scope === 'saved') {
      // In the saved scope, ★ is an unsave (return to new).
      setRemoved(true);
      startSave(async () => {
        const res = await untriageVideoAction(video.video_id);
        if (!res.ok) {
          setRemoved(false);
          setTriageError(res.error ?? 'Failed to remove from saved.');
          return;
        }
        router.refresh();
      });
      return;
    }
    setRemoved(true);
    startSave(async () => {
      const res = await saveVideoAction(video.video_id);
      if (!res.ok) {
        setRemoved(false);
        setTriageError(res.error ?? 'Failed to save.');
        return;
      }
      router.refresh();
    });
  };

  const addToQueue = () => {
    setQueued(true); // optimistic
    startQueue(async () => {
      await addToQueueAction(video.video_id);
      router.refresh();
    });
  };

  const summarize = () => {
    setSummaryError(null);
    setSummaryStage('working');
    startDismiss(async () => {
      const outcome = await inboxSummarizeAction(video.video_id);
      if (outcome.ok) {
        setSummaryStage('done');
        router.refresh();
      } else {
        setSummaryError(outcome.error ?? 'Failed to summarize.');
        setSummaryStage('error');
      }
    });
  };

  return (
    <div
      className="inbox-row"
      style={{
        border: '1px solid #2a2a33',
        borderRadius: 12,
        background: '#15151a',
        overflow: 'hidden',
        transition: 'opacity .2s ease, transform .2s ease',
      }}
    >
      <div className="video-row-header" style={{ display: 'grid', gridTemplateColumns: '120px 1fr auto', gap: 12, padding: 12, alignItems: 'center' }}>
        {video.thumbnail_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={video.thumbnail_url}
            alt={video.title}
            style={{ width: 120, height: 68, objectFit: 'cover', borderRadius: 8, background: '#1f1f26' }}
          />
        ) : (
          <div style={{ width: 120, height: 68, borderRadius: 8, background: '#1f1f26', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#5a5a64', fontSize: 12 }}>
            no thumb
          </div>
        )}
        <div style={{ minWidth: 0 }}>
          <a
            href={youtubeVideoUrl(video.video_id)}
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: '#e7e7ea', textDecoration: 'none', fontWeight: 600, fontSize: 14 }}
          >
            {video.title}
          </a>
          <div style={{ color: '#8b8b94', fontSize: 12, marginTop: 4, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <Link href={`/c/${video.channel_id}`} style={{ color: '#7db5ff', textDecoration: 'none' }}>
              {video.channel_title}
            </Link>
            {video.duration_seconds != null && <span>{formatDuration(video.duration_seconds)}</span>}
            {video.published_at && <span>{formatRelative(video.published_at)}</span>}
            {video.view_count != null && <span>👁 {formatCount(video.view_count)}</span>}
            {video.like_count != null && video.like_count > 0 && <span>👍 {formatCount(video.like_count)}</span>}
            {video.transcript_status === 'unavailable' && (
              <span style={{ color: '#ff9b6b' }}>no captions</span>
            )}
            {video.has_summary && (
              <span style={{ color: '#5cd9a3' }}>✓ summarized</span>
            )}
          </div>
          {/* Relevance bar */}
          <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ flex: 1, maxWidth: 160, height: 4, borderRadius: 2, background: '#1f1f26', overflow: 'hidden' }}>
              <div
                style={{
                  width: `${Math.round(video.relevance_score * 100)}%`,
                  height: '100%',
                  background: 'linear-gradient(90deg, #5b9eff, #7c5cff)',
                  borderRadius: 2,
                }}
              />
            </div>
            <span style={{ fontSize: 10, color: '#5a5a64', minWidth: 38 }}>
              {Math.round(video.relevance_score * 100)}%
            </span>
          </div>
          {triageError && (
            <div style={{ color: '#ff6363', fontSize: 12, marginTop: 6 }}>
              {triageError}
            </div>
          )}
          {summaryError && (
            <div style={{ color: '#ff6363', fontSize: 12, marginTop: 6 }}>
              {summaryError}{' '}
              <button type="button" className="btn btn-ghost" onClick={summarize} style={{ fontSize: 11, padding: '1px 6px' }}>
                Retry
              </button>
            </div>
          )}
          {summaryStage === 'done' && (
            <div style={{ color: '#5cd9a3', fontSize: 12, marginTop: 4 }}>
              ✓ Summary ready —{' '}
              <Link href={`/c/${video.channel_id}#videos`} style={{ color: '#7db5ff' }}>
                view it on the channel page
              </Link>
            </div>
          )}
        </div>
        <div className="video-row-actions" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {/* Dismiss (mark seen) */}
          <button
            type="button"
            className="btn btn-ghost"
            onClick={dismiss}
            disabled={dismissPending || savePending || queuePending || summaryStage === 'working'}
            title="Dismiss (mark seen)"
            style={{ fontSize: 14, padding: '6px 10px', color: '#8b8b94' }}
          >
            ✕
          </button>
          {/* Save / unsave */}
          <button
            type="button"
            className="btn btn-ghost"
            onClick={save}
            disabled={dismissPending || savePending || queuePending || summaryStage === 'working'}
            title={scope === 'saved' ? 'Remove from saved' : 'Save for later'}
            aria-pressed={scope === 'saved'}
            style={{
              fontSize: 16,
              padding: '4px 8px',
              lineHeight: 1,
              color: scope === 'saved' ? '#f5c542' : '#8b8b94',
              background: scope === 'saved' ? 'rgba(245,197,66,0.12)' : undefined,
              border: scope === 'saved' ? '1px solid rgba(245,197,66,0.3)' : undefined,
            }}
          >
            {scope === 'saved' ? '★' : '☆'}
          </button>
          {/* Summarize Later — TAV-23 */}
          <button
            type="button"
            className="btn btn-ghost"
            onClick={addToQueue}
            disabled={dismissPending || savePending || queuePending || summaryStage === 'working' || queued}
            title={queued ? 'Added to Summarize Later queue' : 'Add to Summarize Later queue'}
            aria-pressed={queued}
            style={{
              fontSize: 14,
              padding: '6px 10px',
              color: queued ? '#7c5cff' : '#8b8b94',
              background: queued ? 'rgba(124,92,255,0.12)' : undefined,
              border: queued ? '1px solid rgba(124,92,255,0.3)' : undefined,
            }}
          >
            {queued ? '✓' : '🔖'}
          </button>
          {/* Summarize */}
          <button
            type="button"
            className="btn btn-primary"
            onClick={summarize}
            disabled={dismissPending || savePending || queuePending || summaryStage === 'working' || video.transcript_status === 'unavailable'}
            title={video.transcript_status === 'unavailable' ? 'No captions available' : 'Generate a 1-click summary'}
            style={{ fontSize: 12, padding: '6px 12px' }}
          >
            {summaryStage === 'working' ? 'Summarizing…' : video.has_summary ? 'Re-summarize' : '⚡ Summarize'}
          </button>
        </div>
      </div>
    </div>
  );
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}
