/**
 * Format helpers used in multiple places. Kept tiny.
 */

export function formatCount(n: number | null | undefined): string {
  if (n == null) return '—';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}K`;
  return String(n);
}

export function formatDate(unixSeconds: number | null | undefined): string {
  if (!unixSeconds) return '—';
  return new Date(unixSeconds * 1000).toISOString().slice(0, 10);
}

export function formatRelative(unixSeconds: number | null | undefined): string {
  if (!unixSeconds) return '—';
  const diff = Math.floor(Date.now() / 1000) - unixSeconds;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 86400 * 30) return `${Math.floor(diff / 86400)}d ago`;
  if (diff < 86400 * 365) return `${Math.floor(diff / (86400 * 30))}mo ago`;
  return `${Math.floor(diff / (86400 * 365))}y ago`;
}

export function youtubeChannelUrl(channelId: string, customUrl?: string | null): string {
  if (customUrl) {
    const handle = customUrl.startsWith('@') ? customUrl : `@${customUrl}`;
    return `https://www.youtube.com/${handle}`;
  }
  return `https://www.youtube.com/channel/${channelId}`;
}

export function youtubeVideoUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${videoId}`;
}

/** YouTube watch URL jumping to a specific timestamp (seconds). */
export function youtubeVideoUrlAt(videoId: string, startSeconds: number): string {
  return `https://www.youtube.com/watch?v=${videoId}&t=${startSeconds}s`;
}

/** YouTube playlist URL (`https://www.youtube.com/playlist?list=PL...`). */
export function youtubePlaylistUrl(playlistId: string): string {
  return `https://www.youtube.com/playlist?list=${playlistId}`;
}

/** Format seconds as M:SS or H:MM:SS. Shared between WatchQueue and MusicQueue. */
export function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0)
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** Parse an ISO-8601 duration like "PT1H2M3S" into seconds. Returns null on failure. */
export function parseIso8601Duration(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const m = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso);
  if (!m) return null;
  const hours = Number(m[1] ?? 0);
  const minutes = Number(m[2] ?? 0);
  const seconds = Number(m[3] ?? 0);
  return hours * 3600 + minutes * 60 + seconds;
}