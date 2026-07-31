'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { Chapter, VideoWithSummary } from '@/lib/types';
import { fetchTranscriptAction, summarizeVideoAction, toggleBookmarkAction } from '@/app/actions';
import { formatMmSs } from '@/lib/chapters';
import { formatRelative, youtubeVideoUrl, youtubeVideoUrlAt } from '../_lib/format';
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
  // TAV-13: local copy of chapters so freshly-detected chapters show before router.refresh.
  const [chapters, setChapters] = useState<Chapter[] | null>(video.chapters);
  const [stage, setStage] = useState<Stage>('idle');
  const [transcriptText, setTranscriptText] = useState<string | null>(null);
  const [transcriptSource, setTranscriptSource] = useState<string | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  // TAV-12: bookmark state. Local copy for optimistic updates; the server is
  // the source of truth and router.refresh() reconciles after the toggle.
  const [bookmarked, setBookmarked] = useState<boolean>(summary?.bookmarked === 1);
  const [bookmarkPending, startBookmark] = useTransition();

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
        // Update local summary immediately so the UI shows it without a page refresh.
        if (sOutcome.summary) setSummary(sOutcome.summary);
        // TAV-13: update chapters immediately if detection produced them.
        if (sOutcome.chapters) setChapters(sOutcome.chapters);
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

  const toggleBookmark = () => {
    if (!summary) return; // nothing to bookmark yet
    const next = !bookmarked;
    setBookmarked(next); // optimistic
    startBookmark(async () => {
      const outcome = await toggleBookmarkAction(video.video_id);
      if (outcome.ok && outcome.bookmarked != null) {
        setBookmarked(outcome.bookmarked === 1);
      } else if (!outcome.ok) {
        setBookmarked(!next); // revert on failure
      }
      router.refresh();
    });
  };

  return (
    <div style={{ border: '1px solid #2a2a33', borderRadius: 12, background: '#15151a', overflow: 'hidden' }}>
      <div className="video-row-header" style={{ display: 'grid', gridTemplateColumns: '120px 1fr auto', gap: 12, padding: 12, alignItems: 'center' }}>
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
          <div style={{ color: '#8b8b94', fontSize: 12, marginTop: 4, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            {video.duration_seconds != null && <span>{formatDuration(video.duration_seconds)}</span>}
            {video.published_at && <span>{formatRelative(video.published_at)}</span>}
            {video.transcript_status === 'unavailable' && (
              <span style={{ color: '#ff9b6b' }}>no captions</span>
            )}
            {summary && (
              <span style={{ color: '#5cd9a3' }}>summarized · {formatRelative(summary.created_at)}</span>
            )}
            {summary && summary.topics.length > 0 && (
              <span style={{ display: 'inline-flex', gap: 4, flexWrap: 'wrap' }}>
                {summary.topics.map(t => (
                  <span
                    key={t}
                    style={{
                      fontSize: 11,
                      padding: '1px 7px',
                      borderRadius: 999,
                      background: 'rgba(91,158,255,0.12)',
                      color: '#7db5ff',
                      border: '1px solid rgba(91,158,255,0.25)',
                      textTransform: 'lowercase',
                    }}
                  >
                    {t}
                  </span>
                ))}
              </span>
            )}
          </div>
        </div>
        <div className="video-row-actions" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
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
          {hasSummary && !isWorking && (
            <button
              type="button"
              className="btn btn-ghost"
              onClick={toggleBookmark}
              disabled={bookmarkPending}
              title={bookmarked ? 'Remove bookmark' : 'Bookmark this summary'}
              aria-pressed={bookmarked}
              style={{
                fontSize: 16,
                padding: '4px 8px',
                lineHeight: 1,
                color: bookmarked ? '#f5c542' : '#8b8b94',
                background: bookmarked ? 'rgba(245,197,66,0.12)' : undefined,
                border: bookmarked ? '1px solid rgba(245,197,66,0.3)' : undefined,
              }}
            >
              {bookmarked ? '★' : '☆'}
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
            <SummaryBody summary={summary} videoId={video.video_id} chapters={chapters} />
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
  videoId,
  chapters,
}: {
  summary: NonNullable<VideoWithSummary['summary']>;
  videoId: string;
  chapters: Chapter[] | null;
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
              <div key={f.video_id} className="follow-up-row" style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                <a
                  href={youtubeVideoUrl(f.video_id)}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: '#5b9eff', fontSize: 13, fontWeight: 500, flex: 1, minWidth: 0 }}
                >
                  {f.title}
                </a>
                <span className="follow-up-reason" style={{ color: '#8b8b94', fontSize: 12, fontStyle: 'italic', maxWidth: 360 }}>{f.reason}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* TAV-13: AI-generated chapter list. Rendered between the summary and the
          chat area. Each chapter links to YouTube at the chapter's timestamp. */}
      {chapters && chapters.length > 0 && (
        <ChapterList chapters={chapters} videoId={videoId} />
      )}

      <div style={{ marginTop: 10, color: '#5a5a64', fontSize: 11 }}>
        model: <code>{summary.model}</code>
        {summary.token_count != null && <> · {summary.token_count} tokens</>}
      </div>
    </div>
  );
}

/** TAV-13: Clickable chapter list. Each entry opens YouTube at that timestamp. */
function ChapterList({ chapters, videoId }: { chapters: Chapter[]; videoId: string }) {
  return (
    <div style={{ marginTop: 12, marginBottom: 4 }}>
      <div style={{ textTransform: 'uppercase', letterSpacing: '0.06em', fontSize: 11, color: '#8b8b94', marginBottom: 6 }}>
        Chapters
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {chapters.map((ch, i) => (
          <a
            key={i}
            href={youtubeVideoUrlAt(videoId, Math.floor(ch.startMs / 1000))}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: 'flex',
              gap: 10,
              alignItems: 'baseline',
              padding: '5px 8px',
              borderRadius: 6,
              textDecoration: 'none',
              color: '#c2c2cb',
              fontSize: 13,
              lineHeight: 1.4,
              background: 'transparent',
              border: '1px solid transparent',
              transition: 'background .12s ease, border-color .12s ease',
            }}
            onMouseEnter={e => {
              (e.currentTarget as HTMLAnchorElement).style.background = 'rgba(91,158,255,0.08)';
              (e.currentTarget as HTMLAnchorElement).style.borderColor = 'rgba(91,158,255,0.2)';
            }}
            onMouseLeave={e => {
              (e.currentTarget as HTMLAnchorElement).style.background = 'transparent';
              (e.currentTarget as HTMLAnchorElement).style.borderColor = 'transparent';
            }}
          >
            <span style={{ color: '#7db5ff', fontSize: 12, fontFamily: 'monospace', minWidth: 52, flexShrink: 0 }}>
              {formatMmSs(ch.startMs)}
            </span>
            <span style={{ minWidth: 0 }}>{ch.title}</span>
          </a>
        ))}
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
        className="video-row-thumb"
        style={{ width: 120, height: 68, objectFit: 'cover', borderRadius: 8, background: '#1f1f26' }}
      />
    );
  }
  return (
    <div className="video-row-thumb" style={{ width: 120, height: 68, borderRadius: 8, background: '#1f1f26', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#5a5a64', fontSize: 12 }}>
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
