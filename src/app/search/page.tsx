import { AppShell } from '../_components/AppShell';
import { PageHead } from '../_components/PageHead';
import { TranscriptSearchForm } from '../_components/TranscriptSearchForm';
import { resolvePageUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: '1minyt — Search transcripts',
  description: 'Search across all your indexed video transcripts.',
};

interface PageProps {
  searchParams: Promise<{ q?: string }>;
}

export default async function SearchPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const initialQuery = params.q ?? '';
  const { user, connected } = await resolvePageUser();

  return (
    <AppShell tab="search" connected={connected} userId={user?.id ?? null} profile={user} mainStyle={{ maxWidth: 1000, margin: '0 auto', width: '100%' }}>
      <PageHead
        kicker="Across every transcript"
        title={<>Search your <span className="grad-text">whole library</span></>}
        sub={<>Search across every indexed transcript in your library. Results are ranked by relevance and link straight to the moment in the video. Prefer a conversation? <a href="/chat" style={{ color: '#5cd9a3' }}>Chat with your library →</a></>}
      />

      <TranscriptSearchForm initialQuery={initialQuery} />
    </AppShell>
  );
}
