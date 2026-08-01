import { notFound } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { getChannel } from '@/lib/repo';
import { getPlaylist, listPlaylistVideos, getPlaylistSummary } from '@/lib/playlist-repo';
import { HeaderBar } from '../../../../_components/HeaderBar';
import { PlaylistSummaryPanel } from '../../../../_components/PlaylistSummaryPanel';
import { PlaylistVideosPanel } from '../../../../_components/PlaylistVideosPanel';
import { formatCount, formatRelative, youtubePlaylistUrl } from '../../../../_lib/format';
import { isConnected, getUserProfile } from '@/lib/tokens';

export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ id: string; playlistId: string }>;
}

export default async function PlaylistDetailPage({ params }: Props) {
  const { id: channelId, playlistId } = await params;

  const [channel, playlist, connected, profile] = await Promise.all([
    getChannel(channelId),
    getPlaylist(playlistId),
    isConnected(),
    getUserProfile(),
  ]);

  // The channel must exist; the playlist may not be cached yet.
  if (!channel) notFound();

  // If the playlist isn't cached (or its channel_id doesn't match this route),
  // show a "not fetched yet" state instead of a 404 — the user may have
  // navigated here before fetching playlists from the channel page.
  const playlistBelongsToChannel = playlist?.channel_id === channelId;

  // Fetch videos + summary only when the playlist is cached and belongs here.
  const videos = playlistBelongsToChannel ? await listPlaylistVideos(playlistId) : [];
  const summary = playlistBelongsToChannel ? await getPlaylistSummary(playlistId) : null;

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <HeaderBar connected={connected} profile={profile} />
      <main style={{ padding: '24px 32px', maxWidth: 1100, margin: '0 auto', width: '100%' }}>
        <div style={{ marginBottom: 14, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <Link href={`/c/${channelId}`} style={{ color: '#8b8b94', fontSize: 13, textDecoration: 'none' }}>← Back to {channel.title}</Link>
        </div>

        {!playlist || !playlistBelongsToChannel ? (
          <div style={{ maxWidth: 480, margin: '40px auto', textAlign: 'center' }}>
            <div style={{ fontSize: 28, marginBottom: 8 }}>📚</div>
            <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 6 }}>Playlist not cached yet</h2>
            <p style={{ color: '#8b8b94', fontSize: 13, lineHeight: 1.5 }}>
              This playlist hasn&rsquo;t been fetched from YouTube yet. Go back to the channel page and click &ldquo;Fetch playlists&rdquo; to load this channel&rsquo;s curated collections.
            </p>
            <Link href={`/c/${channelId}#playlists`} style={{ color: '#5b9eff', fontSize: 13 }}>
              Go to channel playlists →
            </Link>
          </div>
        ) : (
          <>
            <header style={{ display: 'flex', gap: 18, alignItems: 'flex-start', marginBottom: 24 }}>
              {playlist.thumbnail_url ? (
                <Image
                  src={playlist.thumbnail_url}
                  alt={playlist.title}
                  width={160}
                  height={90}
                  unoptimized
                  style={{ borderRadius: 8, objectFit: 'cover', background: '#1f1f26' }}
                />
              ) : (
                <div style={{ width: 160, height: 90, borderRadius: 8, background: '#1f1f26', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#5a5a64', fontSize: 32 }}>
                  📚
                </div>
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 6 }}>{playlist.title}</h1>
                <div style={{ color: '#8b8b94', fontSize: 13, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                  <Link href={`/c/${channelId}`} style={{ color: '#c2c2cb', textDecoration: 'none' }}>
                    {playlist.channel_title}
                  </Link>
                  <span>{formatCount(playlist.item_count)} videos</span>
                  {playlist.published_at && <span>created {formatRelative(playlist.published_at)}</span>}
                  <a href={youtubePlaylistUrl(playlist.playlist_id)} target="_blank" rel="noopener noreferrer" style={{ color: '#5b9eff' }}>
                    Open on YouTube ↗
                  </a>
                </div>
                {playlist.description && (
                  <p style={{ marginTop: 10, color: '#c2c2cb', fontSize: 13, lineHeight: 1.5, whiteSpace: 'pre-wrap', maxWidth: 720 }}>
                    {playlist.description}
                  </p>
                )}
              </div>
            </header>

            <PlaylistSummaryPanel
              playlistId={playlistId}
              summary={summary}
              videos={videos}
            />

            <PlaylistVideosPanel
              playlistId={playlistId}
              initialVideos={videos}
              connected={connected}
            />
          </>
        )}
      </main>
    </div>
  );
}
