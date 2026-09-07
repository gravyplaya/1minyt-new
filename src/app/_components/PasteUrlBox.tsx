'use client';

/**
 * TAV-67: Header paste box — process any YouTube video URL.
 *
 * One field, one action: parse → ingest metadata → fetch transcript
 * (processPastedUrlAction), then navigate to /watch?v=<id> where the video
 * plays and the "Summarize this video" button waits. Errors render inline
 * under the input; non-fatal warnings (e.g. no captions) surface through the
 * watch page's transcript state instead of blocking navigation.
 */

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { processPastedUrlAction } from '@/app/actions';

export function PasteUrlBox() {
  const router = useRouter();
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const submit = () => {
    const input = value.trim();
    if (!input || pending) return;
    setError(null);
    start(async () => {
      const outcome = await processPastedUrlAction(input);
      if (outcome.ok && outcome.videoId) {
        setValue('');
        router.push(`/watch?v=${outcome.videoId}`);
      } else {
        setError(outcome.error ?? 'Failed to process that URL.');
      }
    });
  };

  return (
    <div style={{ position: 'relative', marginLeft: 24, display: 'flex', alignItems: 'center', gap: 8 }}>
      <input
        type="text"
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          if (error) setError(null);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            submit();
          }
        }}
        placeholder="Paste a YouTube video URL…"
        aria-label="Paste a YouTube video URL"
        disabled={pending}
        spellCheck={false}
        style={{
          width: 240,
          padding: '7px 10px',
          fontSize: 13,
          color: '#e7e7ea',
          background: '#15151a',
          border: '1px solid #2a2a33',
          borderRadius: 8,
          outline: 'none',
        }}
      />
      <button
        type="button"
        className="btn btn-ghost"
        onClick={submit}
        disabled={pending || !value.trim()}
        title="Fetch the video, its transcript, and open it here"
        style={{ fontSize: 12, padding: '7px 12px', whiteSpace: 'nowrap' }}
      >
        {pending ? 'Processing…' : 'Process'}
      </button>

      {error && (
        <div
          role="alert"
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            marginTop: 6,
            padding: '7px 10px',
            fontSize: 12,
            color: '#ff9b6b',
            background: '#15151a',
            border: '1px solid #2a2a33',
            borderRadius: 8,
            maxWidth: 360,
            zIndex: 20,
            whiteSpace: 'normal',
            lineHeight: 1.4,
          }}
        >
          {error}
        </div>
      )}
    </div>
  );
}
