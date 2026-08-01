'use client';

import { useState, useTransition } from 'react';
import type { PlaylistSummary, PlaylistVideoRow } from '@/lib/types';
import { summarizePlaylistAction } from '@/app/actions';
import { formatRelative, youtubeVideoUrl } from '../_lib/format';

/**
 * TAV-26: Playlist summary panel.
 *
 * Renders the cached playlist synthesis (if any) and a "Summarize playlist"
 * button that gathers the per-video summaries already cached locally and
 * synthesizes them into a single overview. If too few videos have cached
 * summaries, the button surfaces that and links the user to summarize
 * individual videos first.
 */
export function PlaylistSummaryPanel({
  playlistId,
  summary,
  videos,
}: {
  playlistId: string;
  summary: PlaylistSummary | null;
  videos: PlaylistVideoRow[];
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PlaylistSummary | null>(summary);

  const summarizedCount = videos.filter(v => v.has_summary).length;

  const run = () => {
    setError(null);
    start(async () => {
      const r = await summarizePlaylistAction(playlistId);
      if (!r.ok) {
        setError(r.error ?? 'Failed to summarize playlist.');
        return;
      }
      setResult(r.summary ?? null);
    });
  };

  return (
    <section style={{ marginTop: 24 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 8 }}>
        <h2 style={{ fontSize: 16, fontWeight: 600 }}>
          Playlist synthesis
        </h2>
        <button
          type="button"
          className="btn btn-primary"
          onClick={run}
          disabled={pending || summarizedCount < 2}
          style={{ fontSize: 12, padding: '6px 12px' }}
          title={summarizedCount < 2 ? 'Summarize at least 2 videos in this playlist first' : 'Synthesize the whole playlist from cached summaries'}
        >
          {pending ? 'Synthesizing…' : result ? '↻ Re-summarize' : '⚡ Summarize playlist'}
        </button>
      </div>

      {summarizedCount < 2 && !result && (
        <p style={{ color: '#8b8b94', fontSize: 12, marginBottom: 8 }}>
          {summarizedCount} of {videos.length} videos have a cached summary. Summarize at least 2 videos below first, then synthesize the whole playlist.
        </p>
      )}

      {error && (
        <div style={{ color: '#ff6363', fontSize: 13, marginBottom: 12 }}>{error}</div>
      )}

      {result && (
        <div style={{ background: '#15151a', border: '1px solid #2a2a33', borderRadius: 10, padding: 16 }}>
          <p style={{ color: '#c2c2cb', fontSize: 13, lineHeight: 1.6, whiteSpace: 'pre-wrap', margin: 0 }}>
            {result.synthesis}
          </p>

          {result.themes.length > 0 && (
            <div style={{ marginTop: 14, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {result.themes.map(t => (
                <span key={t} className="chip" style={{ fontSize: 11 }}>{t}</span>
              ))}
            </div>
          )}

          {result.start_here.length > 0 && (
            <div style={{ marginTop: 14 }}>
              <div style={{ color: '#8b8b94', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>Start here</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {result.start_here.map(id => {
                  const v = videos.find(x => x.video_id === id);
                  return (
                    <a
                      key={id}
                      href={youtubeVideoUrl(id)}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ color: '#5b9eff', fontSize: 13, textDecoration: 'none' }}
                    >
                      ▶ {v?.title ?? id}
                    </a>
                  );
                })}
              </div>
            </div>
          )}

          <div style={{ color: '#5a5a64', fontSize: 11, marginTop: 12 }}>
            Generated {formatRelative(result.created_at)} · {result.model}
          </div>
        </div>
      )}
    </section>
  );
}
