'use client';

import { useState, useTransition } from 'react';
import { sendToIntegrationAction } from '@/app/actions';

interface Props {
  videoId: string;
  /** Whether the Readwise integration has a token configured. Hides the button when false. */
  readwiseConfigured: boolean;
}

/**
 * TAV-27: One-tap "Send to Readwise" button for a bookmarked summary on the
 * /saved page. Calls the server action which loads the bookmark, builds the
 * export payload, and POSTs to the Readwise Reader API. Shows a success or
 * error state inline.
 */
export function SendToReadwiseButton({ videoId, readwiseConfigured }: Props) {
  const [pending, start] = useTransition();
  const [status, setStatus] = useState<{ kind: 'ok' | 'error'; msg: string } | null>(null);

  if (!readwiseConfigured) return null;

  const handleClick = () => {
    setStatus(null);
    start(async () => {
      const result = await sendToIntegrationAction('readwise', videoId);
      if (result.ok) {
        setStatus({ kind: 'ok', msg: result.documentUrl ? 'Sent to Readwise' : 'Sent to Readwise' });
      } else {
        setStatus({ kind: 'error', msg: result.error ?? 'Failed to send to Readwise.' });
      }
    });
  };

  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      <button
        type="button"
        className="btn"
        onClick={handleClick}
        disabled={pending}
        style={{ fontSize: 12 }}
        title="Send this summary to Readwise Reader"
      >
        {pending ? 'Sending…' : '📤 Send to Readwise'}
      </button>
      {status && (
        <span style={{ fontSize: 12, color: status.kind === 'ok' ? '#5cd9a3' : '#ff6363' }}>
          {status.kind === 'ok' ? '✓ ' : '⚠ '}{status.msg}
        </span>
      )}
    </div>
  );
}
