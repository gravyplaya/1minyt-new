import Link from 'next/link';

/**
 * The top app bar. Kept tiny — there's no global nav in Phase 1.
 */
export function HeaderBar({ connected }: { connected: boolean }) {
  return (
    <header
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
        <span style={{ color: '#5a5a64', fontSize: 13, marginLeft: 4 }}>subscriptions</span>
      </Link>
      <div style={{ marginLeft: 'auto', display: 'flex', gap: 16, alignItems: 'center', fontSize: 12, color: '#8b8b94' }}>
        <Link href="/metrics" style={{ color: '#c2c2cb', textDecoration: 'none', fontSize: 13 }}>📊 Metrics</Link>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: connected ? '#5cd9a3' : '#5a5a64' }} />
          {connected ? 'connected' : 'disconnected'}
        </span>
      </div>
    </header>
  );
}

function Logo() {
  return (
    <span
      style={{
        width: 24,
        height: 24,
        borderRadius: 6,
        background: 'linear-gradient(135deg, #5b9eff, #7c5cff)',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: '#0a0a0c',
        fontWeight: 800,
        fontSize: 14,
      }}
    >
      1m
    </span>
  );
}