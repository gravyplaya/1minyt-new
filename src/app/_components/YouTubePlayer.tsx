'use client';

/**
 * YouTube IFrame Player wrapper with transcript-synced seek.
 *
 * Loads the YouTube IFrame Player API (https://developers.google.com/youtube/iframe_api_reference)
 * once per page, then renders a controllable player. Exposes an imperative
 * `seekTo(seconds)` handle via the `onReady` callback so parents (e.g. the chat
 * panel's citation clicks) can jump the player to a specific timestamp.
 *
 * Also tracks the current playback position and — when `segments` are provided —
 * highlights the transcript segment that is currently playing.
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import type { TranscriptSegment } from '@/lib/types';
import { recordVideoPlayAction } from '@/app/actions';

// ----- YT IFrame API minimal types (avoid pulling in @types/youtube) ---------

/** Subset of the YT.Player API we actually call. */
interface YTPlayer {
  playVideo(): void;
  pauseVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  getCurrentTime(): number;
  getDuration(): number;
  getPlayerState(): number;
  loadVideoById(videoId: string, startSeconds?: number): void;
  destroy(): void;
}

interface YTPlayerEvent {
  target: YTPlayer;
  data: number;
}

interface YTPlayerOptions {
  videoId: string;
  start?: number;
  width?: string | number;
  height?: string | number;
  playerVars?: Record<string, unknown>;
  events?: {
    onReady?: (e: YTPlayerEvent) => void;
    onStateChange?: (e: YTPlayerEvent) => void;
  };
}

interface YTNamespace {
  Player: new (el: HTMLElement | string, opts: YTPlayerOptions) => YTPlayer;
  PlayerState: {
    UNSTARTED: -1;
    ENDED: 0;
    PLAYING: 1;
    PAUSED: 2;
    BUFFERING: 3;
    CUED: 5;
  };
}

declare global {
  interface Window {
    YT?: YTNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

// ----- API loader ------------------------------------------------------------

let apiLoadPromise: Promise<void> | null = null;

/**
 * Inject the IFrame API script exactly once and resolve when `window.YT.Player`
 * is available. Subsequent callers share the same promise.
 */
function loadIframeApi(): Promise<void> {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('YouTube IFrame API can only load in the browser.'));
  }
  if (window.YT?.Player) return Promise.resolve();
  if (apiLoadPromise) return apiLoadPromise;

  apiLoadPromise = new Promise<void>((resolve, reject) => {
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      // Restore any prior hook (defensive — we should be the only consumer).
      prev?.();
      if (window.YT?.Player) resolve();
      else reject(new Error('YouTube IFrame API loaded but window.YT.Player is missing.'));
    };

    const existing = document.getElementById('youtube-iframe-api');
    if (existing) return; // script already injecting; resolve via onYouTubeIframeAPIReady
    const script = document.createElement('script');
    script.id = 'youtube-iframe-api';
    script.src = 'https://www.youtube.com/iframe_api';
    script.async = true;
    script.onerror = () => reject(new Error('Failed to load YouTube IFrame API script.'));
    document.head.appendChild(script);
  });

  return apiLoadPromise;
}

// ----- Helpers ---------------------------------------------------------------

/** Format a number of seconds as M:SS or H:MM:SS. */
function fmtTime(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return '0:00';
  const s = Math.floor(totalSeconds % 60);
  const m = Math.floor((totalSeconds / 60) % 60);
  const h = Math.floor(totalSeconds / 3600);
  const ss = String(s).padStart(2, '0');
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${ss}`;
  return `${m}:${ss}`;
}

// ----- Component -------------------------------------------------------------

export interface YouTubePlayerHandle {
  /** Seek the player to a timestamp (in seconds) and start playback. */
  seekTo: (seconds: number) => void;
}

export interface YouTubePlayerProps {
  videoId: string;
  /** Optional transcript segments for "now playing" highlight. */
  segments?: TranscriptSegment[];
  /** Receives an imperative handle once the player is ready. */
  onReady?: (handle: YouTubePlayerHandle) => void;
  /**
   * Optional initial start position in seconds (e.g. from a chapter click).
   * Reserved for future callers — VideoSummaryRow currently relies on
   * `pendingSeekRef` + `onReady` for deferred seeks instead of passing this.
   */
  initialStart?: number;
}

export function YouTubePlayer({ videoId, segments, onReady, initialStart }: YouTubePlayerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<YTPlayer | null>(null);
  const readyRef = useRef(false);
  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  // TAV-41: track the last position we recorded as a ref (not state) so the
  // 250 ms position poller below doesn't tear down + rebuild every ~30 s.
  const lastRecordedPlayRef = useRef(0);
  const [error, setError] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState<number>(-1);

  // Stable callback so we don't re-create the player on every render.
  const onReadyRef = useRef(onReady);
  const initialStartRef = useRef(initialStart ?? 0);
  // Sync refs in an effect to satisfy react-hooks/refs (no ref writes during render).
  useEffect(() => {
    onReadyRef.current = onReady;
  }, [onReady]);
  useEffect(() => {
    initialStartRef.current = initialStart ?? 0;
  }, [initialStart]);

  // Imperative seek exposed to the parent.
  const seekTo = useCallback((seconds: number) => {
    const p = playerRef.current;
    if (!p) return;
    const clamped = Math.max(0, seconds);
    p.seekTo(clamped, true);
    p.playVideo();
  }, []);

  // Create the player once the API + DOM are ready.
  useEffect(() => {
    let cancelled = false;

    loadIframeApi()
      .then(() => {
        if (cancelled || !containerRef.current || !window.YT) return;
        // Reset mount state inside the async block (not synchronously at
        // effect top) to avoid the react-hooks/set-state-in-effect warning.
        setError(null);
        setReady(false);
        readyRef.current = false;
        // The IFrame replaces this child element.
        const mount = document.createElement('div');
        mount.style.width = '100%';
        mount.style.height = '100%';
        containerRef.current.innerHTML = '';
        containerRef.current.appendChild(mount);

        playerRef.current = new window.YT.Player(mount, {
          videoId,
          start: initialStartRef.current || undefined,
          width: '100%',
          height: '100%',
          playerVars: {
            rel: 0,
            modestbranding: 1,
            playsinline: 1,
          },
          events: {
            onReady: (e: YTPlayerEvent) => {
              if (cancelled) return;
              readyRef.current = true;
              setReady(true);
              try {
                setDuration(e.target.getDuration() || 0);
              } catch { /* duration may be 0 until metadata loads */ }
              onReadyRef.current?.({ seekTo });
            },
            onStateChange: (e: YTPlayerEvent) => {
              if (cancelled) return;
              const state = e.data;
              setPlaying(state === window.YT!.PlayerState.PLAYING);
              if (state === window.YT!.PlayerState.PLAYING || state === window.YT!.PlayerState.CUED) {
                try {
                  const d = e.target.getDuration();
                  if (d) setDuration(d);
                } catch { /* ignore */ }
              }
            },
          },
        });
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load YouTube player.');
        }
      });

    return () => {
      cancelled = true;
      readyRef.current = false;
      try {
        playerRef.current?.destroy();
      } catch { /* ignore */ }
      playerRef.current = null;
    };
    // We intentionally only re-create the player when videoId changes. seekTo
    // is stable; onReady/initialStart are captured via refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoId]);

  // Position-tracking poller. Only runs while playing to avoid needless
  // re-renders on a paused player. Updates currentTime + active segment index.
  useEffect(() => {
    if (!ready || !playing) return;
    const id = window.setInterval(() => {
      const p = playerRef.current;
      if (!p) return;
      try {
        const t = p.getCurrentTime() || 0;
        setCurrentTime(t);
        if (t - lastRecordedPlayRef.current >= 30) {
          lastRecordedPlayRef.current = t;
          void recordVideoPlayAction(videoId, t, duration > 0 && t / duration >= 0.9);
        }
        if (segments && segments.length > 0) {
          // Binary search for the last segment whose start_ms <= current time.
          const ms = t * 1000;
          let lo = 0;
          let hi = segments.length - 1;
          let idx = -1;
          while (lo <= hi) {
            const mid = (lo + hi) >> 1;
            if (segments[mid].start_ms <= ms) {
              idx = mid;
              lo = mid + 1;
            } else {
              hi = mid - 1;
            }
          }
          setActiveIndex(idx);
        }
      } catch { /* player may be briefly unavailable during teardown */ }
    }, 250);
    return () => window.clearInterval(id);
  }, [ready, playing, segments, videoId, duration]);

  const togglePlay = () => {
    const p = playerRef.current;
    if (!p) return;
    try {
      if (playing) p.pauseVideo();
      else p.playVideo();
    } catch { /* ignore */ }
  };

  const onScrub = (e: React.ChangeEvent<HTMLInputElement>) => {
    const seconds = Number(e.target.value);
    if (!Number.isFinite(seconds)) return;
    setCurrentTime(seconds);
    playerRef.current?.seekTo(seconds, true);
  };

  // -------- Render -----------------------------------------------------------

  if (error) {
    return (
      <div style={{ padding: '12px 14px', fontSize: 13, color: '#ff9b6b', background: '#15151a', borderRadius: 10, border: '1px solid #2a2a33' }}>
        Couldn&apos;t load the embedded player: {error}.{' '}
        <a
          href={`https://www.youtube.com/watch?v=${videoId}`}
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: '#5b9eff', textDecoration: 'none' }}
        >
          Open on YouTube
        </a>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {/* IFrame mount point */}
      <div style={{ position: 'relative', width: '100%', paddingTop: '56.25%', background: '#000', borderRadius: 10, overflow: 'hidden' }}>
        <div ref={containerRef} style={{ position: 'absolute', inset: 0 }} />
      </div>

      {/* Controls */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12, color: '#c2c2cb' }}>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={togglePlay}
          disabled={!ready}
          aria-label={playing ? 'Pause' : 'Play'}
          style={{ fontSize: 13, padding: '4px 10px', minWidth: 64 }}
        >
          {ready ? (playing ? '⏸ Pause' : '▶ Play') : '…'}
        </button>
        <span style={{ fontFamily: 'monospace', color: '#8b8b94', minWidth: 80, textAlign: 'center' }}>
          {fmtTime(currentTime)} / {fmtTime(duration)}
        </span>
        <input
          type="range"
          min={0}
          max={duration || 0}
          step={0.1}
          value={Math.min(currentTime, duration || 0)}
          onChange={onScrub}
          disabled={!ready || duration === 0}
          aria-label="Seek"
          style={{ flex: 1, accentColor: '#5b9eff' }}
        />
      </div>

      {/* Now-playing transcript segment highlight */}
      {segments && segments.length > 0 && activeIndex >= 0 && (
        <div
          key={activeIndex}
          style={{
            fontSize: 15,
            lineHeight: 1.6,
            color: "#e7e7ea",
            background: "rgba(91,158,255,0.08)",
            border: "1px solid rgba(91,158,255,0.25)",
            borderRadius: 8,
            padding: "10px 14px",
            maxHeight: 120,
            overflowY: "auto",
          }}
        >
          <span style={{ color: "#7db5ff", fontFamily: "monospace", fontSize: 13, marginRight: 8 }}>
            {fmtTime(segments[activeIndex].start_ms / 1000)}
          </span>
          {segments[activeIndex].text}
        </div>
      )}
    </div>
  );
}
