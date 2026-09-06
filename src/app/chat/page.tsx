import { AppShell } from '../_components/AppShell';
import { LibraryChatPanel } from '../_components/LibraryChatPanel';
import { isConnected, getUserProfile } from '@/lib/tokens';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: '1minyt — Chat with your library',
  description: 'Ask questions across every indexed video, scoped to folders, tags, or channels.',
};

export default async function ChatPage() {
  const [connected, profile] = await Promise.all([isConnected(), getUserProfile()]);

  return (
    <AppShell tab="library" libraryActive="chat" connected={connected} profile={profile} mainStyle={{ maxWidth: 900, margin: '0 auto', width: '100%' }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 4 }}>💬 Chat with your library</h1>
      <p style={{ color: '#8b8b94', fontSize: 13, marginBottom: 24 }}>
        Ask anything across every indexed video. Answers are grounded in transcripts and summaries, with citations
        that link to the exact moment in the source video. Scope the conversation to a folder, tag, or channel —
        or turn on Deep Research to let the agent search for itself.
      </p>

      <LibraryChatPanel />
    </AppShell>
  );
}
