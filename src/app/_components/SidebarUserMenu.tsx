'use client';

/**
 * TAV-71: sidebar user chip — avatar + name + connection state — that opens
 * the account popover above it: Settings, "Disconnect YouTube" (revoke the
 * stored OAuth tokens, keep the session) and "Sign out" (end the session,
 * keep the tokens). Sits at the bottom of the app sidebar.
 *
 * Pure UI state: open/closed. The actions themselves are server actions
 * submitted via plain <form>s inside the popover.
 */

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { disconnectAction, signOutAction } from '@/app/actions';

export function SidebarUserMenu({
  connected,
  displayName,
  avatarUrl,
  lastSyncLabel,
}: {
  connected: boolean;
  displayName: string;
  avatarUrl: string | null;
  /** Humanized "2h ago" string for the last successful sync, or null. */
  lastSyncLabel: string | null;
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

  const sub = lastSyncLabel
    ? `Synced ${lastSyncLabel}`
    : connected
      ? 'YouTube connected'
      : 'YouTube not connected';

  return (
    <div className="user-chip-wrap" ref={rootRef}>
      <button
        type="button"
        className="user-chip"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls="user-popover"
        onClick={() => setOpen(o => !o)}
      >
        <span className="user-avatar">
          {avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={avatarUrl} alt="" />
          ) : (
            (displayName[0] ?? '?').toUpperCase()
          )}
        </span>
        <span>
          <span className="user-name">{displayName}</span>
          <div className="user-sub">{sub}</div>
        </span>
        <svg className="user-caret" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden>
          <path d="m6 15 6-6 6 6" />
        </svg>
      </button>

      <div
        id="user-popover"
        className={`user-popover${open ? ' open' : ''}`}
        role="menu"
        aria-label="Account"
      >
        <div className="user-popover-label">Account</div>
        <Link className="user-popover-item" href="/settings" role="menuitem" onClick={() => setOpen(false)}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
            <circle cx="12" cy="12" r="3" />
            <path d="M19 12a7 7 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7 7 0 0 0-2-1.2L14 3h-4l-.5 2.6a7 7 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6A7 7 0 0 0 5 12c0 .4 0 .8.1 1.2l-2 1.6 2 3.4 2.4-1a7 7 0 0 0 2 1.2L10 21h4l.5-2.6a7 7 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2z" />
          </svg>
          Settings
        </Link>
        <div className="user-popover-divider" />
        {connected && (
          <form action={disconnectAction}>
            <button
              type="submit"
              role="menuitem"
              className="user-popover-item"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                <path d="M18.36 6.64a9 9 0 1 1-12.73 0" />
                <path d="M12 2v10" />
              </svg>
              Disconnect YouTube
            </button>
          </form>
        )}
        <form action={signOutAction}>
          <button
            type="submit"
            role="menuitem"
            className="user-popover-item danger"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <path d="M16 17l5-5-5-5" />
              <path d="M21 12H9" />
            </svg>
            Sign out
          </button>
        </form>
      </div>
    </div>
  );
}
