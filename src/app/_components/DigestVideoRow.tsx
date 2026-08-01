'use client';

import Link from 'next/link';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { DigestVideoEntry } from '@/lib/types';
import { fetchTranscriptAction, summarizeVideoAction, addToQueueAction } from '@/app/actions';
import { formatRelative, youtubeVideoUrl } from '../_lib/format';

type Stage = 'idle' | 'working' | 'done' | 'error';

/**
 * A single new-video row in the digest view. Shows the video thumbnail, title,
 * channel, and a quick-summarize button that runs the 2-stage fetch+summarize
 * pipeline inline (same flow as the channel page's VideoSummaryRow).
 */
export function DigestVideoRow({ video }: { video: DigestVideoEntry }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [queuePending, startQueue] = useTransition();
  const [stage, setStage] = useState<Stage>('idle');
  const [error, setError] = useState<string | null>(null);
  const [summarized, setSummarized] = useState<boolean>(video.has_summary);
  // TAV-23: Summarize Later queue state.
  const [queued, setQueued] = useState(false);

  const summarize = () => {
    setError(null);
    setStage('working');
    start(async () => {
      // Stage 1: fetch transcript (skips if cached).
      const t = await fetchTranscriptAction(video.video_id);
      if (!t.ok) {
        setError(t.error ?? 'Failed to fetch transcript.');
        setStage('error');
        return;
      }
      // Stage 2: summarize.
      const s = await summarizeVideoAction(video.video_id);
      if (s.ok) {
        setStage('done');
        setSummarized(true);
        router.refresh();
      } else {
        setError(s.error ?? 'Failed to summarize.');
        setStage('error');
      }
    });
  };

  const addToQueue = () => {
    setQueued(true); // optimistic
    startQueue(async () => {
      await addToQueueAction(video.video_id);
      router.refresh();
    });
  };

  return (
    <div style={{ border: '1px solid #2a2a33', borderRadius: 12, background: '#15151a', overflow: 'hidden' }}>
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
            {video.published_at && <span>published {formatRelative(video.published_at)}</span>}
          </div>
          {error && (
            <div style={{ color: '#ff6363', fontSize: 12, marginTop: 6 }}>
              {error}{' '}
              <button type="button" className="btn btn-ghost" onClick={summarize} disabled={pending} style={{ fontSize: 11, padding: '1px 6px' }}>
                Retry
              </button>
            </div>
          )}
          {stage === 'done' && (
            <div style={{ color: '#5cd9a3', fontSize: 12, marginTop: 4 }}>✓ Summary ready — view it on the channel page.</div>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <Link
            href={`/c/${video.channel_id}#videos`}
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
          {/* TAV-23: Summarize Later */}
          <button
            type="button"
            className="btn btn-ghost"
            onClick={addToQueue}
            disabled={pending || queuePending || queued}
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
          <button
            type="button"
            className="btn btn-primary"
            onClick={summarize}
            disabled={pending || queuePending}
            style={{ fontSize: 12, padding: '6px 12px' }}
          >
            {stage === 'working' ? 'Summarizing…' : summarized ? 'Re-summarize' : '⚡ Summarize'}
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
