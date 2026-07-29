'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { triggerSyncAction } from '@/app/actions';

export function SyncButton({ lastSync }: { lastSync: number | null }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  const ago = lastSync ? humanAgo(lastSync) : 'never';

  const onClick = () => {
    start(async () => {
      await triggerSyncAction();
      router.refresh();
    });
  };

  return (
    <button className="btn btn-primary" onClick={onClick} disabled={pending} title="Fetch subscriptions from YouTube">
      {pending ? 'Syncing…' : 'Sync now'}
      <span style={{ marginLeft: 6, fontSize: 11, opacity: 0.7, fontWeight: 400 }}>last: {ago}</span>
    </button>
  );
}

function humanAgo(unixSeconds: number): string {
  const diff = Math.floor(Date.now() / 1000) - unixSeconds;
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}