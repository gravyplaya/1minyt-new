import { AppShell } from '../_components/AppShell';
import { PageHead } from '../_components/PageHead';
import { LibraryChatPanel } from '../_components/LibraryChatPanel';
import { resolvePageUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: '1minyt — Chat with your library',
  description: 'Ask questions across every indexed video, scoped to folders, tags, or channels.',
};

export default async function ChatPage() {
  const { user, connected } = await resolvePageUser();

  return (
    <AppShell tab="library" libraryActive="chat" connected={connected} userId={user?.id ?? null} profile={user} mainStyle={{ maxWidth: 900, margin: '0 auto', width: '100%' }}>
      <PageHead
        kicker="Library chat"
        title={<>Ask your <span className="grad-text">library</span></>}
        sub={<>Ask anything across every indexed video. Answers are grounded in transcripts and summaries, with citations that link to the exact moment in the source video. Scope the conversation to a folder, tag, or channel — or turn on Deep Research to let the agent search for itself.</>}
      />

      <LibraryChatPanel />
    </AppShell>
  );
}
