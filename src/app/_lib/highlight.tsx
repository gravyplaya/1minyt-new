/**
 * Shared highlight + timestamp helpers for transcript search UI.
 *
 * Used by `ChannelCatalogSearch` and `TranscriptSearchForm` (and any future
 * search surface) so a bug in the highlight regex only has to be fixed once.
 */

/** Escape a string for safe use inside a RegExp. */
export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Highlight occurrences of the query terms in the matched text. We split on
 * word boundaries and wrap matches in a <mark> tag.
 */
export function HighlightedText({ text, query }: { text: string; query: string }) {
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

/** Format milliseconds as M:SS or H:MM:SS. */
export function formatTimestamp(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}
