import Image from 'next/image';
import Link from 'next/link';
import type { UserProfile } from '@/lib/tokens';
import { SyncButton } from './SyncButton';
import { PasteUrlBox } from './PasteUrlBox';
import { UserMenu } from './UserMenu';

/**
 * The top app bar. Navigation lives in the left sidebar (home page);
 * this header keeps the brand, sync control, the connected-account
 * dropdown, and the TAV-67 paste-a-URL box.
 *
 * TAV-68: `signedIn` (session) and `connected` (YouTube tokens) are separate
 * states. Signed-in visitors get the user chip (avatar + channel name) with a
 * dropdown holding "Disconnect YouTube" and "Sign out"; signed-out visitors
 * get a Sign in link — which is the same Google OAuth flow as Connect (the
 * callback creates the account and the session).
 */
export function HeaderBar({
  connected,
  signedIn,
  profile,
  lastSync,
}: {
  connected: boolean;
  signedIn: boolean;
  profile?: UserProfile | null;
  lastSync?: number | null;
}) {
  return (
    <header
      className="header-bar"
      style={{
        display: 'flex',
        alignItems: 'center',
        padding: '12px 24px',
        borderBottom: '1px solid #2a2a33',
        background: '#0a0a0c',
        // TAV-69: the landing page renders fixed layers (WebGL canvas at
        // z-index 0, vignette at 1, content at 2). A static header paints
        // below ALL of them — particles and the vignette's top gradient
        // washed over this bar on `/` signed-out. Positioning the header
        // with z-index 10 lifts it above every landing layer; on app
        // pages nothing changes (nothing there paints above the header).
        position: 'relative',
        zIndex: 10,
      }}
    >
      <Link href="/" style={{ display: 'flex', alignItems: 'center', gap: 10, color: '#e7e7ea', textDecoration: 'none' }}>
        <Logo />
        <strong style={{ fontSize: 16, letterSpacing: '-0.01em' }}>1minyt</strong>
        <span className="header-subtitle" style={{ color: '#5a5a64', fontSize: 13, marginLeft: 4 }}>beta</span>
      </Link>
      <PasteUrlBox />
      <div className="header-meta" style={{ marginLeft: 'auto', display: 'flex', gap: 12, alignItems: 'center', fontSize: 12, color: '#8b8b94' }}>
        {connected && (
          <SyncButton lastSync={lastSync ?? null} />
        )}
        {signedIn ? (
          <UserMenu
            connected={connected}
            displayName={profile?.displayName ?? 'Account'}
            avatarUrl={profile?.avatarUrl ?? null}
          />
        ) : (
          <>
            <a
              href="/api/oauth/start"
              className="btn btn-ghost"
              style={{ fontSize: 12, padding: '6px 10px', textDecoration: 'none' }}
            >
              Sign in
            </a>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#5a5a64' }} />
              signed out
            </span>
          </>
        )}
      </div>
    </header>
  );
}

function Logo() {
  return (
    <Image
      src="/images/logo_only.jpg"
      alt="1minyt logo"
      width={24}
      height={24}
      priority
      style={{ borderRadius: 6, objectFit: 'cover' }}
    />
  );
}
