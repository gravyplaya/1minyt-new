'use client';

import { useState, useTransition } from 'react';
import Image from 'next/image';
import type { PlaylistRow } from '@/lib/types';
import { fetchChannelPlaylistsAction } from '@/app/actions';
import { formatCount, formatRelative } from '../_lib/format';

/**
 * TAV-26: Curated channel playlists panel.
 *
 * Lives on the channel detail page. On first load it renders whatever playlists
 * are already cached for the channel (fetched by a prior "Fetch playlists"
 * click). A button fetches the channel's public playlists via `playlists.list`
 * and refreshes the list. Each playlist links to its own detail page where the
 * user can browse the videos and summarize the whole collection.
 */
export function ChannelPlaylists({
  channelId,
  initialPlaylists,
  connected,
}: {
  channelId: string;
  initialPlaylists: PlaylistRow[];
  connected: boolean;
}) {
  const [playlists, setPlaylists] = useState<PlaylistRow[]>(initialPlaylists);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const fetchPlaylists = () => {
    setError(null);
    start(async () => {
      const r = await fetchChannelPlaylistsAction(channelId);
      if (!r.ok) {
        setError(r.error ?? 'Failed to fetch playlists.');
        return;
      }
      setPlaylists(r.playlists);
    });
  };

  if (!connected) return null;

  return (
    <section id="playlists" style={{ marginTop: 28, scrollMarginTop: 80 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 4, gap: 12, flexWrap: 'wrap' }}>
        <h2 style={{ fontSize: 16, fontWeight: 600 }}>
          Curated playlists
          <span style={{ color: '#5a5a64', fontSize: 13, fontWeight: 400, marginLeft: 8 }}>
            the creator&rsquo;s own &ldquo;start here&rdquo; collections
          </span>
        </h2>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={fetchPlaylists}
          disabled={pending}
          style={{ fontSize: 12, padding: '6px 12px' }}
        >
          {pending ? 'Fetching…' : playlists.length === 0 ? 'Fetch playlists' : '↻ Refresh'}
        </button>
      </div>
      <p style={{ color: '#8b8b94', fontSize: 12, marginBottom: 12, maxWidth: 640 }}>
        Channel-curated playlists are the creator&rsquo;s recommended entry point — far better than recency-sorted uploads. Fetch them here, then open a playlist to browse its videos and summarize the whole collection.
      </p>

      {error && (
        <div style={{ color: '#ff6363', fontSize: 13, marginBottom: 16 }}>{error}</div>
      )}

      {pending && playlists.length === 0 && (
        <div style={{ color: '#8b8b94', fontSize: 13 }}>Fetching channel playlists from YouTube…</div>
      )}

      {!pending && playlists.length === 0 && !error && (
        <div style={{ color: '#5a5a64', fontSize: 13 }}>
          No playlists cached yet. Click &ldquo;Fetch playlists&rdquo; to pull this channel&rsquo;s public collections.
        </div>
      )}

      {playlists.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 12 }}>
          {playlists.map(p => (
            <PlaylistCard key={p.playlist_id} playlist={p} channelId={channelId} />
          ))}
        </div>
      )}
    </section>
  );
}

function PlaylistCard({ playlist, channelId }: { playlist: PlaylistRow; channelId: string }) {
  return (
    <a
      href={`/c/${channelId}/playlists/${playlist.playlist_id}`}
      style={{
        display: 'block',
        background: '#15151a',
        border: '1px solid #2a2a33',
        borderRadius: 10,
        overflow: 'hidden',
        textDecoration: 'none',
        color: 'inherit',
        transition: 'border-color .15s',
      }}
    >
      {playlist.thumbnail_url ? (
        <Image
          src={playlist.thumbnail_url}
          alt={playlist.title}
          width={240}
          height={135}
          unoptimized
          style={{ width: '100%', height: 120, objectFit: 'cover', background: '#1f1f26' }}
        />
      ) : (
        <div style={{ width: '100%', height: 120, background: '#1f1f26', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#5a5a64', fontSize: 28 }}>
          📚
        </div>
      )}
      <div style={{ padding: '10px 12px' }}>
        <div style={{ color: '#e7e7ea', fontSize: 13, fontWeight: 600, lineHeight: 1.3, marginBottom: 4, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
          {playlist.title}
        </div>
        <div style={{ color: '#8b8b94', fontSize: 11, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <span>{formatCount(playlist.item_count)} videos</span>
          {playlist.published_at && <span>· {formatRelative(playlist.published_at)}</span>}
        </div>
      </div>
    </a>
  );
}


