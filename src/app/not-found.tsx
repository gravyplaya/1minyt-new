import Link from 'next/link';

export default function NotFound() {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 24, textAlign: 'center' }}>
      <h1 style={{ fontSize: 48, fontWeight: 700, marginBottom: 8 }}>404</h1>
      <p style={{ color: '#8b8b94', marginBottom: 24 }}>That channel isn&apos;t in your 1minyt library.</p>
      <Link href="/" className="btn btn-primary">← Back to subscriptions</Link>
    </div>
  );
}