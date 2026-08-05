'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { deleteChannelAction } from '@/app/actions';

/**
 * Destructive action placed at the very bottom of the channel page.
 * Removes the channel from 1minyt (does NOT unsubscribe on YouTube).
 */
export function RemoveChannelButton({
  channelId,
  title,
}: {
  channelId: string;
  title: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();

  return (
    <div style={{ borderTop: '1px solid #2a2a33', paddingTop: 16, marginTop: 32, display: 'flex', justifyContent: 'flex-end' }}>
      <button
        className="btn btn-danger"
        type="button"
        onClick={() => {
          if (confirm(`Remove ${title} from 1minyt? This does not unsubscribe on YouTube.`)) {
            start(async () => {
              await deleteChannelAction(channelId);
            });
          }
        }}
        disabled={pending}
      >
        {pending ? 'Removing…' : 'Remove from 1minyt'}
      </button>
    </div>
  );
}
