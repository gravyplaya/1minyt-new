'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import type { SummarizeQueueItem } from '@/lib/types';
import {
  batchSummarizeQueueAction,
  removeFromQueueAction,
  addToQueueAction,
} from '@/app/actions';
import { formatRelative, youtubeVideoUrl } from '../_lib/format';

type BatchStage = 'idle' | 'running' | 'done' | 'error';

/**
 * The Summarize Later queue view. Shows all queued and summarized items,
 * with a "Summarize all" batch action that processes every queued video.
 *
 * Batch behavior:
 *  - The action runs entirely on the server (sequential fetch+summarize per
 *    video). The client shows a progress indicator while it runs, then a
 *    completion banner with per-video error details if any failed.
 *  - Successfully summarized items are marked 'summarized' (kept with a
 *    badge), not removed — the user reviews what was processed and can
 *    clear them manually.
 */
export function SummarizeLaterQueue({ items }: { items: SummarizeQueueItem[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [batchStage, setBatchStage] = useState<BatchStage>('idle');
  const [batchResult, setBatchResult] = useState<{
    completed: number;
    total: number;
    errors: { videoId: string; title: string; error: string }[];
  } | null>(null);

  const queued = items.filter(i => i.state === 'queued');
  const summarized = items.filter(i => i.state === 'summarized');

  const runBatch = () => {
    setBatchStage('running');
    setBatchResult(null);
    start(async () => {
      const outcome = await batchSummarizeQueueAction();
      if (outcome.ok) {
        setBatchResult({
          completed: outcome.completed,
          total: outcome.total,
          errors: outcome.errors,
        });
        setBatchStage(outcome.errors.length > 0 ? 'error' : 'done');
      } else {
        setBatchStage('error');
        setBatchResult({
          completed: outcome.completed,
          total: outcome.total,
          errors: outcome.errors,
        });
      }
      router.refresh();
    });
  };

  const removeItem = (videoId: string) => {
    start(async () => {
      await removeFromQueueAction(videoId);
      router.refresh();
    });
  };

  const requeueItem = (videoId: string) => {
    start(async () => {
      await addToQueueAction(videoId);
      router.refresh();
    });
  };

  if (items.length === 0) {
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
        <div style={{ fontSize: 32, marginBottom: 8 }}>🔖</div>
        <div>
          Your Summarize Later queue is empty. Tap <strong>🔖 Summarize Later</strong> on any
          video to queue it here for batch processing.
        </div>
      </div>
    );
  }

  return (
    <div>
      {/* Batch action bar */}
      {queued.length > 0 && (
        <div
          style={{
            marginBottom: 20,
            padding: '14px 16px',
            border: '1px solid #2a2a33',
            borderRadius: 12,
            background: '#15151a',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 600, color: '#e7e7ea' }}>
                {queued.length} video{queued.length === 1 ? '' : 's'} queued
              </div>
              <div style={{ fontSize: 12, color: '#8b8b94', marginTop: 2 }}>
                Run the batch to generate TL;DRs for all queued videos at once.
              </div>
            </div>
            <button
              type="button"
              className="btn btn-primary"
              onClick={runBatch}
              disabled={pending || batchStage === 'running'}
              style={{ fontSize: 13 }}
            >
              {batchStage === 'running' ? 'Summarizing all…' : '⚡ Summarize all'}
            </button>
          </div>

          {/* Progress indicator */}
          {batchStage === 'running' && (
            <div style={{ marginTop: 12 }}>
              <div style={{ fontSize: 12, color: '#8b8b94', marginBottom: 6 }}>
                Processing queue — this may take a while depending on how many videos are queued…
              </div>
              <div style={{ height: 6, borderRadius: 3, background: '#1f1f26', overflow: 'hidden' }}>
                <div
                  style={{
                    height: '100%',
                    width: '30%',
                    background: 'linear-gradient(90deg, #5b9eff, #7c5cff)',
                    borderRadius: 3,
                    animation: 'pulse 1.5s ease-in-out infinite',
                  }}
                />
              </div>
            </div>
          )}

          {/* Completion banner */}
          {batchStage === 'done' && batchResult && (
            <div style={{ marginTop: 12, fontSize: 13, color: '#5cd9a3' }}>
              ✓ Batch complete — {batchResult.completed} of {batchResult.total} summar
              {batchResult.completed === 1 ? 'y' : 'ies'} generated.
            </div>
          )}

          {/* Error banner */}
          {batchStage === 'error' && batchResult && (
            <div style={{ marginTop: 12 }}>
              <div style={{ fontSize: 13, color: '#ff9b6b' }}>
                ⚠ Batch finished with {batchResult.errors.length} error
                {batchResult.errors.length === 1 ? '' : 's'} —{' '}
                {batchResult.completed} of {batchResult.total} succeeded.
              </div>
              {batchResult.errors.length > 0 && (
                <ul style={{ margin: '8px 0 0', paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {batchResult.errors.map((e, i) => (
                    <li key={i} style={{ color: '#ff9b9b', fontSize: 12 }}>
                      <strong>{e.title}</strong> — {e.error}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}

      {/* Queued items */}
      {queued.length > 0 && (
        <section style={{ marginBottom: 32 }}>
          <h2 style={{ fontSize: 15, fontWeight: 600, marginBottom: 12 }}>
            Queued <span style={{ color: '#5a5a64', fontWeight: 400, fontSize: 13 }}>({queued.length})</span>
          </h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {queued.map(item => (
              <QueueRow
                key={item.id}
                item={item}
                onRemove={removeItem}
                pending={pending}
              />
            ))}
          </div>
        </section>
      )}

      {/* Summarized items */}
      {summarized.length > 0 && (
        <section>
          <h2 style={{ fontSize: 15, fontWeight: 600, marginBottom: 12 }}>
            Summarized <span style={{ color: '#5a5a64', fontWeight: 400, fontSize: 13 }}>({summarized.length})</span>
          </h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {summarized.map(item => (
              <QueueRow
                key={item.id}
                item={item}
                onRemove={removeItem}
                onRequeue={requeueItem}
                pending={pending}
              />
            ))}
          </div>
        </section>
      )}

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
      `}</style>
    </div>
  );
}

function QueueRow({
  item,
  onRemove,
  onRequeue,
  pending,
}: {
  item: SummarizeQueueItem;
  onRemove: (videoId: string) => void;
  onRequeue?: (videoId: string) => void;
  pending: boolean;
}) {
  const isSummarized = item.state === 'summarized';
  return (
    <div
      style={{
        border: '1px solid #2a2a33',
        borderRadius: 12,
        background: '#15151a',
        overflow: 'hidden',
      }}
    >
      <div
        className="video-row-header"
        style={{ display: 'grid', gridTemplateColumns: '120px 1fr auto', gap: 12, padding: 12, alignItems: 'center' }}
      >
        {item.thumbnail_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={item.thumbnail_url}
            alt={item.title}
            style={{ width: 120, height: 68, objectFit: 'cover', borderRadius: 8, background: '#1f1f26' }}
          />
        ) : (
          <div style={{ width: 120, height: 68, borderRadius: 8, background: '#1f1f26', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#5a5a64', fontSize: 12 }}>
            no thumb
          </div>
        )}
        <div style={{ minWidth: 0 }}>
          <a
            href={youtubeVideoUrl(item.video_id)}
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: '#e7e7ea', textDecoration: 'none', fontWeight: 600, fontSize: 14 }}
          >
            {item.title}
          </a>
          <div style={{ color: '#8b8b94', fontSize: 12, marginTop: 4, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <Link href={`/c/${item.channel_id}`} style={{ color: '#7db5ff', textDecoration: 'none' }}>
              {item.channel_title}
            </Link>
            {item.duration_seconds != null && <span>{formatDuration(item.duration_seconds)}</span>}
            {item.published_at && <span>published {formatRelative(item.published_at)}</span>}
            {item.transcript_status === 'unavailable' && (
              <span style={{ color: '#ff9b6b' }}>no captions</span>
            )}
            {isSummarized ? (
              <span style={{ color: '#5cd9a3' }}>✓ summarized {item.summarized_at ? formatRelative(item.summarized_at) : ''}</span>
            ) : (
              <span style={{ color: '#7db5ff' }}>queued {formatRelative(item.queued_at)}</span>
            )}
          </div>
        </div>
        <div className="video-row-actions" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <Link
            href={`/c/${item.channel_id}#videos`}
            style={{
              fontSize: 12,
              padding: '6px 10px',
              color: '#c2c2cb',
              textDecoration: 'none',
              border: '1px solid #2a2a33',
              borderRadius: 8,
            }}
          >
            Open
          </Link>
          {isSummarized && onRequeue && (
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => onRequeue(item.video_id)}
              disabled={pending}
              title="Re-queue for summarization"
              style={{ fontSize: 12, padding: '6px 10px' }}
            >
              ↻ Re-queue
            </button>
          )}
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => onRemove(item.video_id)}
            disabled={pending}
            title="Remove from queue"
            style={{ fontSize: 14, padding: '6px 10px', color: '#8b8b94' }}
          >
            ✕
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
