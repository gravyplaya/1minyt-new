/**
 * Map raw backend/LLM errors to short, human-friendly messages for the UI.
 *
 * Today this mainly targets OpenRouter 429s — the free-tier pool is shared and
 * intermittently rate-limited, surfacing as a scary JSON blob. We collapse that
 * to a calm retry prompt. Unknown errors pass through unchanged (minus the
 * stack noise) so genuine failures stay diagnosable.
 */

const FRIENDLY_RATE_LIMIT = 'Server busy. Please try again.';

/**
 * Patterns that identify a transient rate-limit / overload response. We match
 * loosely on substrings so this survives minor wording changes upstream.
 */
const RATE_LIMIT_SIGNALS = [
  '429',
  'rate_limit_exceeded',
  'rate-limited',
  'rate limited',
  'temporarily rate-limited',
  'too many requests',
  'overloaded',
  'capacity',
] as const;

export function friendlyError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);

  // OpenRouter wraps the provider detail in the message body; check the whole
  // string (lowercased) for any rate-limit signal.
  const lower = raw.toLowerCase();
  if (RATE_LIMIT_SIGNALS.some((sig) => lower.includes(sig))) {
    return FRIENDLY_RATE_LIMIT;
  }

  return raw;
}
