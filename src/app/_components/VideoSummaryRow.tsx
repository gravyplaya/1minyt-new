'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { VideoWithSummary } from '@/lib/types';
import { fetchTranscriptAction, summarizeVideoAction } from '@/app/actions';
import { formatRelative, youtubeVideoUrl } from '../_lib/format';
import { VideoChatPanel } from './VideoChatPanel';

type Stage = 'idle' | 'transcribing' | 'summarizing' | 'done' | 'error';

/**
 * A single video row with a 1-click "Summarize" button and inline summary
 * reveal. No navigation, no extra page — the summary expands in place.
 *
 * Two-stage flow:
 *  1. Click "Summarize" → fetch transcript (YouTube timedtext / yt-dlp).
 *     The transcript text appears immediately so the user sees progress.
 *  2. Then summarize with the LLM → summary body replaces the transcript view.
 *
 * State machine:
 *  - idle (has summary): show the summary inline + a "Re-summarize" affordance.
 *  - idle (no summary): show just the button.
 *  - transcribing: fetching transcript from YouTube; show progress text.
 *  - summarizing: transcript fetched and visible; LLM is generating summary.
 *  - error: show the error inline with a retry button.
 */
export function VideoSummaryRow({ video, channelId }: { video: VideoWithSummary; channelId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [expanded, setExpanded] = useState(Boolean(video.summary));
  const [error, setError] = useState<string | null>(null);
  // Local copy so we can show the freshly-saved summary before router.refresh.
  const [summary, setSummary] = useState(video.summary);
  const [stage, setStage] = useState<Stage>('idle');
  const [transcriptText, setTranscriptText] = useState<string | null>(null);
  const [transcriptSource, setTranscriptSource] = useState<string | null>(null);
  const [chatOpen, setChatOpen] = useState(false);

  const summarize = () => {
    setError(null);
    setExpanded(true);
    setStage('transcribing');
    if (!transcriptText) setTranscriptText(null);

    start(async () => {
      // Stage 1: fetch (or return cached) transcript.
      const tOutcome = await fetchTranscriptAction(video.video_id);
      if (!tOutcome.ok) {
        setError(tOutcome.error ?? 'Failed to fetch transcript.');
        setStage('error');
        return;
      }
      setTranscriptText(tOutcome.transcript ?? null);
      setTranscriptSource(tOutcome.source ?? null);
      setStage('summarizing');

      // Stage 2: summarize using the now-cached transcript.
      const sOutcome = await summarizeVideoAction(video.video_id);
      if (sOutcome.ok) {
        setStage('done');
        // Refresh server data so the row reflects the persisted summary.
        router.refresh();
      } else {
        setError(sOutcome.error ?? 'Failed to summarize.');
        setStage('error');
      }
    });
  };

  const hasSummary = Boolean(summary);
  const showSummary = hasSummary && expanded;
  const isWorking = stage === 'transcribing' || stage === 'summarizing';

  return (
    <div style={{ border: '1px solid #2a2a33', borderRadius: 12, background: '#15151a', overflow: 'hidden' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr auto', gap: 12, padding: 12, alignItems: 'center' }}>
        <Thumb video={video} />
        <div style={{ minWidth: 0 }}>
          <a
            href={youtubeVideoUrl(video.video_id)}
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: '#e7e7ea', textDecoration: 'none', fontWeight: 600, fontSize: 14 }}
          >
            {video.title}
          </a>
          <div style={{ color: '#8b8b94', fontSize: 12, marginTop: 4, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {video.duration_seconds != null && <span>{formatDuration(video.duration_seconds)}</span>}
            {video.published_at && <span>{formatRelative(video.published_at)}</span>}
            {video.transcript_status === 'unavailable' && (
              <span style={{ color: '#ff9b6b' }}>no captions</span>
            )}
            {summary && (
              <span style={{ color: '#5cd9a3' }}>summarized · {formatRelative(summary.created_at)}</span>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {hasSummary && !isWorking && (
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => setExpanded(e => !e)}
              style={{ fontSize: 12, padding: '6px 10px' }}
            >
              {expanded ? 'Hide' : 'View'}
            </button>
          )}
          {(hasSummary || video.transcript_status === 'fetched') && !isWorking && (
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => setChatOpen(o => !o)}
              disabled={video.transcript_status === 'unavailable'}
              title="Chat with this video"
              style={{ fontSize: 12, padding: '6px 10px' }}
            >
              {chatOpen ? 'Close chat' : '💬 Chat'}
            </button>
          )}
          <button
            type="button"
            className="btn btn-primary"
            onClick={summarize}
            disabled={pending || video.transcript_status === 'unavailable'}
            title={video.transcript_status === 'unavailable' ? 'No captions available' : 'Generate a 1-click summary'}
            style={{ fontSize: 12, padding: '6px 12px' }}
          >
            {stage === 'transcribing' ? 'Fetching transcript…' : stage === 'summarizing' ? 'Summarizing…' : hasSummary ? 'Re-summarize' : '⚡ Summarize'}
          </button>
        </div>
      </div>

      {(showSummary || isWorking || error) && (
        <div style={{ borderTop: '1px solid #2a2a33', padding: '14px 16px' }}>
          {error && (
            <div style={{ color: '#ff6363', fontSize: 13, marginBottom: 8 }}>
              {error}{' '}
              <button type="button" className="btn btn-ghost" onClick={summarize} disabled={pending} style={{ fontSize: 12, padding: '2px 8px' }}>
                Retry
              </button>
            </div>
          )}

          {/* Stage 1: transcript visible while fetching/summarizing */}
          {transcriptText && stage !== 'done' && (
            <div style={{ marginBottom: stage === 'summarizing' ? 12 : 0 }}>
              <div style={{ textTransform: 'uppercase', letterSpacing: '0.06em', fontSize: 11, color: '#8b8b94', marginBottom: 4 }}>
                Transcript {transcriptSource && <span style={{ color: '#5a5a64' }}>({transcriptSource})</span>}
              </div>
              <div style={{
                color: '#a0a0a8',
                fontSize: 12,
                lineHeight: 1.5,
                maxHeight: 180,
                overflowY: 'auto',
                whiteSpace: 'pre-wrap',
                background: '#1a1a20',
                padding: '10px 12px',
                borderRadius: 8,
                border: '1px solid #2a2a33',
              }}>
                {transcriptText.length > 2000
                  ? transcriptText.slice(0, 2000) + '…'
                  : transcriptText}
              </div>
            </div>
          )}

          {stage === 'transcribing' && !transcriptText && (
            <div style={{ color: '#8b8b94', fontSize: 13 }}>Fetching transcript from YouTube…</div>
          )}

          {stage === 'summarizing' && (
            <div style={{ color: '#8b8b94', fontSize: 13, marginTop: 8 }}>
              Transcript ready — generating summary with LLM…
            </div>
          )}

          {/* Stage 2: summary body */}
          {showSummary && summary && stage !== 'summarizing' && (
            <SummaryBody summary={summary} channelId={channelId} />
          )}
        </div>
      )}

      {/* TAV-5: Chat with Video panel */}
      {chatOpen && (
        <div style={{ borderTop: '1px solid #2a2a33', padding: '14px 16px' }}>
          <VideoChatPanel videoId={video.video_id} />
        </div>
      )}
    </div>
  );
}

function SummaryBody({
  summary,
  channelId,
}: {
  summary: NonNullable<VideoWithSummary['summary']>;
  channelId: string;
}) {
  return (
    <div>
      <div style={{ marginBottom: 12 }}>
        <div style={{ textTransform: 'uppercase', letterSpacing: '0.06em', fontSize: 11, color: '#8b8b94', marginBottom: 4 }}>TL;DR</div>
        <div style={{ color: '#e7e7ea', fontSize: 14, lineHeight: 1.5 }}>{summary.tldr}</div>
      </div>

      <div style={{ marginBottom: 12 }}>
        <div style={{ textTransform: 'uppercase', letterSpacing: '0.06em', fontSize: 11, color: '#8b8b94', marginBottom: 6 }}>Key points</div>
        <ul style={{ margin: 0, paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 4 }}>
          {summary.key_points.map((p, i) => (
            <li key={i} style={{ color: '#c2c2cb', fontSize: 13, lineHeight: 1.5 }}>{p}</li>
          ))}
        </ul>
      </div>

      {summary.follow_ups.length > 0 && (
        <div>
          <div style={{ textTransform: 'uppercase', letterSpacing: '0.06em', fontSize: 11, color: '#8b8b94', marginBottom: 6 }}>Recommended follow-ups</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {summary.follow_ups.map(f => (
              <div key={f.video_id} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                <a
                  href={youtubeVideoUrl(f.video_id)}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: '#5b9eff', fontSize: 13, fontWeight: 500, flex: 1, minWidth: 0 }}
                >
                  {f.title}
                </a>
                <span style={{ color: '#8b8b94', fontSize: 12, fontStyle: 'italic', maxWidth: 360 }}>{f.reason}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div style={{ marginTop: 10, color: '#5a5a64', fontSize: 11 }}>
        model: <code>{summary.model}</code>
        {summary.token_count != null && <> · {summary.token_count} tokens</>}
      </div>
    </div>
  );
}

function Thumb({ video }: { video: VideoWithSummary }) {
  if (video.thumbnail_url) {
    // Using a plain <img> avoids needing to whitelist every thumbnail host in
    // next.config. These are ytimg.com URLs which are safe to load unoptimized.
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={video.thumbnail_url}
        alt={video.title}
        style={{ width: 120, height: 68, objectFit: 'cover', borderRadius: 8, background: '#1f1f26' }}
      />
    );
  }
  return (
    <div style={{ width: 120, height: 68, borderRadius: 8, background: '#1f1f26', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#5a5a64', fontSize: 12 }}>
      no thumb
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
