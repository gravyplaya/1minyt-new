'use client';

/**
 * TAV-67: Paste box — process any YouTube video URL, no sign-in required.
 *
 * One field, one action: parse → ingest metadata → fetch transcript
 * (processPastedUrlAction; anonymous users are served via Innertube), then
 * navigate to /watch?v=<id> where the video plays and the "Summarize this
 * video" button waits. Errors render inline under the input; non-fatal
 * warnings (e.g. no captions) surface through the watch page's transcript
 * state instead of blocking navigation.
 *
 * Two variants: 'header' — the compact box in the global header bar — and
 * 'hero' — the large paste-first entry point on the disconnected landing
 * page, styled to match the landing CTA row.
 */

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { processPastedUrlAction } from '@/app/actions';

export function PasteUrlBox({ variant = 'header' }: { variant?: 'header' | 'hero' }) {
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

  const isHero = variant === 'hero';

  return (
    <div
      style={{
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        gap: isHero ? 10 : 8,
        marginLeft: isHero ? 0 : 24,
        flexWrap: isHero ? 'wrap' : 'nowrap',
      }}
    >
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
        placeholder={
          isHero ? 'Paste any YouTube video URL…' : 'Paste a YouTube video URL…'
        }
        aria-label="Paste a YouTube video URL"
        disabled={pending}
        spellCheck={false}
        style={{
          flex: isHero ? 1 : undefined,
          width: isHero ? 'min(420px, 100%)' : 240,
          padding: isHero ? '13px 16px' : '7px 10px',
          fontSize: isHero ? 15 : 13,
          color: '#e7e7ea',
          background: isHero ? 'rgba(20, 20, 26, 0.75)' : '#15151a',
          border: isHero ? '1px solid #2a2a33' : '1px solid #2a2a33',
          borderRadius: isHero ? 10 : 8,
          outline: 'none',
          backdropFilter: isHero ? 'blur(8px)' : undefined,
        }}
      />
      <button
        type="button"
        className={isHero ? 'btn btn-primary landing-btn-lg' : 'btn btn-ghost'}
        onClick={submit}
        disabled={pending || !value.trim()}
        title="Fetch the video, its transcript, and open it here"
        style={{
          fontSize: isHero ? undefined : 12,
          padding: isHero ? undefined : '7px 12px',
          whiteSpace: 'nowrap',
        }}
      >
        {pending ? 'Processing…' : isHero ? 'Summarize it' : 'Process'}
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
            maxWidth: isHero ? 480 : 360,
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
