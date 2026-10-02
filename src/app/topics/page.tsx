import { AppShell } from '../_components/AppShell';
import { PageHead } from '../_components/PageHead';
import { TopicGraphView } from '../_components/TopicGraphView';
import { buildTopicGraph } from '@/lib/topics';
import { resolvePageUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: '1minyt — Topic mind map',
  description: 'A mind map of topics and ideas across your summarized videos.',
};

export default async function TopicsPage() {
  const { user, connected } = await resolvePageUser();
  const graph = connected && user
    ? await buildTopicGraph(user.id).catch(() => ({ nodes: [], edges: [], summarizedVideos: 0, generatedAt: 0 }))
    : { nodes: [], edges: [], summarizedVideos: 0, generatedAt: 0 };

  return (
    <AppShell tab="library" libraryActive="topics" connected={connected} userId={user?.id ?? null} profile={user} mainStyle={{ maxWidth: 1100, margin: '0 auto', width: '100%' }}>
      <PageHead
        kicker="The graph"
        title={<>Topic <span className="grad-text">mind map</span></>}
        sub="Topics and ideas extracted from your video summaries, clustered by how often they appear together. Bigger nodes cover more videos; edges connect topics that share videos. Click a node to see its videos."
      />

      <TopicGraphView graph={graph} />
    </AppShell>
  );
}
