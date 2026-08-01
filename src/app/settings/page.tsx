import Link from 'next/link';
import { HeaderBar } from '../_components/HeaderBar';
import { IntegrationSettingsForm } from '../_components/IntegrationSettingsForm';
import { INTEGRATIONS, listIntegrationSettings } from '@/lib/integrations';
import { isConnected, getUserProfile } from '@/lib/tokens';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: '1minyt — Settings',
  description: 'Configure read-later integrations (Readwise, Notion, Obsidian).',
};

export default async function SettingsPage() {
  const [connected, profile, settings] = await Promise.all([
    isConnected(),
    getUserProfile(),
    listIntegrationSettings(),
  ]);

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <HeaderBar connected={connected} profile={profile} />
      <main style={{ padding: '24px 32px', maxWidth: 720, margin: '0 auto', width: '100%' }}>
        <div style={{ marginBottom: 14 }}>
          <Link href="/" style={{ color: '#8b8b94', fontSize: 13, textDecoration: 'none' }}>← Back to subscriptions</Link>
        </div>

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
      </main>
    </div>
  );
}
