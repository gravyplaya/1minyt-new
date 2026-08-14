"use client";

import { useState, useTransition, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import type {
  Chapter,
  CommunityPulse,
  MusicFlag,
  TranscriptSegment,
  TranscriptSource,
  VideoWithSummary,
} from "@/lib/types";
import {
  fetchTranscriptAction,
  summarizeVideoAction,
  toggleBookmarkAction,
  toggleVideoLikeAction,
  getSegmentsAction,
  addToQueueAction,
} from "@/app/actions";
import { formatMmSs } from "@/lib/chapters";
import {
  formatRelative,
  youtubeVideoUrl,
} from "../_lib/format";
import { VideoChatPanel } from "./VideoChatPanel";
import { YouTubePlayer, type YouTubePlayerHandle } from "./YouTubePlayer";
import { VideoReferencesSection } from "./VideoReferencesSection";

type Stage = "idle" | "transcribing" | "summarizing" | "done" | "error";

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
export function VideoSummaryRow({
  video,
  channelId,
  musicFlag = 0,
}: {
  video: VideoWithSummary;
  channelId: string;
  musicFlag?: MusicFlag;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [expanded, setExpanded] = useState(Boolean(video.summary));
  const [error, setError] = useState<string | null>(null);
  // Local copy so we can show the freshly-saved summary before router.refresh.
  const [summary, setSummary] = useState(video.summary);
  // TAV-13: local copy of chapters so freshly-detected chapters show before router.refresh.
  const [chapters, setChapters] = useState<Chapter[] | null>(video.chapters);
  // TAV-20: local copy of community pulse so freshly-fetched comments show before router.refresh.
  const [communityPulse, setCommunityPulse] = useState<CommunityPulse | null>(
    video.community_pulse,
  );
  const [stage, setStage] = useState<Stage>("idle");
  const [transcriptText, setTranscriptText] = useState<string | null>(null);
  // TAV-19: transcript origin — 'youtube' (captions) or 'whisper' (speech-to-text). Null until fetched.
  const [transcriptSource, setTranscriptSource] =
    useState<TranscriptSource | null>(video.transcript_source ?? null);
  const [chatOpen, setChatOpen] = useState(false);
  // TAV-21: embedded IFrame player state.
  const [playerOpen, setPlayerOpen] = useState(false);
  const [segments, setSegments] = useState<TranscriptSegment[]>([]);
  const playerHandleRef = useRef<YouTubePlayerHandle | null>(null);
  // TAV-12: bookmark state. Local copy for optimistic updates; the server is
  // the source of truth and router.refresh() reconciles after the toggle.
  const [bookmarked, setBookmarked] = useState<boolean>(
    summary?.bookmarked === 1,
  );
  const [bookmarkPending, startBookmark] = useTransition();
  const [liked, setLiked] = useState<boolean>(video.liked);
  const [likePending, startLike] = useTransition();
  // TAV-41: like state is now hydrated server-side (video.liked) by the list
  // queries, so we no longer fire a per-row getLikeStateAction on mount — that
  // was causing ~1 server-action call per row (≈100 on /likes). Keep a local
  // copy so the heart toggles optimistically; router.refresh() reconciles.
  // TAV-23: Summarize Later queue state.
  const [queued, setQueued] = useState(false);
  const [queuePending, startQueue] = useTransition();

  // TAV-21: fetch transcript segments for the "now playing" highlight when the
  // embedded player opens. Best-effort — empty segments just hides the highlight.
  useEffect(() => {
    if (!playerOpen || segments.length > 0) return;
    let cancelled = false;
    (async () => {
      const segs = await getSegmentsAction(video.video_id);
      if (!cancelled && segs.length > 0) setSegments(segs);
    })();
    return () => {
      cancelled = true;
    };
  }, [playerOpen, video.video_id, segments.length]);

  // Seek handler passed to the chat panel: jumps the embedded player if it's
  // mounted, otherwise opens the player at that timestamp.
  const pendingSeekRef = useRef<number | null>(null);
  // TAV-21: seek the embedded player if it's currently mounted; otherwise
  // open the player and defer the seek until onReady fires. Checking
  // `playerOpen` guards against a stale handle left in playerHandleRef
  // after the user closes the player (the child unmounts and nulls its
  // own playerRef, but the parent's ref isn't cleared).
  const handleSeek = (seconds: number) => {
    if (playerOpen && playerHandleRef.current) {
      playerHandleRef.current.seekTo(seconds);
    } else {
      setPlayerOpen(true);
      // Defer the seek until the player signals readiness via onReady.
      pendingSeekRef.current = seconds;
    }
  };
  const onPlayerReady = (handle: YouTubePlayerHandle) => {
    playerHandleRef.current = handle;
    if (pendingSeekRef.current != null) {
      handle.seekTo(pendingSeekRef.current);
      pendingSeekRef.current = null;
    }
  };

  const summarize = () => {
    setError(null);
    setExpanded(true);
    setStage("transcribing");
    if (!transcriptText) setTranscriptText(null);

    start(async () => {
      // Stage 1: fetch (or return cached) transcript.
      const tOutcome = await fetchTranscriptAction(video.video_id);
      if (!tOutcome.ok) {
        setError(tOutcome.error ?? "Failed to fetch transcript.");
        setStage("error");
        return;
      }
      setTranscriptText(tOutcome.transcript ?? null);
      setTranscriptSource(tOutcome.transcriptSource ?? null);
      setStage("summarizing");

      // Stage 2: summarize using the now-cached transcript.
      const sOutcome = await summarizeVideoAction(video.video_id);
      if (sOutcome.ok) {
        setStage("done");
        // Update local summary immediately so the UI shows it without a page refresh.
        if (sOutcome.summary) setSummary(sOutcome.summary);
        // TAV-13: update chapters immediately if detection produced them.
        if (sOutcome.chapters) setChapters(sOutcome.chapters);
        // TAV-20: update community pulse immediately if comments were fetched.
        if (sOutcome.communityPulse !== undefined)
          setCommunityPulse(sOutcome.communityPulse);
        // Refresh server data so the row reflects the persisted summary.
        router.refresh();
      } else {
        setError(sOutcome.error ?? "Failed to summarize.");
        setStage("error");
      }
    });
  };

  const hasSummary = Boolean(summary);
  const showSummary = hasSummary && expanded;
  const isWorking = stage === "transcribing" || stage === "summarizing";
  // Music channels have no transcripts — hide summarize/chat/queue actions.
  const isMusic = musicFlag === 1;

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

  // TAV-23: add this video to the Summarize Later queue.
  const addToQueue = () => {
    setQueued(true); // optimistic
    startQueue(async () => {
      const outcome = await addToQueueAction(video.video_id);
      if (!outcome.ok) {
        setQueued(false); // revert on failure
      }
      router.refresh();
    });
  };

  return (
    <div
      style={{
        border: "1px solid #2a2a33",
        borderRadius: 12,
        background: "#15151a",
        overflow: "hidden",
      }}
    >
      <div
        className="video-row-header"
        style={{
          display: "grid",
          gridTemplateColumns: "120px 1fr auto",
          gap: 12,
          padding: 12,
          alignItems: "center",
        }}
      >
        <Thumb video={video} />
        <div style={{ minWidth: 0 }}>
          <a
            href={youtubeVideoUrl(video.video_id)}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              color: "#e7e7ea",
              textDecoration: "none",
              fontWeight: 600,
              fontSize: 14,
            }}
          >
            {video.title}
          </a>
          <div
            style={{
              color: "#8b8b94",
              fontSize: 12,
              marginTop: 4,
              display: "flex",
              gap: 10,
              flexWrap: "wrap",
              alignItems: "center",
            }}
          >
            {video.duration_seconds != null && (
              <span>{formatDuration(video.duration_seconds)}</span>
            )}
            {video.published_at && (
              <span>{formatRelative(video.published_at)}</span>
            )}
            {video.transcript_status === "unavailable" && (
              <span style={{ color: "#ff9b6b" }}>no captions</span>
            )}
            {summary && (
              <span style={{ color: "#5cd9a3" }}>
                summarized · {formatRelative(summary.created_at)}
              </span>
            )}
            {summary && summary.topics.length > 0 && (
              <span
                style={{ display: "inline-flex", gap: 4, flexWrap: "wrap" }}
              >
                {summary.topics.map((t) => (
                  <span
                    key={t}
                    style={{
                      fontSize: 11,
                      padding: "1px 7px",
                      borderRadius: 999,
                      background: "rgba(91,158,255,0.12)",
                      color: "#7db5ff",
                      border: "1px solid rgba(91,158,255,0.25)",
                      textTransform: "lowercase",
                    }}
                  >
                    {t}
                  </span>
                ))}
              </span>
            )}
          </div>
        </div>
        <div
          className="video-row-actions"
          style={{ display: "flex", gap: 8, alignItems: "center" }}
        >
          {hasSummary && !isWorking && (
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => setExpanded((e) => !e)}
              style={{ fontSize: 12, padding: "6px 10px" }}
            >
              {expanded ? "Hide" : "View"}
            </button>
          )}
          {!(isMusic) && (hasSummary || video.transcript_status === "fetched") &&
            !isWorking && (
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setChatOpen((o) => !o)}
                disabled={video.transcript_status === "unavailable"}
                title="Chat with this video"
                style={{ fontSize: 12, padding: "6px 10px" }}
              >
                {chatOpen ? "Close chat" : "💬 Chat"}
              </button>
            )}
          {/* TAV-21: toggle the embedded IFrame player. */}
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => setPlayerOpen((o) => !o)}
            title="Watch inline"
            style={{ fontSize: 12, padding: "6px 10px" }}
          >
            {playerOpen ? "Hide player" : "▶ Watch"}
          </button>
          {hasSummary && !isWorking && (
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => startLike(async () => {
                const outcome = await toggleVideoLikeAction(video.video_id);
                if (outcome.ok) {
                  setLiked(outcome.liked);
                } else {
                  // TAV-41: revert optimistic state on failure, mirroring the
                  // bookmark/queue pattern — otherwise a failed insert silently
                  // leaves the heart in the wrong color.
                  setLiked(prev => !prev);
                }
              })}
              disabled={likePending}
              title={liked ? "Unlike this video" : "Like this video"}
              aria-pressed={liked}
              style={{ fontSize: 16, padding: "4px 8px", lineHeight: 1, color: liked ? "#ff6b8a" : "#8b8b94" }}
            >{liked ? "♥" : "♡"}</button>
          )}
          {hasSummary && !isWorking && (
            <button
              type="button"
              className="btn btn-ghost"
              onClick={toggleBookmark}
              disabled={bookmarkPending}
              title={bookmarked ? "Remove bookmark" : "Bookmark this summary"}
              aria-pressed={bookmarked}
              style={{
                fontSize: 16,
                padding: "4px 8px",
                lineHeight: 1,
                color: bookmarked ? "#f5c542" : "#8b8b94",
                background: bookmarked ? "rgba(245,197,66,0.12)" : undefined,
                border: bookmarked ? "1px solid rgba(245,197,66,0.3)" : undefined,
              }}
            >{bookmarked ? "★" : "☆"}</button>
          )}
          {/* TAV-23: Add to Summarize Later queue */}
          {!(isMusic) && (
            <button
              type="button"
              className="btn btn-ghost"
              onClick={addToQueue}
              disabled={queuePending || queued}
              title={
                queued
                  ? "Added to Summarize Later queue"
                  : "Add to Summarize Later queue"
              }
              aria-pressed={queued}
              style={{
                fontSize: 14,
                padding: "4px 8px",
                lineHeight: 1,
                color: queued ? "#7c5cff" : "#8b8b94",
                background: queued ? "rgba(124,92,255,0.12)" : undefined,
                border: queued ? "1px solid rgba(124,92,255,0.3)" : undefined,
              }}
            >
              {queued ? "✓" : "🔖"}
            </button>
          )}
          {!(isMusic) && (
            <button
              type="button"
              className="btn btn-primary"
              onClick={summarize}
              disabled={
                pending ||
                queuePending ||
                video.transcript_status === "unavailable"
              }
              title={
                video.transcript_status === "unavailable"
                  ? "No captions available"
                  : "Generate a 1-click summary"
              }
              style={{ fontSize: 12, padding: "6px 12px" }}
            >
              {stage === "transcribing"
                ? "Fetching transcript…"
                : stage === "summarizing"
                  ? "Summarizing…"
                  : hasSummary
                    ? "Re-summarize"
                    : "⚡ Summarize"}
            </button>
          )}
        </div>
      </div>

      {(showSummary || isWorking || error) && (
        <div style={{ borderTop: "1px solid #2a2a33", padding: "14px 16px" }}>
          {error && (
            <div style={{ color: "#ff6363", fontSize: 13, marginBottom: 8 }}>
              {error}{" "}
              <button
                type="button"
                className="btn btn-ghost"
                onClick={summarize}
                disabled={pending}
                style={{ fontSize: 12, padding: "2px 8px" }}
              >
                Retry
              </button>
            </div>
          )}

          {/* Stage 1: transcript visible while fetching/summarizing */}
          {transcriptText && stage !== "done" && (
            <div style={{ marginBottom: stage === "summarizing" ? 12 : 0 }}>
              <div
                style={{
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                  fontSize: 11,
                  color: "#8b8b94",
                  marginBottom: 4,
                  display: "flex",
                  gap: 8,
                  alignItems: "center",
                }}
              >
                <span>Transcript</span>
                {transcriptSource === "whisper" && (
                  <span
                    style={{
                      padding: "1px 7px",
                      borderRadius: 999,
                      fontSize: 10,
                      background: "rgba(26,95,122,0.18)",
                      color: "#7dd3f0",
                      border: "1px solid rgba(26,95,122,0.35)",
                    }}
                  >
                    ⨀ whisper
                  </span>
                )}
                {transcriptSource === "youtube" && (
                  <span style={{ color: "#5a5a64", fontSize: 10 }}>
                    (captions)
                  </span>
                )}
              </div>
              <div
                style={{
                  color: "#d4d4dc",
                  fontSize: 15,
                  lineHeight: 1.6,
                  maxHeight: 220,
                  overflowY: "auto",
                  whiteSpace: "pre-wrap",
                  background: "#1a1a20",
                  padding: "12px 14px",
                  borderRadius: 8,
                  border: "1px solid #2a2a33",
                }}
              >
                {transcriptText.length > 2000
                  ? transcriptText.slice(0, 2000) + "…"
                  : transcriptText}
              </div>
            </div>
          )}

          {stage === "transcribing" && !transcriptText && (
            <div style={{ color: "#8b8b94", fontSize: 13 }}>
              {video.transcript_status === "unavailable"
                ? "No captions available — trying Whisper speech-to-text…"
                : "Fetching transcript from YouTube…"}
            </div>
          )}

          {stage === "summarizing" && (
            <div style={{ color: "#8b8b94", fontSize: 13, marginTop: 8 }}>
              Transcript ready — generating summary…
            </div>
          )}

          {/* Stage 2: summary body */}
          {showSummary && summary && stage !== "summarizing" && (
            <SummaryBody
              summary={summary}
              videoId={video.video_id}
              chapters={chapters}
              communityPulse={communityPulse}
              onSeek={handleSeek}
            />
          )}
        </div>
      )}

      {/* TAV-21: embedded YouTube IFrame player with transcript-synced seek. */}
      {playerOpen && (
        <div style={{ borderTop: "1px solid #2a2a33", padding: "14px 16px" }}>
          <YouTubePlayer
            videoId={video.video_id}
            segments={segments}
            onReady={onPlayerReady}
          />
        </div>
      )}

      {/* TAV-5: Chat with Video panel */}
      {chatOpen && (
        <div style={{ borderTop: "1px solid #2a2a33", padding: "14px 16px" }}>
          <VideoChatPanel videoId={video.video_id} onSeek={handleSeek} />
        </div>
      )}
    </div>
  );
}

function SummaryBody({
  summary,
  videoId,
  chapters,
  communityPulse,
  onSeek,
}: {
  summary: NonNullable<VideoWithSummary["summary"]>;
  videoId: string;
  chapters: Chapter[] | null;
  communityPulse: CommunityPulse | null;
  onSeek: (seconds: number) => void;
}) {
  return (
    <div>
      <div style={{ marginBottom: 12 }}>
        <div
          style={{
            textTransform: "uppercase",
            letterSpacing: "0.06em",
            fontSize: 11,
            color: "#8b8b94",
            marginBottom: 4,
          }}
        >
          TL;DR
        </div>
        <div style={{ color: "#e7e7ea", fontSize: 14, lineHeight: 1.5 }}>
          {summary.tldr}
        </div>
      </div>

      <div style={{ marginBottom: 12 }}>
        <div
          style={{
            textTransform: "uppercase",
            letterSpacing: "0.06em",
            fontSize: 11,
            color: "#8b8b94",
            marginBottom: 6,
          }}
        >
          Key points
        </div>
        <ul
          style={{
            margin: 0,
            paddingLeft: 20,
            display: "flex",
            flexDirection: "column",
            gap: 4,
          }}
        >
          {summary.key_points.map((p, i) => (
            <li
              key={i}
              style={{ color: "#c2c2cb", fontSize: 13, lineHeight: 1.5 }}
            >
              {p}
            </li>
          ))}
        </ul>
      </div>

      {/* Follow-ups, chapters, and references in a 2-column grid so they
          sit side-by-side instead of each stretching full width. */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          columnGap: 24,
          rowGap: 16,
          marginTop: 12,
        }}
      >
        {summary.follow_ups.length > 0 && (
          <div>
            <div
              style={{
                textTransform: "uppercase",
                letterSpacing: "0.06em",
                fontSize: 11,
                color: "#8b8b94",
                marginBottom: 6,
              }}
            >
              Recommended follow-ups
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {summary.follow_ups.map((f) => (
                <div
                  key={f.video_id}
                  className="follow-up-row"
                  style={{ display: "flex", gap: 10, alignItems: "flex-start" }}
                >
                  <a
                    href={youtubeVideoUrl(f.video_id)}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      color: "#5b9eff",
                      fontSize: 13,
                      fontWeight: 500,
                      flex: 1,
                      minWidth: 0,
                    }}
                  >
                    {f.title}
                  </a>
                  <span
                    className="follow-up-reason"
                    style={{
                      color: "#8b8b94",
                      fontSize: 12,
                      fontStyle: "italic",
                      maxWidth: 200,
                    }}
                  >
                    {f.reason}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* TAV-13: AI-generated chapter list. Each chapter seeks the embedded
            inline player. */}
        {chapters && chapters.length > 0 && (
          <ChapterList chapters={chapters} onSeek={onSeek} />
        )}

        {/* TAV-20: Community Pulse — what the top commenters are saying. */}
        {communityPulse && communityPulse.comments.length > 0 && (
          <CommunityPulseSection pulse={communityPulse} />
        )}

        {/* TAV-29: Cross-video reference graph — References / Referenced by. */}
        <VideoReferencesSection videoId={videoId} />
      </div>
    </div>
  );
}

/** TAV-13: Clickable chapter list. Each entry seeks the embedded inline
 *  player to that timestamp (opens the player if not already mounted). */
function ChapterList({
  chapters,
  onSeek,
}: {
  chapters: Chapter[];
  onSeek: (seconds: number) => void;
}) {
  return (
    <div style={{ marginBottom: 4 }}>
      <div
        style={{
          textTransform: "uppercase",
          letterSpacing: "0.06em",
          fontSize: 11,
          color: "#8b8b94",
          marginBottom: 6,
        }}
      >
        Chapters
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        {chapters.map((ch, i) => (
          <button
            key={i}
            type="button"
            onClick={() => onSeek(Math.floor(ch.startMs / 1000))}
            style={{
              display: "flex",
              gap: 10,
              alignItems: "baseline",
              padding: "5px 8px",
              borderRadius: 6,
              border: "1px solid transparent",
              background: "transparent",
              cursor: "pointer",
              textAlign: "left",
              textDecoration: "none",
              color: "#c2c2cb",
              fontSize: 13,
              lineHeight: 1.4,
              transition: "background .12s ease, border-color .12s ease",
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLButtonElement).style.background =
                "rgba(91,158,255,0.08)";
              (e.currentTarget as HTMLButtonElement).style.borderColor =
                "rgba(91,158,255,0.2)";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.background =
                "transparent";
              (e.currentTarget as HTMLButtonElement).style.borderColor =
                "transparent";
            }}
          >
            <span
              style={{
                color: "#7db5ff",
                fontSize: 12,
                fontFamily: "monospace",
                minWidth: 52,
                flexShrink: 0,
              }}
            >
              {formatMmSs(ch.startMs)}
            </span>
            <span style={{ minWidth: 0 }}>{ch.title}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/** TAV-20: Community Pulse — the LLM comment summary plus the top comments that fed it. */
function CommunityPulseSection({ pulse }: { pulse: CommunityPulse }) {
  const top = pulse.comments.slice(0, 5);
  return (
    <div style={{ marginBottom: 4 }}>
      <div
        style={{
          textTransform: "uppercase",
          letterSpacing: "0.06em",
          fontSize: 11,
          color: "#8b8b94",
          marginBottom: 6,
          display: "flex",
          gap: 8,
          alignItems: "center",
        }}
      >
        <span>Community Pulse</span>
        <span style={{ color: "#5a5a64", fontSize: 10 }}>
          {pulse.comments.length} comment
          {pulse.comments.length === 1 ? "" : "s"} · fetched{" "}
          {formatRelative(pulse.fetched_at)}
        </span>
      </div>
      {pulse.summary && (
        <div
          style={{
            color: "#c2c2cb",
            fontSize: 13,
            lineHeight: 1.5,
            marginBottom: 8,
          }}
        >
          {pulse.summary}
        </div>
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {top.map((c, i) => (
          <div
            key={c.comment_id || i}
            style={{
              fontSize: 12,
              lineHeight: 1.5,
              padding: "6px 10px",
              borderRadius: 6,
              background: "#1a1a20",
              border: "1px solid #2a2a33",
            }}
          >
            <div
              style={{
                display: "flex",
                gap: 8,
                alignItems: "baseline",
                marginBottom: 2,
              }}
            >
              <span style={{ color: "#7db5ff", fontWeight: 500 }}>
                {c.author}
              </span>
              <span style={{ color: "#5a5a64", fontSize: 11 }}>
                {c.like_count > 0 ? `👍 ${c.like_count}` : ""}
                {c.reply_count > 0
                  ? ` · ${c.reply_count} repl${c.reply_count === 1 ? "y" : "ies"}`
                  : ""}
              </span>
            </div>
            <div style={{ color: "#a0a0a8", whiteSpace: "pre-wrap" }}>
              {c.text.length > 280 ? c.text.slice(0, 280) + "…" : c.text}
            </div>
          </div>
        ))}
      </div>
      {pulse.summary_model && (
        <div style={{ marginTop: 6, color: "#5a5a64", fontSize: 11 }}>
          pulse model: <code>{pulse.summary_model}</code>
        </div>
      )}
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
        style={{
          width: 120,
          height: 68,
          objectFit: "cover",
          borderRadius: 8,
          background: "#1f1f26",
        }}
      />
    );
  }
  return (
    <div
      className="video-row-thumb"
      style={{
        width: 120,
        height: 68,
        borderRadius: 8,
        background: "#1f1f26",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "#5a5a64",
        fontSize: 12,
      }}
    >
      no thumb
    </div>
  );
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0)
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}
