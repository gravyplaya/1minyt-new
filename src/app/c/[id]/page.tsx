import { notFound } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { getChannel, listFolders, listTags } from '@/lib/repo';
import { listVideosByChannel } from '@/lib/video-repo';
import { listChannelPlaylists } from '@/lib/playlist-repo';
import { HeaderBar } from '../../_components/HeaderBar';
import { ChannelEditor } from '../../_components/ChannelEditor';
import { VideosPanel } from '../../_components/VideosPanel';
import { ChannelCatalogSearch } from '../../_components/ChannelCatalogSearch';
import { ChannelPlaylists } from '../../_components/ChannelPlaylists';
import { MostReferencedSection } from '../../_components/MostReferencedSection';
import { ExportButton } from '../../_components/ExportButton';
import { formatCount, formatRelative, youtubeChannelUrl } from '../../_lib/format';
import { isConnected, getUserProfile } from '@/lib/tokens';

export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ id: string }>;
}

export default async function ChannelPage({ params }: Props) {
  const { id } = await params;
  const channel = await getChannel(id);
  if (!channel) notFound();

  const [folders, tags, connected, profile, videos, playlists] = await Promise.all([
    listFolders(),
    listTags(),
    isConnected(),
    getUserProfile(),
    listVideosByChannel(channel.channel_id, 30),
    listChannelPlaylists(channel.channel_id),
  ]);

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <HeaderBar connected={connected} profile={profile} />
      <main className="channel-detail-main" style={{ padding: '24px 32px', maxWidth: 1100, margin: '0 auto', width: '100%' }}>
        <div style={{ marginBottom: 14 }}>
          <Link href="/" style={{ color: '#8b8b94', fontSize: 13, textDecoration: 'none' }}>← Back to subscriptions</Link>
        </div>
        <header className="channel-header" style={{ display: 'flex', gap: 18, alignItems: 'flex-start', marginBottom: 28 }}>
          {channel.thumbnail_url ? (
            <Image
              src={channel.thumbnail_url}
              alt={channel.title}
              width={96}
              height={96}
              unoptimized
              className="channel-avatar"
              style={{ borderRadius: 48, objectFit: 'cover', background: '#1f1f26' }}
            />
          ) : (
            <div className="channel-avatar" style={{ width: 96, height: 96, borderRadius: 48, background: '#1f1f26', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#5a5a64', fontSize: 32, fontWeight: 700 }}>
              {channel.title[0]?.toUpperCase() ?? '?'}
            </div>
          )}
          <div className="channel-header-info" style={{ flex: 1, minWidth: 0 }}>
            <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 10 }}>
              {channel.title}
              {channel.music_flag === 1 && <span className="chip chip-music">🎵 music</span>}
              {channel.hidden === 1 && <span className="chip">hidden</span>}
            </h1>
            <div className="channel-header-meta" style={{ color: '#8b8b94', fontSize: 13, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              {channel.handle && <span>{channel.handle}</span>}
              {channel.custom_url && <span>{channel.custom_url}</span>}
              {channel.country && <span>{channel.country}</span>}
              <a href={youtubeChannelUrl(channel.channel_id, channel.custom_url)} target="_blank" rel="noopener noreferrer" style={{ color: '#5b9eff' }}>
                Open on YouTube ↗
              </a>
            </div>
            <div style={{ color: '#8b8b94', fontSize: 13, marginTop: 8 }}>
              {formatCount(channel.subscriber_count)} subscribers · {formatCount(channel.video_count)} videos · subscribed {formatRelative(channel.subscribed_at)}
            </div>
            {channel.description && (
              <p style={{ marginTop: 10, color: '#c2c2cb', fontSize: 13, lineHeight: 1.5, whiteSpace: 'pre-wrap', maxWidth: 720 }}>
                {channel.description}
              </p>
            )}
          </div>
        </header>

        <ChannelEditor channel={channel} folders={folders} tags={tags} />

        {connected && <ChannelCatalogSearch channelId={channel.channel_id} />}

        <ChannelPlaylists channelId={channel.channel_id} initialPlaylists={playlists} connected={connected} />

        <MostReferencedSection />

        <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 12 }}>
          <ExportButton channelId={channel.channel_id} summaryCount={videos.filter(v => v.summary).length} />
        </div>

        <VideosPanel channelId={channel.channel_id} initialVideos={videos} connected={connected} />
      </main>
    </div>
  );
}