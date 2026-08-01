'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { generateDigestAction } from '@/app/actions';

/**
 * "Generate digest" button. Calls the server action, then refreshes the page
 * so the new digest appears. Shows a transient result/error banner inline.
 */
export function GenerateDigestButton({ connected }: { connected: boolean }) {
  const [pending, start] = useTransition();
  const router = useRouter();

  const onClick = () => {
    start(async () => {
      const outcome = await generateDigestAction();
      if (!outcome.ok) {
        alert(`Failed to generate digest: ${outcome.error ?? 'unknown error'}`);
      } else if (outcome.errors && outcome.errors.length > 0) {
        alert(
          `Digest generated with ${outcome.videoCount ?? 0} new video(s), but some channels had errors:\n${outcome.errors.join('\n')}`,
        );
      }
      router.refresh();
    });
  };

  return (
    <button
      type="button"
      className="btn btn-primary"
      onClick={onClick}
      disabled={pending || !connected}
      title={connected ? 'Sync all channels and collect newly published videos' : 'Connect your YouTube account first'}
    >
      {pending ? 'Generating digest…' : '📋 Generate digest'}
    </button>
  );
}
