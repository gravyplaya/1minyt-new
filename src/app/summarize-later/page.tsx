import Link from 'next/link';
import { HeaderBar } from '../_components/HeaderBar';
import { SummarizeLaterQueue } from '../_components/SummarizeLaterQueue';
import { listQueueItems } from '@/lib/summarize-queue';
import { isConnected, getUserProfile } from '@/lib/tokens';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: '1minyt — Summarize Later',
  description: 'Your Summarize Later queue — batch-summarize videos you saved for later.',
};

export default async function SummarizeLaterPage() {
  const [connected, profile, items] = await Promise.all([
    isConnected(),
    getUserProfile(),
    listQueueItems(),
  ]);

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <HeaderBar connected={connected} profile={profile} />
      <main style={{ padding: '24px 32px', maxWidth: 900, margin: '0 auto', width: '100%' }}>
        <div style={{ marginBottom: 14 }}>
          <Link href="/" style={{ color: '#8b8b94', fontSize: 13, textDecoration: 'none' }}>← Back to subscriptions</Link>
        </div>

        <div style={{ marginBottom: 20 }}>
          <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 4 }}>🔖 Summarize Later</h1>
          <p style={{ color: '#8b8b94', fontSize: 13, maxWidth: 600 }}>
            A Pocket-style queue for videos you want summarized later. Queue them from any video
            row, then hit <strong>Summarize all</strong> to batch-generate TL;DRs in one go.
          </p>
        </div>

        <SummarizeLaterQueue items={items} />
      </main>
    </div>
  );
}
