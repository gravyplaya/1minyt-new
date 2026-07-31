'use client';

import { useState, useTransition, useEffect } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import type { TranscriptSearchResult } from '@/lib/types';
import { searchTranscriptsAction } from '@/app/actions';

/**
 * Search-across-transcripts form. On submit, calls the searchTranscriptsAction
 * server action and renders results with highlighted query terms and clickable
 * timestamp links to YouTube.
 */
export function TranscriptSearchForm({ initialQuery }: { initialQuery: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [input, setInput] = useState(initialQuery);
  const [pending, start] = useTransition();
  const [results, setResults] = useState<TranscriptSearchResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Run an initial search if the page was opened with ?q=...
  useEffect(() => {
    const q = initialQuery.trim();
    if (!q) return;
    start(async () => {
      try {
        const r = await searchTranscriptsAction(q);
        setResults(r);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const q = input.trim();
    if (!q || pending) return;
    setError(null);
    setResults(null);

    // Update the URL so the query is bookmarkable.
    const params = new URLSearchParams(searchParams.toString());
    params.set('q', q);
    router.replace(`/search?${params.toString()}`);

    start(async () => {
      try {
        const r = await searchTranscriptsAction(q);
        setResults(r);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    });
  };

  return (
    <>
      <form onSubmit={submit} style={{ display: 'flex', gap: 8, marginBottom: 24 }}>
        <input
          type="text"
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder="Search all transcripts — e.g. “transformer architecture”"
          autoFocus
          style={{
            flex: 1,
            background: '#15151a',
            border: '1px solid #2a2a33',
            borderRadius: 8,
            padding: '10px 14px',
            color: '#e7e7ea',
            fontSize: 14,
            outline: 'none',
          }}
        />
        <button
          type="submit"
          className="btn btn-primary"
          disabled={pending || !input.trim()}
          style={{ fontSize: 13, padding: '10px 20px' }}
        >
          {pending ? 'Searching…' : 'Search'}
        </button>
      </form>

      {pending && results === null && (
        <div style={{ color: '#8b8b94', fontSize: 13 }}>Searching transcripts…</div>
      )}

      {error && (
        <div style={{ color: '#ff6363', fontSize: 13, marginBottom: 16 }}>
          {error}
        </div>
      )}

      {results !== null && !pending && (
        <SearchResults results={results} query={initialQuery.trim()} />
      )}
    </>
  );
}

function SearchResults({ results, query }: { results: TranscriptSearchResult[]; query: string }) {
  if (results.length === 0) {
    return (
      <div style={{ maxWidth: 480, margin: '40px auto', textAlign: 'center' }}>
        <div style={{ fontSize: 28, marginBottom: 8 }}>🔎</div>
        <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 6 }}>No matches found</h2>
        <p style={{ color: '#8b8b94', fontSize: 13, lineHeight: 1.5 }}>
          {query
            ? `No transcript segments matched “${query}”. Try different keywords, or index more videos by chatting with them.`
            : 'Type a query above to search across all your indexed transcripts.'}
        </p>
      </div>
    );
  }

  return (
    <div>
      <p style={{ color: '#8b8b94', fontSize: 12, marginBottom: 14 }}>
        {results.length} {results.length === 1 ? 'match' : 'matches'} across {new Set(results.map(r => r.videoId)).size} {new Set(results.map(r => r.videoId)).size === 1 ? 'video' : 'videos'}
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {results.map((r, i) => (
          <ResultCard key={`${r.videoId}-${r.startMs}-${i}`} result={r} query={query} />
        ))}
      </div>
    </div>
  );
}

function ResultCard({ result, query }: { result: TranscriptSearchResult; query: string }) {
  const seconds = Math.floor(result.startMs / 1000);
  const timestamp = formatTimestamp(result.startMs);
  const ytUrl = `https://www.youtube.com/watch?v=${result.videoId}&t=${seconds}s`;

  return (
    <div
      style={{
        background: '#15151a',
        border: '1px solid #2a2a33',
        borderRadius: 10,
        padding: '14px 16px',
        transition: 'border-color .15s ease',
      }}
    >
      {/* Header: video title + channel */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
        <Link
          href={`/c/${result.channelId}`}
          style={{ color: '#c2c2cb', fontSize: 12, textDecoration: 'none' }}
        >
          {result.channelTitle}
        </Link>
        <span style={{ color: '#5a5a64', fontSize: 11 }}>·</span>
        <span style={{ color: '#e7e7ea', fontSize: 13, fontWeight: 500 }}>
          {result.videoTitle}
        </span>
      </div>

      {/* Matched text with query highlighting */}
      <p style={{ color: '#c2c2cb', fontSize: 13, lineHeight: 1.6, margin: 0, marginBottom: 10 }}>
        <HighlightedText text={result.chunkText} query={query} />
      </p>

      {/* Footer: timestamp link + score */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <a
          href={ytUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="chip"
          style={{
            background: 'rgba(91, 158, 255, .12)',
            borderColor: 'rgba(91, 158, 255, .3)',
            color: '#5b9eff',
            textDecoration: 'none',
          }}
        >
          ▶ {timestamp}
        </a>
        <span style={{ color: '#5a5a64', fontSize: 11 }}>
          relevance {(result.score * 100).toFixed(0)}%
        </span>
      </div>
    </div>
  );
}

/**
 * Highlight occurrences of the query terms in the matched text. We split on
 * word boundaries and wrap matches in a <mark> tag.
 */
function HighlightedText({ text, query }: { text: string; query: string }) {
  if (!query.trim()) return <>{text}</>;

  const terms = query
    .toLowerCase()
    .split(/\s+/)
    .filter(t => t.length >= 2)
    .map(escapeRegExp);

  if (terms.length === 0) return <>{text}</>;

  const pattern = new RegExp(`(${terms.join('|')})`, 'gi');
  const parts = text.split(pattern);

  // split() with a capturing group places captured matches at odd indices.
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <mark
            key={i}
            style={{
              background: 'rgba(91, 158, 255, .25)',
              color: '#cfe4ff',
              borderRadius: 3,
              padding: '0 2px',
            }}
          >
            {part}
          </mark>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  );
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Format milliseconds as M:SS or H:MM:SS. */
function formatTimestamp(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}