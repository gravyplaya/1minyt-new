'use client';

import { useState, useTransition, useRef, useEffect } from 'react';
import type { ChatCitation, ChatMessage } from '@/lib/types';
import { chatWithVideoAction, loadChatHistoryAction, chatStatusAction } from '@/app/actions';
import { youtubeVideoUrl } from '../_lib/format';

/**
 * Chat-with-Video panel. Sits inside the VideoSummaryRow, revealed when the
 * user clicks "Chat". The user asks questions about the video; answers are
 * grounded in the transcript with timestamp citations that link back to the
 * exact moment in the YouTube video.
 *
 * Lifecycle:
 *  - On open: load chat history + check if video is indexed.
 *  - On send: auto-index if needed, retrieve chunks via RAG, generate answer.
 *  - Citations render as clickable timestamps. When an embedded player is
 *    present (TAV-21), clicking a citation seeks the player in place; absent
 *    an embedded player, they fall back to opening YouTube at ?t=Ns.
 */
export interface VideoChatPanelProps {
  videoId: string;
  /** Optional seek callback wired to the embedded YouTube player (TAV-21). */
  onSeek?: (seconds: number) => void;
}

export function VideoChatPanel({ videoId, onSeek }: VideoChatPanelProps) {
  const [pending, start] = useTransition();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [citations, setCitations] = useState<ChatCitation[]>([]);
  const [input, setInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [indexed, setIndexed] = useState(false);
  const [chunkCount, setChunkCount] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Load history + index status on first mount.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [history, status] = await Promise.all([
          loadChatHistoryAction(videoId),
          chatStatusAction(videoId),
        ]);
        if (cancelled) return;
        setMessages(history);
        setIndexed(status.indexed);
        setChunkCount(status.chunkCount);
      } catch {
        // Non-fatal — the user can still try to chat.
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, [videoId]);

  // Auto-scroll to bottom on new messages.
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const send = () => {
    const question = input.trim();
    if (!question || pending) return;
    setError(null);
    setInput('');

    // Optimistic: show the user's message immediately.
    const optimisticMsg: ChatMessage = {
      id: `pending-${Date.now()}`,
      video_id: videoId,
      role: 'user',
      content: question,
      created_at: Math.floor(Date.now() / 1000),
    };
    setMessages(prev => [...prev, optimisticMsg]);

    start(async () => {
      const result = await chatWithVideoAction(videoId, question);
      if (!result.ok) {
        setError(result.error ?? 'Failed to get an answer.');
        // Remove the optimistic message on failure.
        setMessages(prev => prev.filter(m => m.id !== optimisticMsg.id));
        return;
      }
      if (result.messages) setMessages(result.messages);
      if (result.citations) setCitations(result.citations);
      setIndexed(true);
    });
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  return (
    <div style={{ marginTop: 12, background: '#111116', borderRadius: 10, border: '1px solid #2a2a33', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ padding: '10px 14px', borderBottom: '1px solid #2a2a33', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: '#e7e7ea', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span>💬</span> Chat with this video
        </div>
        <div style={{ fontSize: 11, color: indexed ? '#5cd9a3' : '#8b8b94' }}>
          {loaded && (indexed ? `${chunkCount} chunks indexed` : 'will index on first question')}
        </div>
      </div>

      {/* Messages */}
      <div ref={scrollRef} style={{ maxHeight: 320, overflowY: 'auto', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {messages.length === 0 && !pending && (
          <div style={{ color: '#8b8b94', fontSize: 13, textAlign: 'center', padding: '20px 0' }}>
            Ask anything about this video — the answers are grounded in the transcript with timestamp links.
          </div>
        )}
        {messages.map(msg => (
          <MessageBubble key={msg.id} msg={msg} videoId={videoId} onSeek={onSeek} />
        ))}
        {pending && (
          <div style={{ color: '#8b8b94', fontSize: 13, fontStyle: 'italic' }}>
            {indexed ? 'Thinking…' : 'Indexing transcript for search…'}
          </div>
        )}
        {error && (
          <div style={{ color: '#ff6363', fontSize: 13 }}>
            {error}
          </div>
        )}
      </div>

      {/* Citations for the latest assistant answer (TAV-21: click-to-seek). */}
      {citations.length > 0 && (
        <CitationList citations={citations} videoId={videoId} onSeek={onSeek} />
      )}

      {/* Input */}
      <div style={{ padding: '10px 14px', borderTop: '1px solid #2a2a33', display: 'flex', gap: 8 }}>
        <input
          type="text"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Ask about this video…"
          disabled={pending}
          style={{
            flex: 1,
            background: '#1a1a20',
            border: '1px solid #2a2a33',
            borderRadius: 8,
            padding: '8px 12px',
            color: '#e7e7ea',
            fontSize: 13,
            outline: 'none',
          }}
        />
        <button
          type="button"
          className="btn btn-primary"
          onClick={send}
          disabled={pending || !input.trim()}
          style={{ fontSize: 12, padding: '8px 14px' }}
        >
          {pending ? '…' : 'Send'}
        </button>
      </div>
    </div>
  );
}

function MessageBubble({ msg, videoId, onSeek }: { msg: ChatMessage; videoId: string; onSeek?: (seconds: number) => void }) {
  const isUser = msg.role === 'user';
  return (
    <div style={{ display: 'flex', justifyContent: isUser ? 'flex-end' : 'flex-start' }}>
      <div
        style={{
          maxWidth: '85%',
          padding: '8px 12px',
          borderRadius: 10,
          fontSize: 13,
          lineHeight: 1.5,
          background: isUser ? '#1a3a5c' : '#1f1f26',
          color: isUser ? '#cfe4ff' : '#d4d4dc',
          border: isUser ? '1px solid #2a4a6c' : '1px solid #2a2a33',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
        }}
      >
        {renderAnswerWithCitations(msg.content, videoId, onSeek)}
      </div>
    </div>
  );
}

/**
 * Render an assistant answer, converting [N] citation markers and M:SS
 * timestamps into clickable links to the YouTube video at that moment.
 * We handle two citation styles the model may emit:
 *  - [1] with a separate citations list → link to the cited chunk's timestamp
 *  - [2:34] inline timestamp → link directly to that moment
 *
 * When an embedded player is available (TAV-21), inline timestamp links seek
 * the player in place instead of opening a new YouTube tab.
 */
function renderAnswerWithCitations(text: string, videoId: string, onSeek?: (seconds: number) => void): React.ReactNode {
  // Pattern: [N] or [M:SS] or [H:MM:SS]
  const pattern = /\[(\d+)(?::\d{1,2})?(?::\d{2})?\]/g;
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;

  while ((match = pattern.exec(text)) !== null) {
    // Text before the citation.
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }

    const fullMatch = match[0];
    // Extract timestamp if present (e.g. [2:34] → 2:34, [1] → no timestamp).
    const inner = fullMatch.slice(1, -1);
    const tsMatch = inner.match(/(\d+):(\d{1,2})(?::(\d{2}))?/);

    if (tsMatch) {
      // Inline timestamp like [2:34] — link directly.
      const seconds = parseTimestampToSeconds(inner);
      if (onSeek && seconds != null) {
        // TAV-21: seek the embedded player in place.
        parts.push(
          // eslint-disable-next-line jsx-a11y/anchor-is-valid
          <a
            key={`cite-${key++}`}
            role="button"
            tabIndex={0}
            onClick={(e: React.MouseEvent) => {
              e.preventDefault();
              onSeek(seconds);
            }}
            onKeyDown={(e: React.KeyboardEvent) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onSeek(seconds);
              }
            }}
            style={{ color: '#5b9eff', textDecoration: 'none', fontWeight: 500, cursor: 'pointer' }}
          >
            {fullMatch}
          </a>
        );
      } else {
        parts.push(
          <a
            key={`cite-${key++}`}
            href={seconds != null ? `${youtubeVideoUrl(videoId)}&t=${seconds}s` : youtubeVideoUrl(videoId)}
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: '#5b9eff', textDecoration: 'none', fontWeight: 500 }}
          >
            {fullMatch}
          </a>
        );
      }
    } else {
      // Bare citation number like [1] — keep as-is (no direct link without the
      // citations array mapping, but the answer text itself is still useful).
      parts.push(
        <span key={`cite-${key++}`} style={{ color: '#5b9eff', fontWeight: 500 }}>
          {fullMatch}
        </span>
      );
    }

    lastIndex = match.index + fullMatch.length;
  }

  // Remaining text.
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return parts.length > 0 ? parts : text;
}

/**
 * TAV-21: Citation chips for the latest assistant answer. Clicking a chip
 * seeks the embedded player to the chunk's start time when available;
 * otherwise it opens YouTube at that timestamp.
 */
function CitationList({
  citations,
  videoId,
  onSeek,
}: {
  citations: ChatCitation[];
  videoId: string;
  onSeek?: (seconds: number) => void;
}) {
  return (
    <div style={{ padding: '8px 14px', borderTop: '1px solid #2a2a33', display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ fontSize: 11, color: '#8b8b94', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 2 }}>
        Citations
      </div>
      {citations.map((c, i) => {
        const seconds = Math.floor(c.start_ms / 1000);
        const label = formatMs(c.start_ms);
        const href = `${youtubeVideoUrl(videoId)}&t=${seconds}s`;
        return (
          <div
            key={i}
            style={{
              display: 'flex',
              gap: 8,
              alignItems: 'baseline',
              fontSize: 12,
              lineHeight: 1.4,
              padding: '4px 8px',
              borderRadius: 6,
              background: '#1a1a20',
              border: '1px solid #2a2a33',
            }}
          >
            {onSeek ? (
              // eslint-disable-next-line jsx-a11y/anchor-is-valid
              <a
                role="button"
                tabIndex={0}
                onClick={(e: React.MouseEvent) => {
                  e.preventDefault();
                  onSeek(seconds);
                }}
                onKeyDown={(e: React.KeyboardEvent) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onSeek(seconds);
                  }
                }}
                style={{ color: '#7db5ff', fontFamily: 'monospace', minWidth: 48, cursor: 'pointer', textDecoration: 'none' }}
                title="Jump to this moment"
              >
                {label}
              </a>
            ) : (
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: '#7db5ff', fontFamily: 'monospace', minWidth: 48, textDecoration: 'none' }}
              >
                {label}
              </a>
            )}
            <span style={{ color: '#a0a0a8', minWidth: 0 }}>
              {c.text.length > 160 ? c.text.slice(0, 160) + '…' : c.text}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/** Format milliseconds as M:SS (or H:MM:SS) for citation chip labels. */
function formatMs(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const s = totalSeconds % 60;
  const m = Math.floor((totalSeconds / 60) % 60);
  const h = Math.floor(totalSeconds / 3600);
  const ss = String(s).padStart(2, '0');
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${ss}`;
  return `${m}:${ss}`;
}

/** Parse "2:34" or "1:02:34" into seconds for YouTube ?t=Ns links. */
function parseTimestampToSeconds(ts: string): number | null {
  const parts = ts.split(':').map(Number);
  if (parts.some(isNaN)) return null;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 1) return parts[0];
  return null;
}