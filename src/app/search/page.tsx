import { AppShell } from '../_components/AppShell';
import { TranscriptSearchForm } from '../_components/TranscriptSearchForm';
import { isConnected, getUserProfile } from '@/lib/tokens';

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
  const [connected, profile] = await Promise.all([isConnected(), getUserProfile()]);

  return (
    <AppShell tab="search" connected={connected} profile={profile} mainStyle={{ maxWidth: 1000, margin: '0 auto', width: '100%' }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 4 }}>🔍 Search transcripts</h1>
      <p style={{ color: '#8b8b94', fontSize: 13, marginBottom: 24 }}>
        Search across every indexed transcript in your library. Results are ranked by relevance and link straight to the moment in the video.
      </p>

      <TranscriptSearchForm initialQuery={initialQuery} />
    </AppShell>
  );
}
