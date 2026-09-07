/**
 * TAV-67: Parse a pasted YouTube URL (or bare video ID) into its video id.
 *
 * Pure module — no I/O, safe to call anywhere. The paste flow fails fast on
 * non-video URLs (channels, playlists) with a specific reason so the UI can
 * tell the user *what* they pasted instead of a generic "invalid URL".
 * v1 accepts single videos only:
 *   watch?v=, youtu.be/<id>, /shorts/<id>, /embed/<id>, /live/<id>, /v/<id>
 * on any youtube.com host (www., m., music., -nocookie), plus a bare
 * 11-character video ID. Playlist/channel/handle URLs are recognized as
 * such so they get a "not supported yet" message.
 */

const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;

export type ParsedYouTubeUrl =
  | { kind: 'video'; videoId: string }
  | { kind: 'playlist' }
  | { kind: 'channel' }
  | { kind: 'unrecognized' };

export function parseYouTubeUrl(input: string): ParsedYouTubeUrl {
  const raw = input.trim();
  if (!raw) return { kind: 'unrecognized' };

  // A bare 11-character video ID pasted directly.
  if (VIDEO_ID_RE.test(raw)) return { kind: 'video', videoId: raw };

  // Tolerate pastes without a protocol ("youtu.be/xyz", "youtube.com/watch?v=…").
  let url: URL;
  try {
    url = new URL(raw.includes('://') ? raw : `https://${raw}`);
  } catch {
    return { kind: 'unrecognized' };
  }

  const host = url.hostname.replace(/^www\./, '').toLowerCase();

  // youtu.be/<id> — the share-shortlink form.
  if (host === 'youtu.be') {
    const id = url.pathname.split('/').filter(Boolean)[0] ?? '';
    return VIDEO_ID_RE.test(id) ? { kind: 'video', videoId: id } : { kind: 'unrecognized' };
  }

  const isYouTubeHost =
    host === 'youtube.com' ||
    host === 'm.youtube.com' ||
    host === 'music.youtube.com' ||
    host === 'youtube-nocookie.com';
  if (!isYouTubeHost) return { kind: 'unrecognized' };

  // watch?v=<id> — works on every youtube.com host (including music.).
  // Checked before the playlist branch so watch URLs that also carry a
  // list= param still resolve to the video.
  const v = url.searchParams.get('v');
  if (v && VIDEO_ID_RE.test(v)) return { kind: 'video', videoId: v };

  const parts = url.pathname.split('/').filter(Boolean);

  // /shorts/<id>, /embed/<id>, /live/<id>, /v/<id>
  if (
    parts.length >= 2 &&
    (parts[0] === 'shorts' || parts[0] === 'embed' || parts[0] === 'live' || parts[0] === 'v')
  ) {
    const id = parts[1];
    return VIDEO_ID_RE.test(id) ? { kind: 'video', videoId: id } : { kind: 'unrecognized' };
  }

  // /playlist?list=… (a bare watch?v-less URL with list= is a playlist view too)
  if (parts[0] === 'playlist' || url.searchParams.get('list')) return { kind: 'playlist' };

  // /@handle, /channel/UC…, /c/name
  if (parts[0] === 'channel' || parts[0] === 'c' || (parts[0]?.startsWith('@') ?? false)) {
    return { kind: 'channel' };
  }

  return { kind: 'unrecognized' };
}
