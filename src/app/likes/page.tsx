import { listLikedVideos } from '@/lib/video-repo';
import { AppShell } from '../_components/AppShell';
import { isConnected, getUserProfile } from '@/lib/tokens';
import { VideoSummaryRow } from '../_components/VideoSummaryRow';

export const dynamic = 'force-dynamic';

export default async function LikesPage() {
  const [connected, profile, videos] = await Promise.all([isConnected(), getUserProfile(), listLikedVideos()]);
  return (
    <AppShell tab="library" libraryActive="liked" connected={connected} profile={profile} mainStyle={{ maxWidth: 'none', width: '100%' }}>
      <h1 style={{ margin: '0 0 8px', fontSize: 28 }}>Liked videos</h1>
      <p style={{ color: '#8b8b94', marginBottom: 24 }}>Videos you liked on YouTube, pulled in by Sync. New likes appear here after the next sync run.</p>
      {videos.length === 0 ? <p style={{ color: '#8b8b94' }}>No liked videos yet.</p> : <div style={{ display: 'grid', gap: 12 }}>{videos.map(video => <VideoSummaryRow key={video.video_id} video={video} channelId={video.channel_id} />)}</div>}
    </AppShell>
  );
}
