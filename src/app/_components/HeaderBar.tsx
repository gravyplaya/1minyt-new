import Image from 'next/image';
import Link from 'next/link';
import type { UserProfile } from '@/lib/tokens';
import { SyncButton } from './SyncButton';
import { disconnectAction } from '@/app/actions';

/**
 * The top app bar. Navigation lives in the left sidebar (home page);
 * this header keeps the brand, sync/disconnect controls, and the
 * connected-account indicator.
 */
export function HeaderBar({
  connected,
  profile,
  lastSync,
}: {
  connected: boolean;
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
      }}
    >
      <Link href="/" style={{ display: 'flex', alignItems: 'center', gap: 10, color: '#e7e7ea', textDecoration: 'none' }}>
        <Logo />
        <strong style={{ fontSize: 16, letterSpacing: '-0.01em' }}>1minyt</strong>
        <span className="header-subtitle" style={{ color: '#5a5a64', fontSize: 13, marginLeft: 4 }}>beta</span>
      </Link>
      <div className="header-meta" style={{ marginLeft: 'auto', display: 'flex', gap: 12, alignItems: 'center', fontSize: 12, color: '#8b8b94' }}>
        {connected && (
          <>
            <SyncButton lastSync={lastSync ?? null} />
            <form action={disconnectAction}>
              <button
                className="btn btn-ghost"
                type="submit"
                style={{ fontSize: 12, padding: '6px 10px' }}
              >
                Disconnect
              </button>
            </form>
          </>
        )}
        {connected && profile?.displayName ? (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            {profile.avatarUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={profile.avatarUrl}
                alt=""
                width={24}
                height={24}
                style={{ borderRadius: '50%', objectFit: 'cover' }}
              />
            )}
            <span style={{ color: '#e7e7ea', fontSize: 13 }}>{profile.displayName}</span>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#5cd9a3' }} />
          </span>
        ) : (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: connected ? '#5cd9a3' : '#5a5a64' }} />
            {connected ? 'connected' : 'disconnected'}
          </span>
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
