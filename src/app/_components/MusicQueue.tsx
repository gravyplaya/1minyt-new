'use client';

/**
 * TAV-57 + TAV-59: Music page client component.
 *
 * TAV-57 built the two-panel layout (minimized player + Now Playing | Up Next).
 * TAV-59 adds:
 *   - Autoplay: onEnded advances to the next track immediately (no countdown —
 *     music flows differently). Navigates to `/music?v=<next_video_id>`.
 *   - Queue controls: drag-to-reorder, skip (marks `seen`), pin, shuffle,
 *     and "Not now, but later" (push to Summarize Later queue).
 *
 * Mirrors the WatchQueue control surface but without the countdown overlay or
 * the AI tooling (no TL;DR, no key points, no chapters, no chat, no references).
 */

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useRef, useState, useEffect, useTransition } from 'react';
import type { MusicQueueItem } from '@/lib/types';
import { YouTubePlayer, type YouTubePlayerHandle } from './YouTubePlayer';
import {
  skipQueueItemAction,
  unpinQueueItemAction,
  pinToQueueTopAction,
  pinMultipleToQueueTopAction,
  deferToLaterQueueAction,
} from '@/app/actions';
import { formatRelative, formatDuration, youtubeVideoUrl } from '../_lib/format';

/** Number of top queue items to shuffle when the user clicks Shuffle. */
const SHUFFLE_TOP_N = 5;

export interface MusicQueueProps {
  /** Ranked candidate tracks from buildMusicQueue(20), excluding now-playing. */
  queue: MusicQueueItem[];
  /** The "now playing" track. */
  nowPlaying: MusicQueueItem;
}

export function MusicQueue({ queue, nowPlaying }: MusicQueueProps) {
  const videoId = nowPlaying.video_id;
  const router = useRouter();
  const playerHandleRef = useRef<YouTubePlayerHandle | null>(null);
  const [, startTransition] = useTransition();

  // TAV-59: local reorderable copy of the queue. Synced from the prop when the
  // server re-renders. Uses the cancelled-flag pattern so the update is
  // synchronous — no microtask window where handleEnded reads a stale queue[0].
  const [localQueue, setLocalQueue] = useState<MusicQueueItem[]>(queue);
  useEffect(() => {
    let cancelled = false;
    const incoming = queue;
    Promise.resolve().then(() => { if (!cancelled) setLocalQueue(incoming); });
    return () => { cancelled = true; };
  }, [queue]);

  // TAV-59: auto-advance to the next track immediately when the current one
  // ends. No countdown overlay — music flows continuously. If this was the
  // last track, do nothing (the track just ends).
  const handleEnded = () => {
    const next = localQueue[0];
    if (next) {
      router.push(`/music?v=${next.video_id}`);
    }
  };

  const onPlayerReady = (handle: YouTubePlayerHandle) => {
    playerHandleRef.current = handle;
  };

  // TAV-59: drag-to-reorder. Mirrors WatchQueue's implementation.
  const dragIndexRef = useRef<number | null>(null);

  const handleDragStart = (index: number) => {
    dragIndexRef.current = index;
  };

  const handleDrop = (toIndex: number) => {
    const fromIndex = dragIndexRef.current;
    dragIndexRef.current = null;
    if (fromIndex == null || fromIndex === toIndex) return;
    // Bounds check: a concurrent skip/defer may have shrunk localQueue.
    if (fromIndex >= localQueue.length || toIndex >= localQueue.length) return;

    const reordered = [...localQueue];
    const [moved] = reordered.splice(fromIndex, 1);
    reordered.splice(toIndex, 0, moved);
    setLocalQueue(reordered);

    // Pin only the affected range [min, max], not all items up to the max index.
    const lo = Math.min(fromIndex, toIndex);
    const hi = Math.max(fromIndex, toIndex);
    const pinIds = reordered.slice(lo, hi + 1).map((q) => q.video_id);
    startTransition(async () => {
      await pinMultipleToQueueTopAction(pinIds, 'music');
      router.refresh();
    });
  };

  // TAV-59: shuffle the top N tracks.
  const handleShuffle = () => {
    if (localQueue.length < 2) return;
    const n = Math.min(SHUFFLE_TOP_N, localQueue.length);
    const topN = localQueue.slice(0, n);
    const rest = localQueue.slice(n);

    for (let i = topN.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [topN[i], topN[j]] = [topN[j], topN[i]];
    }

    const shuffled = [...topN, ...rest];
    setLocalQueue(shuffled);

    startTransition(async () => {
      await pinMultipleToQueueTopAction(topN.map((q) => q.video_id), 'music');
      router.refresh();
    });
  };

  // TAV-59: skip a track from the queue.
  const handleSkip = (videoId: string) => {
    setLocalQueue((q) => q.filter((item) => item.video_id !== videoId));
    startTransition(async () => {
      await skipQueueItemAction(videoId, 'music');
      router.refresh();
    });
  };

  // TAV-59: pin a track to the top.
  const handlePin = (videoId: string) => {
    startTransition(async () => {
      await pinToQueueTopAction(videoId, 'music');
      router.refresh();
    });
  };

  // TAV-59: unpin a track.
  const handleUnpin = (videoId: string) => {
    startTransition(async () => {
      await unpinQueueItemAction(videoId, 'music');
      router.refresh();
    });
  };

  // TAV-59: "Not now, but later" — push to Summarize Later queue.
  const handleDefer = (videoId: string) => {
    setLocalQueue((q) => q.filter((item) => item.video_id !== videoId));
    startTransition(async () => {
      await deferToLaterQueueAction(videoId, 'music');
      router.refresh();
    });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Minimized player — audio-only bar */}
      <YouTubePlayer
        key={videoId}
        videoId={videoId}
        minimize
        title={nowPlaying.title}
        thumbnailUrl={nowPlaying.thumbnail_url}
        onReady={onPlayerReady}
        onEnded={handleEnded}
      />

      {/* Two-panel layout: Now Playing | Up Next */}
      <div
        className="music-panels"
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1fr) 340px',
          gap: 24,
          alignItems: 'start',
        }}
      >
        {/* Left: Now Playing — title + channel + thumbnail only */}
        <div className="music-now-playing" style={{ minWidth: 0 }}>
          <div
            style={{
              display: 'flex',
              gap: 16,
              alignItems: 'flex-start',
            }}
          >
            {/* Thumbnail */}
            <div style={{ flexShrink: 0 }}>
              {nowPlaying.thumbnail_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={nowPlaying.thumbnail_url}
                  alt={nowPlaying.title}
                  style={{
                    width: 160,
                    height: 90,
                    objectFit: 'cover',
                    borderRadius: 10,
                    background: '#1f1f26',
                    display: 'block',
                  }}
                />
              ) : (
                <div
                  style={{
                    width: 160,
                    height: 90,
                    borderRadius: 10,
                    background: '#1f1f26',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#5a5a64',
                    fontSize: 12,
                  }}
                >
                  no thumb
                </div>
              )}
            </div>

            {/* Title + channel */}
            <div style={{ minWidth: 0, paddingTop: 4 }}>
              <h1
                style={{
                  fontSize: 20,
                  fontWeight: 700,
                  marginBottom: 4,
                  color: '#e7e7ea',
                  lineHeight: 1.3,
                }}
              >
                {nowPlaying.title}
              </h1>
              <div
                style={{
                  color: '#8b8b94',
                  fontSize: 14,
                  marginBottom: 8,
                  display: 'flex',
                  gap: 10,
                  flexWrap: 'wrap',
                  alignItems: 'center',
                }}
              >
                <span>{nowPlaying.channel_title}</span>
                {nowPlaying.duration_seconds != null && (
                  <span>· {formatDuration(nowPlaying.duration_seconds)}</span>
                )}
                {nowPlaying.published_at && (
                  <span>· {formatRelative(nowPlaying.published_at)}</span>
                )}
                <a
                  href={youtubeVideoUrl(videoId)}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: '#5b9eff', textDecoration: 'none' }}
                >
                  Open on YouTube ↗
                </a>
              </div>
            </div>
          </div>
        </div>

        {/* Right: Up Next queue with TAV-59 controls */}
        <aside
          className="music-up-next"
          style={{
            position: 'sticky',
            top: 16,
            maxHeight: 'calc(100vh - 32px)',
            overflowY: 'auto',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: 12,
            }}
          >
            <div
              style={{
                fontSize: 13,
                fontWeight: 600,
                color: '#e7e7ea',
                textTransform: 'uppercase',
                letterSpacing: '0.06em',
              }}
            >
              Up Next · {localQueue.length}
            </div>
            {/* TAV-59: Shuffle button */}
            <button
              type="button"
              className="btn btn-ghost"
              onClick={handleShuffle}
              disabled={localQueue.length < 2}
              title="Shuffle the top 5"
              style={{ fontSize: 11, padding: '3px 8px' }}
            >
              🔀 Shuffle
            </button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {localQueue.map((item, i) => (
              <MusicQueueRow
                key={item.video_id}
                item={item}
                index={i}
                active={item.video_id === videoId}
                isPinned={item.is_pinned}
                onDragStart={handleDragStart}
                onDrop={handleDrop}
                onSkip={handleSkip}
                onPin={handlePin}
                onUnpin={handleUnpin}
                onDefer={handleDefer}
              />
            ))}
          </div>
        </aside>
      </div>
    </div>
  );
}

/** A single queue row with TAV-59 controls. Draggable for reorder. */
function MusicQueueRow({
  item,
  index,
  active,
  isPinned,
  onDragStart,
  onDrop,
  onSkip,
  onPin,
  onUnpin,
  onDefer,
}: {
  item: MusicQueueItem;
  index: number;
  active: boolean;
  isPinned: boolean;
  onDragStart: (index: number) => void;
  onDrop: (index: number) => void;
  onSkip: (videoId: string) => void;
  onPin: (videoId: string) => void;
  onUnpin: (videoId: string) => void;
  onDefer: (videoId: string) => void;
}) {
  const [dragOver, setDragOver] = useState(false);

  return (
    <Link
      href={`/music?v=${item.video_id}`}
      style={{ textDecoration: 'none' }}
      aria-label={`Play ${item.title}`}
      draggable
      onDragStart={() => onDragStart(index)}
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => { e.preventDefault(); setDragOver(false); onDrop(index); }}
    >
      <div
        className="music-queue-row"
        style={{
          display: 'grid',
          gridTemplateColumns: '120px 1fr',
          gap: 10,
          padding: 8,
          borderRadius: 10,
          border: dragOver
            ? '1px solid #5b9eff'
            : active
              ? '1px solid rgba(91,158,255,0.4)'
              : '1px solid #2a2a33',
          background: dragOver
            ? 'rgba(91,158,255,0.1)'
            : active
              ? 'rgba(91,158,255,0.06)'
              : '#15151a',
          cursor: 'pointer',
          transition: 'background .12s ease, border-color .12s ease',
        }}
        onMouseEnter={(e) => {
          if (!active && !dragOver) {
            (e.currentTarget as HTMLDivElement).style.background = '#1a1a20';
            (e.currentTarget as HTMLDivElement).style.borderColor = '#3a3a44';
          }
        }}
        onMouseLeave={(e) => {
          if (!active && !dragOver) {
            (e.currentTarget as HTMLDivElement).style.background = '#15151a';
            (e.currentTarget as HTMLDivElement).style.borderColor = '#2a2a33';
          }
        }}
      >
        {/* Thumbnail */}
        <div style={{ position: 'relative' }}>
          {item.thumbnail_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={item.thumbnail_url}
              alt={item.title}
              style={{
                width: 120,
                height: 68,
                objectFit: 'cover',
                borderRadius: 6,
                background: '#1f1f26',
                display: 'block',
              }}
            />
          ) : (
            <div
              style={{
                width: 120,
                height: 68,
                borderRadius: 6,
                background: '#1f1f26',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#5a5a64',
                fontSize: 11,
              }}
            >
              no thumb
            </div>
          )}
          {/* Rank badge */}
          <span
            style={{
              position: 'absolute',
              top: 4,
              left: 4,
              background: 'rgba(0,0,0,0.75)',
              color: '#e7e7ea',
              fontSize: 11,
              fontWeight: 600,
              padding: '1px 5px',
              borderRadius: 4,
              fontFamily: 'monospace',
            }}
          >
            {index + 1}
          </span>
          {item.duration_seconds != null && (
            <span
              style={{
                position: 'absolute',
                bottom: 4,
                right: 4,
                background: 'rgba(0,0,0,0.8)',
                color: '#e7e7ea',
                fontSize: 10,
                padding: '1px 4px',
                borderRadius: 3,
                fontFamily: 'monospace',
              }}
            >
              {formatDuration(item.duration_seconds)}
            </span>
          )}
        </div>

        {/* Details */}
        <div style={{ minWidth: 0 }}>
          <div
            style={{
              color: active ? '#cfe4ff' : '#e7e7ea',
              fontSize: 13,
              fontWeight: 600,
              lineHeight: 1.3,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
            }}
          >
            {item.title}
          </div>
          <div
            style={{
              color: '#8b8b94',
              fontSize: 11,
              marginTop: 2,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {item.channel_title}
            {item.published_at && ` · ${formatRelative(item.published_at)}`}
          </div>

          {/* Score bar */}
          <div
            style={{
              marginTop: 6,
              height: 3,
              borderRadius: 999,
              background: '#2a2a33',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                width: `${Math.round(item.score * 100)}%`,
                height: '100%',
                background: 'linear-gradient(90deg, #5b9eff, #7db5ff)',
                borderRadius: 999,
              }}
            />
          </div>

          {/* TAV-59: Queue control buttons */}
          <div
            style={{
              display: 'flex',
              gap: 4,
              marginTop: 6,
            }}
          >
            <QueueControlButton
              label={isPinned ? '📌' : '📍'}
              title={isPinned ? 'Unpin from top' : 'Pin to play next'}
              onClick={isPinned ? () => onUnpin(item.video_id) : () => onPin(item.video_id)}
            />
            <QueueControlButton
              label="⏭"
              title="Skip (remove from queue)"
              onClick={() => onSkip(item.video_id)}
            />
            <QueueControlButton
              label="⏰"
              title="Not now, but later (add to Summarize Later)"
              onClick={() => onDefer(item.video_id)}
            />
          </div>
        </div>
      </div>
    </Link>
  );
}

/** Compact icon button for queue row controls. Stops propagation so the row's
 *  Link navigation doesn't fire when a control button is clicked. */
function QueueControlButton({
  label,
  title,
  onClick,
}: {
  label: string;
  title: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="btn btn-ghost"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onClick();
      }}
      title={title}
      style={{
        fontSize: 13,
        padding: '2px 6px',
        minWidth: 28,
        lineHeight: 1,
      }}
    >
      {label}
    </button>
  );
}
