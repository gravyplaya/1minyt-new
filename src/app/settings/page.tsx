import Link from 'next/link';
import { AppShell } from '../_components/AppShell';
import { IntegrationSettingsForm } from '../_components/IntegrationSettingsForm';
import { INTEGRATIONS, listIntegrationSettings } from '@/lib/integrations';
import { isConnected, getUserProfile } from '@/lib/tokens';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: '1minyt — Settings',
  description: 'Configure read-later integrations and experimental features.',
};

export default async function SettingsPage() {
  const [connected, profile, settings] = await Promise.all([
    isConnected(),
    getUserProfile(),
    listIntegrationSettings(),
  ]);

  return (
    <AppShell active="settings" connected={connected} profile={profile} mainStyle={{ maxWidth: 720, margin: '0 auto', width: '100%' }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 4 }}>⚙ Settings</h1>
      <p style={{ color: '#8b8b94', fontSize: 13, marginBottom: 24 }}>
        Connect a read-later integration to send bookmarked summaries straight to your PKM system. One-tap &ldquo;Send to Readwise&rdquo; appears on each saved summary once a token is set.
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {INTEGRATIONS.map(meta => {
          const cfg = settings.get(meta.key);
          return (
            <IntegrationSettingsForm
              key={meta.key}
              integrationKey={meta.key}
              label={meta.label}
              tokenLabel={meta.tokenLabel}
              tokenHelp={meta.tokenHelp}
              implemented={meta.implemented}
              configured={!!cfg && cfg.token.length > 0}
            />
          );
        })}
      </div>

      <div style={{ marginTop: 24, fontSize: 12, color: '#5a5a64', lineHeight: 1.6 }}>
        Tokens are stored in the local 1minyt database. Readwise is implemented first — it&apos;s the simplest API (a single POST to <code style={{ color: '#c2c2cb' }}>readwise.io/api/v3/save/</code>). Notion and Obsidian are stubbed here and will be wired in a follow-up.
      </div>

      {/* Labs — experimental features that haven't graduated to the main nav. */}
      <div style={{ marginTop: 40 }}>
        <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>🧪 Labs</h2>
        <p style={{ color: '#8b8b94', fontSize: 13, marginBottom: 16, lineHeight: 1.5 }}>
          Experimental features. They may change, break, or disappear without notice.
        </p>
        <Link
          href="/digests"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: '14px 16px',
            borderRadius: 10,
            border: '1px solid #2a2a33',
            background: '#15151a',
            textDecoration: 'none',
            color: '#e7e7ea',
            transition: 'border-color .15s ease, background .15s ease',
          }}
        >
          <span style={{ fontSize: 20 }}>📋</span>
          <span style={{ flex: 1, minWidth: 0 }}>
            <span style={{ display: 'block', fontWeight: 600, fontSize: 14, marginBottom: 2 }}>New-video digest</span>
            <span style={{ display: 'block', color: '#8b8b94', fontSize: 12, lineHeight: 1.4 }}>
              Sync every channel and collect new uploads into a single readable briefing since your last sync.
            </span>
          </span>
          <span style={{ color: '#5b9eff', fontSize: 16, flexShrink: 0 }}>→</span>
        </Link>
      </div>
    </AppShell>
  );
}
