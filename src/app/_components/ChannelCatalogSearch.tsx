'use client';

import { useState, useTransition } from 'react';
import Image from 'next/image';
import type { ChannelCatalogHit, TranscriptSearchResult } from '@/lib/types';
import { searchChannelCatalogAction, summarizeFromCatalogHitAction } from '@/app/actions';
import { formatRelative, youtubeVideoUrl, youtubeVideoUrlAt } from '../_lib/format';
import { HighlightedText, formatTimestamp } from '../_lib/highlight';

/**
 * TAV-25: Channel back-catalog search.
 *
 * A search bar that lives on the channel detail page. On submit it calls the
 * YouTube Data API `search.list` (via the server action) to search the
 * channel's *entire* upload history — not just the ~30 recent uploads we
 * cache locally. Results show title, thumbnail, published date, and a
 * relevance-ordered list. Each result has a "Summarize" affordance that
 * upserts the video row and runs the standard fetch-transcript + summarize
 * pipeline.
 *
 * Below the catalog hits we also surface transcript matches from the local
 * index (TAV-10), filtered to this channel — so the user can compare "what
 * this channel has published" against "what they actually said" in one view.
 */
export function ChannelCatalogSearch({ channelId }: { channelId: string }) {
  const [input, setInput] = useState('');
  const [pending, start] = useTransition();
  const [results, setResults] = useState<{ catalog: ChannelCatalogHit[]; transcripts: TranscriptSearchResult[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const q = input.trim();
    if (!q || pending) return;
    setError(null);
    setResults(null);
    start(async () => {
      const r = await searchChannelCatalogAction(channelId, q, null);
      if (!r.ok) {
        setError(r.error ?? 'Search failed.');
        return;
      }
      setResults({ catalog: r.catalog, transcripts: r.transcripts });
    });
  };

  return (
    <section id="catalog-search" style={{ marginTop: 28, scrollMarginTop: 80 }}>
      <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>
        Search back catalog
        <span style={{ color: '#5a5a64', fontSize: 13, fontWeight: 400, marginLeft: 8 }}>
          every video this channel has ever uploaded
        </span>
      </h2>
      <p style={{ color: '#8b8b94', fontSize: 12, marginBottom: 12, maxWidth: 640 }}>
        Searches YouTube&apos;s full upload history for this channel — including videos we haven&apos;t cached locally. Pair it with the transcript matches below to find both <em>what they published</em> and <em>what they said</em>.
      </p>

      <form onSubmit={submit} style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <input
          type="text"
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder="Search this channel’s back catalog — e.g. “Rust vs Go”"
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
          {pending ? 'Searching…' : '🔍 Search'}
        </button>
      </form>

      {pending && results === null && (
        <div style={{ color: '#8b8b94', fontSize: 13 }}>Searching YouTube’s back catalog…</div>
      )}

      {error && (
        <div style={{ color: '#ff6363', fontSize: 13, marginBottom: 16 }}>
          {error}
        </div>
      )}

      {results !== null && !pending && (
        <SearchResults
          catalog={results.catalog}
          transcripts={results.transcripts}
          channelId={channelId}
          query={input.trim()}
        />
      )}
    </section>
  );
}

function SearchResults({
  catalog,
  transcripts,
  channelId,
  query,
}: {
  catalog: ChannelCatalogHit[];
  transcripts: TranscriptSearchResult[];
  channelId: string;
  query: string;
}) {
  const hasCatalog = catalog.length > 0;
  const hasTranscripts = transcripts.length > 0;

  if (!hasCatalog && !hasTranscripts) {
    return (
      <div style={{ maxWidth: 480, margin: '24px auto', textAlign: 'center' }}>
        <div style={{ fontSize: 28, marginBottom: 8 }}>🔎</div>
        <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 6 }}>No matches found</h3>
        <p style={{ color: '#8b8b94', fontSize: 13, lineHeight: 1.5 }}>
          No back-catalog videos or indexed transcripts matched &ldquo;{query}&rdquo; for this channel.
        </p>
      </div>
    );
  }

  return (
    <div>
      {hasCatalog && (
        <div style={{ marginBottom: 28 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 10 }}>
            <h3 style={{ fontSize: 13, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#8b8b94' }}>
              Back catalog
            </h3>
            <span style={{ color: '#5a5a64', fontSize: 11 }}>
              {catalog.length} {catalog.length === 1 ? 'video' : 'videos'} from YouTube
            </span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {catalog.map(hit => (
              <CatalogHitCard key={hit.videoId} hit={hit} />
            ))}
          </div>
        </div>
      )}

      {hasTranscripts && (
        <div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 10 }}>
            <h3 style={{ fontSize: 13, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#8b8b94' }}>
              Transcript matches
            </h3>
            <span style={{ color: '#5a5a64', fontSize: 11 }}>
              {transcripts.length} {transcripts.length === 1 ? 'segment' : 'segments'} from indexed videos
            </span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {transcripts.map((r, i) => (
              <TranscriptMatchCard key={`${r.videoId}-${r.startMs}-${i}`} result={r} query={query} />
            ))}
          </div>
        </div>
      )}

      {!hasCatalog && hasTranscripts && (
        <p style={{ color: '#5a5a64', fontSize: 12, marginTop: 8 }}>
          No back-catalog hits — YouTube returned no matching videos for this channel. The transcript matches above are from videos you&apos;ve already indexed.
        </p>
      )}
    </div>
  );
}

function CatalogHitCard({ hit }: { hit: ChannelCatalogHit }) {
  const [pending, start] = useTransition();
  const [stage, setStage] = useState<'idle' | 'summarizing' | 'done' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);

  const summarize = () => {
    setError(null);
    setStage('summarizing');
    start(async () => {
      const outcome = await summarizeFromCatalogHitAction(hit);
      if (outcome.ok) {
        setStage('done');
      } else {
        setError(outcome.error ?? 'Summarization failed.');
        setStage('error');
      }
    });
  };

  return (
    <div
      style={{
        background: '#15151a',
        border: '1px solid #2a2a33',
        borderRadius: 10,
        padding: 12,
        display: 'grid',
        gridTemplateColumns: '120px 1fr',
        gap: 12,
        alignItems: 'flex-start',
      }}
    >
      {hit.thumbnailUrl ? (
        <Image
          src={hit.thumbnailUrl}
          alt={hit.title}
          width={120}
          height={68}
          unoptimized
          style={{ borderRadius: 6, objectFit: 'cover', background: '#1f1f26' }}
        />
      ) : (
        <div style={{ width: 120, height: 68, borderRadius: 6, background: '#1f1f26' }} />
      )}
      <div style={{ minWidth: 0 }}>
        <a
          href={youtubeVideoUrl(hit.videoId)}
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: '#e7e7ea', textDecoration: 'none', fontWeight: 600, fontSize: 14 }}
        >
          {hit.title}
        </a>
        <div style={{ color: '#8b8b94', fontSize: 12, marginTop: 4, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          {hit.publishedAt && <span>{formatRelative(hit.publishedAt)}</span>}
        </div>
        {hit.description && (
          <p style={{ color: '#a0a0a8', fontSize: 12, lineHeight: 1.5, margin: '8px 0 0', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
            {hit.description}
          </p>
        )}

        {stage === 'done' && (
          <div style={{ marginTop: 8, fontSize: 12, color: '#5cd9a3' }}>
            ✓ Summarized — <a href={`/c/${hit.channelId}#videos`} style={{ color: '#5b9eff' }}>view summary</a>
          </div>
        )}
        {stage === 'error' && (
          <div style={{ marginTop: 8, fontSize: 12, color: '#ff6363' }}>
            ⚠ {error}{' '}
            <button type="button" className="btn btn-ghost" onClick={summarize} disabled={pending} style={{ fontSize: 11, padding: '2px 8px' }}>
              Retry
            </button>
          </div>
        )}
        {stage !== 'done' && (
          <button
            type="button"
            className="btn btn-primary"
            onClick={summarize}
            disabled={pending}
            style={{ fontSize: 12, padding: '6px 12px', marginTop: 10 }}
          >
            {stage === 'summarizing' ? 'Summarizing…' : '⚡ Summarize'}
          </button>
        )}
      </div>
    </div>
  );
}

function TranscriptMatchCard({ result, query }: { result: TranscriptSearchResult; query: string }) {
  const seconds = Math.floor(result.startMs / 1000);
  const ytUrl = youtubeVideoUrlAt(result.videoId, seconds);
  return (
    <div
      style={{
        background: '#15151a',
        border: '1px solid #2a2a33',
        borderRadius: 10,
        padding: '12px 14px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
        <span style={{ color: '#e7e7ea', fontSize: 13, fontWeight: 500 }}>
          {result.videoTitle}
        </span>
      </div>
      <p style={{ color: '#c2c2cb', fontSize: 13, lineHeight: 1.5, margin: 0, marginBottom: 8 }}>
        <HighlightedText text={result.chunkText} query={query} />
      </p>
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
          ▶ {formatTimestamp(result.startMs)}
        </a>
        <span style={{ color: '#5a5a64', fontSize: 11 }}>
          relevance {(result.score * 100).toFixed(0)}%
        </span>
      </div>
    </div>
  );
}
