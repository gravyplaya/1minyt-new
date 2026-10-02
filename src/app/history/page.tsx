import { listPlayHistory } from '@/lib/video-repo';
import { AppShell } from '../_components/AppShell';
import { PageHead } from '../_components/PageHead';
import { resolvePageUser } from '@/lib/auth';
import { VideoSummaryRow } from '../_components/VideoSummaryRow';

export const dynamic = 'force-dynamic';

export default async function HistoryPage() {
  const { user, connected } = await resolvePageUser();
  const videos = connected && user ? await listPlayHistory(user.id) : [];
  return (
    <AppShell tab="library" libraryActive="history" connected={connected} userId={user?.id ?? null} profile={user} mainStyle={{ maxWidth: 'none', width: '100%' }}>
      <PageHead
        kicker="Your collection"
        title={<>Play <span className="grad-text">history</span></>}
        sub="Videos you have watched inside 1minyt, most recent first. Playback is recorded automatically as you watch — YouTube does not expose a watch-history list, so this only contains sessions inside the in-app player."
      />
      {videos.length === 0 ? <p style={{ color: '#8b8b94' }}>Your play history is empty.</p> : <div style={{ display: 'grid', gap: 12 }}>{videos.map(video => <VideoSummaryRow key={video.video_id} video={video} channelId={video.channel_id} />)}</div>}
    </AppShell>
  );
}
