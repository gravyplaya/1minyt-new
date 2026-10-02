import { listLikedVideos } from '@/lib/video-repo';
import { AppShell } from '../_components/AppShell';
import { PageHead } from '../_components/PageHead';
import { resolvePageUser } from '@/lib/auth';
import { VideoSummaryRow } from '../_components/VideoSummaryRow';

export const dynamic = 'force-dynamic';

export default async function LikesPage() {
  const { user, connected } = await resolvePageUser();
  const videos = connected && user ? await listLikedVideos(user.id) : [];
  return (
    <AppShell tab="library" libraryActive="liked" connected={connected} userId={user?.id ?? null} profile={user} mainStyle={{ maxWidth: 'none', width: '100%' }}>
      <PageHead
        kicker="Your collection"
        title={<>Liked <span className="grad-text">videos</span></>}
        sub="Videos you liked on YouTube, pulled in by Sync. New likes appear here after the next sync run."
      />
      {videos.length === 0 ? <p style={{ color: '#8b8b94' }}>No liked videos yet.</p> : <div style={{ display: 'grid', gap: 12 }}>{videos.map(video => <VideoSummaryRow key={video.video_id} video={video} channelId={video.channel_id} />)}</div>}
    </AppShell>
  );
}
