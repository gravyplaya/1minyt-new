import { AppShell } from '../_components/AppShell';
import { PageHead } from '../_components/PageHead';
import { SummarizeLaterQueue } from '../_components/SummarizeLaterQueue';
import { listQueueItems } from '@/lib/summarize-queue';
import { resolvePageUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: '1minyt — Summarize Later',
  description: 'Your Summarize Later queue — batch-summarize videos you saved for later.',
};

export default async function SummarizeLaterPage() {
  const { user, connected } = await resolvePageUser();
  const items = connected && user ? await listQueueItems(user.id) : [];

  return (
    <AppShell tab="library" libraryActive="summarize-later" connected={connected} userId={user?.id ?? null} profile={user} mainStyle={{ maxWidth: 'none', width: '100%' }}>
      <PageHead
        kicker="Your collection"
        title={<>Summarize <span className="grad-text">Later</span></>}
        sub={<>A Pocket-style queue for videos you want summarized later. Queue them from any video row, then hit <strong>Summarize all</strong> to batch-generate TL;DRs in one go.</>}
        actions={<span className="count-pill">{items.length} queued</span>}
      />

      <SummarizeLaterQueue items={items} />
    </AppShell>
  );
}
