import { AppShell } from '../_components/AppShell';
import { TopicGraphView } from '../_components/TopicGraphView';
import { buildTopicGraph } from '@/lib/topics';
import { isConnected, getUserProfile } from '@/lib/tokens';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: '1minyt — Topic mind map',
  description: 'A mind map of topics and ideas across your summarized videos.',
};

export default async function TopicsPage() {
  const [connected, profile, graph] = await Promise.all([
    isConnected(),
    getUserProfile(),
    buildTopicGraph().catch(() => ({ nodes: [], edges: [], summarizedVideos: 0, generatedAt: 0 })),
  ]);

  return (
    <AppShell tab="library" libraryActive="topics" connected={connected} profile={profile} mainStyle={{ maxWidth: 1100, margin: '0 auto', width: '100%' }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 4 }}>🕸 Topic mind map</h1>
      <p style={{ color: '#8b8b94', fontSize: 13, marginBottom: 20 }}>
        Topics and ideas extracted from your video summaries, clustered by how often they appear together.
        Bigger nodes cover more videos; edges connect topics that share videos. Click a node to see its videos.
      </p>

      <TopicGraphView graph={graph} />
    </AppShell>
  );
}
