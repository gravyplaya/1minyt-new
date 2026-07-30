'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { VideoWithSummary } from '@/lib/types';
import { refreshChannelVideosAction } from '@/app/actions';
import { VideoSummaryRow } from './VideoSummaryRow';

/**
 * The "Videos" section of the channel page. Loads cached video rows on first
 * render (passed from the server), then offers a "Refresh from YouTube" button
 * that pulls the latest uploads and updates the list in place.
 *
 * Each row is a `VideoSummaryRow` — the 1-click summarize interaction lives
 * there. This panel only handles the list-level refresh.
 */
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
  const [videos, setVideos] = useState<VideoWithSummary[]>(initialVideos);
  const [error, setError] = useState<string | null>(null);

  // Keep local state in sync if the server re-renders with new data (e.g. after
  // a summarize action calls router.refresh()).
  useEffect(() => {
    setVideos(initialVideos);
  }, [initialVideos]);

  const refresh = () => {
    setError(null);
    start(async () => {
      try {
        const fresh = await refreshChannelVideosAction(channelId);
        setVideos(fresh);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    });
  };

  return (
    <section id="videos" style={{ marginTop: 32, scrollMarginTop: 80 }}>
      <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <h2 style={{ fontSize: 16, fontWeight: 600 }}>
          Recent videos
          <span style={{ color: '#5a5a64', fontSize: 13, fontWeight: 400, marginLeft: 8 }}>
            1-click summaries, inline
          </span>
        </h2>
        {connected && (
          <button type="button" className="btn" onClick={refresh} disabled={pending} style={{ fontSize: 12 }}>
            {pending ? 'Refreshing…' : '↻ Refresh from YouTube'}
          </button>
        )}
      </header>

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
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {videos.map(v => (
            <VideoSummaryRow key={v.video_id} video={v} channelId={channelId} />
          ))}
        </div>
      )}
    </section>
  );
}
