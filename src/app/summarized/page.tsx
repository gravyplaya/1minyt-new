import { AppShell } from '../_components/AppShell';
import { SummarizedVideoList } from '../_components/SummarizedVideoList';
import { listSummarizedVideos } from '@/lib/video-repo';
import { isConnected, getUserProfile } from '@/lib/tokens';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: '1minyt — Summarized videos',
  description: 'Every video you have summarized, most recent first.',
};

export default async function SummarizedPage() {
  const [connected, profile, items] = await Promise.all([
    isConnected(),
    getUserProfile(),
    listSummarizedVideos(),
  ]);

  return (
    <AppShell tab="library" libraryActive="summarized" connected={connected} profile={profile} mainStyle={{ maxWidth: 'none', width: '100%' }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 4 }}>✦ Summarized videos</h1>
      <p style={{ color: '#8b8b94', fontSize: 13, marginBottom: 24 }}>
        Every video with a cached summary, sorted by most recently summarized.
      </p>

      {items.length === 0 ? (
        <div
          style={{
            marginTop: 48,
            padding: 32,
            textAlign: 'center',
            color: '#8b8b94',
            fontSize: 14,
            border: '1px dashed #2a2a33',
            borderRadius: 12,
            background: '#15151a',
          }}
        >
          <div style={{ fontSize: 32, marginBottom: 8 }}>✦</div>
          <div>No summaries yet — open any channel and tap ⚡ Summarize on a video to generate one.</div>
        </div>
      ) : (
        <SummarizedVideoList items={items.map(item => ({ video: item.video, musicFlag: item.musicFlag }))} />
      )}
    </AppShell>
  );
}
