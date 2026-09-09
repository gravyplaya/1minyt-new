'use client';

/**
 * TAV-68: the signed-in user chip — avatar + channel name + connection dot —
 * that opens a dropdown with the account actions: "Disconnect YouTube" (revoke
 * the stored OAuth tokens, keep the session) and "Sign out" (end the session,
 * keep the tokens). Rendered by HeaderBar; only mounted when signed in.
 *
 * Pure UI state: open/closed. The actions themselves are server actions
 * submitted via plain <form>s inside the dropdown.
 */

import { useEffect, useRef, useState } from 'react';
import { disconnectAction, signOutAction } from '@/app/actions';

export function UserMenu({
  connected,
  displayName,
  avatarUrl,
}: {
  connected: boolean;
  displayName: string;
  avatarUrl: string | null;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Close on click-outside and on Escape — standard menu behaviour.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent | TouchEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('touchstart', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('touchstart', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} style={{ position: 'relative' }}>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 8,
          background: open ? '#1f1f26' : 'transparent',
          border: '1px solid transparent',
          borderRadius: 8,
          padding: '4px 8px',
          cursor: 'pointer',
          color: 'inherit',
          fontSize: 12,
        }}
      >
        {avatarUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={avatarUrl}
            alt=""
            width={24}
            height={24}
            style={{ borderRadius: '50%', objectFit: 'cover' }}
          />
        )}
        <span style={{ color: '#e7e7ea', fontSize: 13 }}>{displayName}</span>
        <span
          title={connected ? 'YouTube connected' : 'YouTube disconnected'}
          style={{ width: 8, height: 8, borderRadius: '50%', background: connected ? '#5cd9a3' : '#5a5a64', flexShrink: 0 }}
        />
        <span aria-hidden style={{ color: '#8b8b94', fontSize: 10, marginLeft: 2 }}>▼</span>
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Account"
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            right: 0,
            minWidth: 190,
            background: '#15151a',
            border: '1px solid #2a2a33',
            borderRadius: 10,
            boxShadow: '0 12px 32px rgba(0,0,0,0.45)',
            padding: 6,
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
            zIndex: 50,
          }}
        >
          <div style={{ padding: '6px 10px 8px', borderBottom: '1px solid #2a2a33', marginBottom: 4 }}>
            <div style={{ color: '#8b8b94', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              {connected ? 'YouTube connected' : 'YouTube disconnected'}
            </div>
          </div>

          {connected && (
            <form action={disconnectAction}>
              <button
                type="submit"
                role="menuitem"
                className="btn btn-ghost"
                style={{ width: '100%', textAlign: 'left', fontSize: 13, padding: '8px 10px', borderRadius: 7 }}
              >
                Disconnect YouTube
              </button>
            </form>
          )}
          <form action={signOutAction}>
            <button
              type="submit"
              role="menuitem"
              className="btn btn-ghost"
              style={{ width: '100%', textAlign: 'left', fontSize: 13, padding: '8px 10px', borderRadius: 7 }}
            >
              Sign out
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
