/**
 * TAV-68: Extract a YouTube video id from a URL (or bare id).
 *
 * Simplified mirror of the app's src/lib/youtube-url.ts (TAV-67) — the
 * extension is a separate package and can't import server code. Covers the
 * forms a "save this" target can take: watch?v=, youtu.be/<id>, /shorts/<id>,
 * /embed/<id>, /live/<id>, /v/<id> on any youtube.com host, plus a bare
 * 11-character id. Everything else (channels, playlists, foreign URLs)
 * returns null so callers can ignore the click.
 */

const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;

export function parseVideoId(input: string): string | null {
  const raw = input.trim();
  if (!raw) return null;
  if (VIDEO_ID_RE.test(raw)) return raw;

  let url: URL;
  try {
    url = new URL(raw.includes('://') ? raw : `https://${raw}`);
  } catch {
    return null;
  }

  const host = url.hostname.replace(/^www\./, '').toLowerCase();

  if (host === 'youtu.be') {
    const id = url.pathname.split('/').filter(Boolean)[0] ?? '';
    return VIDEO_ID_RE.test(id) ? id : null;
  }

  const isYouTubeHost =
    host === 'youtube.com' ||
    host === 'm.youtube.com' ||
    host === 'music.youtube.com' ||
    host === 'youtube-nocookie.com';
  if (!isYouTubeHost) return null;

  // watch?v=<id> — works on every youtube.com host; checked before paths.
  const v = url.searchParams.get('v');
  if (v && VIDEO_ID_RE.test(v)) return v;

  const parts = url.pathname.split('/').filter(Boolean);
  if (parts.length >= 2 && (parts[0] === 'shorts' || parts[0] === 'embed' || parts[0] === 'live' || parts[0] === 'v')) {
    const id = parts[1];
    return VIDEO_ID_RE.test(id) ? id : null;
  }

  return null;
}

/** Video id of the current youtube.com page (watch or shorts), or null. */
export function currentVideoId(): string | null {
  const url = new URL(location.href);
  const v = url.searchParams.get('v');
  if (v && VIDEO_ID_RE.test(v)) return v;
  const parts = url.pathname.split('/').filter(Boolean);
  if (parts.length >= 2 && (parts[0] === 'shorts' || parts[0] === 'live')) {
    const id = parts[1];
    return VIDEO_ID_RE.test(id) ? id : null;
  }
  return null;
}
