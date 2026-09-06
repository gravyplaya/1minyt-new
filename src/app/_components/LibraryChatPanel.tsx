'use client';

import { useState, useTransition, useRef, useEffect, useMemo } from 'react';
import type { ChatScopeOptions, LibraryChatCitation, LibraryChatMessage } from '@/lib/types';
import {
  chatWithLibraryAction,
  loadLibraryChatHistoryAction,
  clearLibraryChatAction,
  libraryChatStatusAction,
  listChatScopeOptionsAction,
  generateChannelDossierAction,
  getChannelDossierAction,
} from '@/app/actions';
import { youtubeVideoUrl } from '../_lib/format';

/**
 * Library-wide chat panel (TAV-63/64/65).
 *
 * E: every question retrieves across all indexed transcript + summary chunks.
 * F: a scope picker (all / folder / tag / channel) narrows retrieval server-side.
 * G: when scoped to a channel, a one-click "Generate memory" button distills
 *    the channel's summaries into a dossier the chat prompt injects.
 * H: Deep Research toggle runs an agentic tool loop server-side; the tool
 *    calls surface under each answer.
 */

type ScopeValue = string; // 'all' | 'channel:<id>' | 'folder:<id>' | 'tag:<id>'

export function LibraryChatPanel() {
  const [pending, start] = useTransition();
  const [scope, setScope] = useState<ScopeValue>('all');
  const [deepResearch, setDeepResearch] = useState(false);
  const [messages, setMessages] = useState<LibraryChatMessage[]>([]);
  const [citations, setCitations] = useState<LibraryChatCitation[]>([]);
  const [lastToolCalls, setLastToolCalls] = useState<string[]>([]);
  const [input, setInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [options, setOptions] = useState<ChatScopeOptions | null>(null);
  const [status, setStatus] = useState<{ indexedVideos: number; chunkCount: number; summarizedVideos: number } | null>(null);
  const [dossierBusy, setDossierBusy] = useState(false);
  const [dossierInfo, setDossierInfo] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Load scope options + index status once.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [opts, stat] = await Promise.all([
          listChatScopeOptionsAction(),
          libraryChatStatusAction(),
        ]);
        if (cancelled) return;
        setOptions(opts);
        setStatus(stat);
      } catch {
        // Non-fatal.
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Load this scope's thread when the scope changes.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const history = await loadLibraryChatHistoryAction(scope);
        if (cancelled) return;
        setMessages(history);
        setError(null);
        setCitations([]);
        setLastToolCalls([]);
        setDossierInfo(null);
      } catch {
        if (!cancelled) {
          setMessages([]);
          setError(null);
          setCitations([]);
          setLastToolCalls([]);
          setDossierInfo(null);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [scope]);

  // Auto-scroll on new messages.
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, pending]);

  const channelId = useMemo(() => (scope.startsWith('channel:') ? scope.slice('channel:'.length) : null), [scope]);

  const ensureDossier = () => {
    if (!channelId || dossierBusy) return;
    setDossierBusy(true);
    setDossierInfo(null);
    start(async () => {
      try {
        const existing = await getChannelDossierAction(channelId);
        if (existing.ok && existing.dossier) {
          setDossierInfo('Channel memory is ready — it is now part of this conversation\'s context.');
          return;
        }
        const result = await generateChannelDossierAction(channelId);
        if (result.ok) {
          setDossierInfo(`Channel memory generated from ${result.dossier?.video_count ?? '?'} summaries.`);
        } else {
          setDossierInfo(result.error ?? 'Failed to generate channel memory.');
        }
      } finally {
        setDossierBusy(false);
      }
    });
  };

  const clearThread = () => {
    start(async () => {
      await clearLibraryChatAction(scope);
      setMessages([]);
      setCitations([]);
      setLastToolCalls([]);
    });
  };

  const send = () => {
    const question = input.trim();
    if (!question || pending) return;
    setError(null);
    setInput('');

    const optimistic: LibraryChatMessage = {
      id: `pending-${Date.now()}`,
      scope,
      role: 'user',
      content: question,
      tool_trace: null,
      created_at: Math.floor(Date.now() / 1000),
    };
    setMessages(prev => [...prev, optimistic]);

    start(async () => {
      const result = await chatWithLibraryAction(scope, question, deepResearch);
      if (!result.ok) {
        setError(result.error ?? 'Failed to get an answer.');
        setMessages(prev => prev.filter(m => m.id !== optimistic.id));
        return;
      }
      if (result.messages) setMessages(result.messages);
      setCitations(result.citations ?? []);
      setLastToolCalls(result.toolCalls ?? []);
    });
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  return (
    <div style={{ background: '#111116', borderRadius: 10, border: '1px solid #2a2a33', overflow: 'hidden' }}>
      {/* Toolbar: scope picker + deep research toggle + status */}
      <div style={{ padding: '10px 14px', borderBottom: '1px solid #2a2a33', display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
        <select
          value={scope}
          onChange={e => setScope(e.target.value)}
          style={{
            background: '#1a1a20',
            border: '1px solid #2a2a33',
            borderRadius: 8,
            padding: '6px 10px',
            color: '#e7e7ea',
            fontSize: 13,
            outline: 'none',
            maxWidth: 260,
          }}
          aria-label="Chat scope"
        >
          <option value="all">🌐 Entire library</option>
          {options && options.folders.length > 0 && (
            <optgroup label="Folders">
              {options.folders.map(f => <option key={f.id} value={`folder:${f.id}`}>📁 {f.name}</option>)}
            </optgroup>
          )}
          {options && options.tags.length > 0 && (
            <optgroup label="Tags">
              {options.tags.map(t => <option key={t.id} value={`tag:${t.id}`}>🏷 {t.name}</option>)}
            </optgroup>
          )}
          {options && options.channels.length > 0 && (
            <optgroup label="Channels">
              {options.channels.map(c => <option key={c.id} value={`channel:${c.id}`}>▶ {c.title}</option>)}
            </optgroup>
          )}
        </select>

        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#c2c2cb', cursor: 'pointer' }} title="Let the agent search transcripts, summaries, and channel profiles itself">
          <input
            type="checkbox"
            checked={deepResearch}
            onChange={e => setDeepResearch(e.target.checked)}
          />
          🕵 Deep Research
        </label>

        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10, fontSize: 11, color: '#8b8b94' }}>
          {status && (
            <span>
              {status.indexedVideos} videos indexed · {status.chunkCount} chunks · {status.summarizedVideos} summarized
            </span>
          )}
          {messages.length > 0 && (
            <button
              type="button"
              onClick={clearThread}
              disabled={pending}
              style={{ background: 'transparent', border: 'none', color: '#8b8b94', fontSize: 11, cursor: 'pointer', textDecoration: 'underline' }}
            >
              Clear chat
            </button>
          )}
        </div>
      </div>

      {/* Channel memory (G) — only when scoped to a channel */}
      {channelId && (
        <div style={{ padding: '8px 14px', borderBottom: '1px solid #2a2a33', display: 'flex', alignItems: 'center', gap: 10, fontSize: 12, color: '#a0a0a8' }}>
          <span>🧠</span>
          <span>Channel memory gives the chat this channel&apos;s long-term context, distilled from its summaries.</span>
          <button
            type="button"
            className="btn"
            onClick={ensureDossier}
            disabled={dossierBusy || pending}
            style={{ fontSize: 11, padding: '4px 10px', flexShrink: 0 }}
          >
            {dossierBusy ? 'Distilling…' : 'Generate memory'}
          </button>
        </div>
      )}
      {dossierInfo && (
        <div style={{ padding: '6px 14px', borderBottom: '1px solid #2a2a33', fontSize: 12, color: '#5cd9a3' }}>
          {dossierInfo}
        </div>
      )}

      {/* Messages */}
      <div ref={scrollRef} style={{ maxHeight: 460, overflowY: 'auto', padding: '14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {messages.length === 0 && !pending && (
          <div style={{ color: '#8b8b94', fontSize: 13, textAlign: 'center', padding: '24px 0' }}>
            Try: &quot;What are the main topics across my subscriptions right now?&quot; or
            &quot;Which channels cover AI, and do any disagree?&quot;
          </div>
        )}
        {messages.map(msg => (
          <LibraryMessageBubble key={msg.id} msg={msg} />
        ))}
        {pending && (
          <div style={{ color: '#8b8b94', fontSize: 13, fontStyle: 'italic' }}>
            {deepResearch ? 'Researching — searching transcripts and summaries…' : 'Searching your library…'}
          </div>
        )}
        {error && <div style={{ color: '#ff6363', fontSize: 13 }}>{error}</div>}
      </div>

      {/* Tool trace (H) + citations for the latest answer */}
      {lastToolCalls.length > 0 && (
        <div style={{ padding: '8px 14px', borderTop: '1px solid #2a2a33', fontSize: 12, color: '#8b8b94' }}>
          <span style={{ marginRight: 6 }}>🕵 Agent searches:</span>
          {lastToolCalls.join(' · ')}
        </div>
      )}
      {citations.length > 0 && <LibraryCitationList citations={citations} />}

      {/* Input */}
      <div style={{ padding: '10px 14px', borderTop: '1px solid #2a2a33', display: 'flex', gap: 8 }}>
        <input
          type="text"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={deepResearch ? 'Ask a research question…' : 'Ask across your library…'}
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

function LibraryMessageBubble({ msg }: { msg: LibraryChatMessage }) {
  const isUser = msg.role === 'user';
  let toolTrace: string[] = [];
  if (msg.tool_trace) {
    try { toolTrace = JSON.parse(msg.tool_trace) as string[]; } catch { toolTrace = []; }
  }
  return (
    <div style={{ display: 'flex', justifyContent: isUser ? 'flex-end' : 'flex-start', flexDirection: 'column', alignItems: isUser ? 'flex-end' : 'flex-start', gap: 4 }}>
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
        {msg.content}
      </div>
      {!isUser && toolTrace.length > 0 && (
        <div style={{ fontSize: 11, color: '#8b8b94', maxWidth: '85%' }}>
          🕵 {toolTrace.join(' · ')}
        </div>
      )}
    </div>
  );
}

function LibraryCitationList({ citations }: { citations: LibraryChatCitation[] }) {
  return (
    <div style={{ padding: '8px 14px', borderTop: '1px solid #2a2a33', display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ fontSize: 11, color: '#8b8b94', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 2 }}>
        Sources
      </div>
      {citations.map((c, i) => {
        const seconds = Math.floor(c.startMs / 1000);
        const label = formatMs(c.startMs);
        const href = `${youtubeVideoUrl(c.videoId)}&t=${seconds}s`;
        return (
          <a
            key={`${c.videoId}-${c.startMs}-${i}`}
            href={href}
            target="_blank"
            rel="noopener noreferrer"
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
              textDecoration: 'none',
              color: '#a0a0a8',
            }}
          >
            <span style={{ color: '#7db5ff', fontFamily: 'monospace', minWidth: 48 }}>
              {c.chunkType === 'summary' ? 'TL;DR' : label}
            </span>
            <span style={{ color: '#d4d4dc', fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 240 }}>
              {c.videoTitle}
            </span>
            <span style={{ color: '#8b8b94', whiteSpace: 'nowrap' }}>{c.channelTitle}</span>
            <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {c.text.length > 120 ? c.text.slice(0, 120) + '…' : c.text}
            </span>
          </a>
        );
      })}
    </div>
  );
}

function formatMs(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const s = totalSeconds % 60;
  const m = Math.floor((totalSeconds / 60) % 60);
  const h = Math.floor(totalSeconds / 3600);
  const ss = String(s).padStart(2, '0');
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${ss}`;
  return `${m}:${ss}`;
}
