'use client';

import { useState, useTransition } from 'react';
import Image from 'next/image';
import type { PlaylistVideoRow } from '@/lib/types';
import { fetchPlaylistVideosAction, fetchTranscriptAction, summarizeVideoAction } from '@/app/actions';
import { formatRelative, youtubeVideoUrl } from '../_lib/format';

/**
 * TAV-26: Playlist videos panel.
 *
 * Renders the cached videos for a curated playlist in playlist order. A
 * "Refresh" button re-fetches the playlist items via `playlistItems.list`.
 * Each video has a "Summarize" button that runs the standard fetch-transcript +
 * summarize pipeline (the same one the inbox uses) so summaries land in the
 * same `summaries` table the playlist synthesizer reads from.
 */
export function PlaylistVideosPanel({
  playlistId,
  initialVideos,
  connected,
}: {
  playlistId: string;
  initialVideos: PlaylistVideoRow[];
  connected: boolean;
}) {
  const [videos, setVideos] = useState<PlaylistVideoRow[]>(initialVideos);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const refresh = () => {
    setError(null);
    start(async () => {
      const r = await fetchPlaylistVideosAction(playlistId);
      if (!r.ok) {
        setError(r.error ?? 'Failed to fetch playlist videos.');
        return;
      }
      setVideos(r.videos);
    });
  };

  if (!connected) return null;

  return (
    <section style={{ marginTop: 24 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 8 }}>
        <h2 style={{ fontSize: 16, fontWeight: 600 }}>
          Videos in this playlist
          <span style={{ color: '#5a5a64', fontSize: 13, fontWeight: 400, marginLeft: 8 }}>
            {videos.length} {videos.length === 1 ? 'video' : 'videos'}
          </span>
        </h2>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={refresh}
          disabled={pending}
          style={{ fontSize: 12, padding: '6px 12px' }}
        >
          {pending ? 'Fetching…' : videos.length === 0 ? 'Fetch videos' : '↻ Refresh'}
        </button>
      </div>

      {error && (
        <div style={{ color: '#ff6363', fontSize: 13, marginBottom: 12 }}>{error}</div>
      )}

      {pending && videos.length === 0 && (
        <div style={{ color: '#8b8b94', fontSize: 13 }}>Fetching playlist videos from YouTube…</div>
      )}

      {!pending && videos.length === 0 && !error && (
        <div style={{ color: '#5a5a64', fontSize: 13 }}>
          No videos cached yet. Click &ldquo;Fetch videos&rdquo; to pull this playlist&rsquo;s items.
        </div>
      )}

      {videos.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {videos.map(v => (
            <PlaylistVideoCard key={v.video_id} video={v} onSummarized={() => {
              // Optimistically flip the has_summary flag so the UI updates
              // without a full refetch.
              setVideos(prev => prev.map(x => x.video_id === v.video_id ? { ...x, has_summary: true } : x));
            }} />
          ))}
        </div>
      )}
    </section>
  );
}

function PlaylistVideoCard({ video, onSummarized }: { video: PlaylistVideoRow; onSummarized: () => void }) {
  const [pending, start] = useTransition();
  const [stage, setStage] = useState<'idle' | 'summarizing' | 'done' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);

  const summarize = () => {
    setError(null);
    setStage('summarizing');
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
        onSummarized();
      } else {
        setError(s.error ?? 'Summarization failed.');
        setStage('error');
      }
    });
  };

  return (
    <div
      style={{
        background: '#15151a',
        border: '1px solid #2a2a33',
        borderRadius: 10,
        padding: 12,
        display: 'grid',
        gridTemplateColumns: '120px 1fr',
        gap: 12,
        alignItems: 'flex-start',
      }}
    >
      {video.thumbnail_url ? (
        <Image
          src={video.thumbnail_url}
          alt={video.title}
          width={120}
          height={68}
          unoptimized
          style={{ borderRadius: 6, objectFit: 'cover', background: '#1f1f26' }}
        />
      ) : (
        <div style={{ width: 120, height: 68, borderRadius: 6, background: '#1f1f26' }} />
      )}
      <div style={{ minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ color: '#5a5a64', fontSize: 11 }}>#{video.position + 1}</span>
          <a
            href={youtubeVideoUrl(video.video_id)}
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: '#e7e7ea', textDecoration: 'none', fontWeight: 600, fontSize: 14 }}
          >
            {video.title}
          </a>
        </div>
        <div style={{ color: '#8b8b94', fontSize: 12, marginTop: 4, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          {video.published_at && <span>{formatRelative(video.published_at)}</span>}
          {video.has_summary && <span style={{ color: '#5cd9a3' }}>✓ summarized</span>}
        </div>

        {stage === 'done' && (
          <div style={{ marginTop: 8, fontSize: 12, color: '#5cd9a3' }}>
            ✓ Summarized
          </div>
        )}
        {stage === 'error' && (
          <div style={{ marginTop: 8, fontSize: 12, color: '#ff6363' }}>
            ⚠ {error}{' '}
            <button type="button" className="btn btn-ghost" onClick={summarize} disabled={pending} style={{ fontSize: 11, padding: '2px 8px' }}>
              Retry
            </button>
          </div>
        )}
        {stage !== 'done' && (
          <button
            type="button"
            className="btn btn-primary"
            onClick={summarize}
            disabled={pending}
            style={{ fontSize: 12, padding: '6px 12px', marginTop: 10 }}
          >
            {stage === 'summarizing' ? 'Summarizing…' : '⚡ Summarize'}
          </button>
        )}
      </div>
    </div>
  );
}
