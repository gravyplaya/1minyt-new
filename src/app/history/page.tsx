import { listPlayHistory } from '@/lib/video-repo';
import { AppShell } from '../_components/AppShell';
import { isConnected, getUserProfile } from '@/lib/tokens';
import { VideoSummaryRow } from '../_components/VideoSummaryRow';

export const dynamic = 'force-dynamic';

export default async function HistoryPage() {
  const [connected, profile, videos] = await Promise.all([isConnected(), getUserProfile(), listPlayHistory()]);
  return (
    <AppShell tab="library" libraryActive="history" connected={connected} profile={profile} mainStyle={{ maxWidth: 'none', width: '100%' }}>
      <h1 style={{ margin: '0 0 8px', fontSize: 28 }}>Play history</h1>
      <p style={{ color: '#8b8b94', marginBottom: 24 }}>Videos you have watched inside 1minyt, most recent first. Playback is recorded automatically as you watch — YouTube does not expose a watch-history list, so this only contains sessions inside the in-app player.</p>
      {videos.length === 0 ? <p style={{ color: '#8b8b94' }}>Your play history is empty.</p> : <div style={{ display: 'grid', gap: 12 }}>{videos.map(video => <VideoSummaryRow key={video.video_id} video={video} channelId={video.channel_id} />)}</div>}
    </AppShell>
  );
}
