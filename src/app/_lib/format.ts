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