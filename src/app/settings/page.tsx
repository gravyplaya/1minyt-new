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
    <AppShell tab="settings" settingsActive="integrations" connected={connected} profile={profile} mainStyle={{ maxWidth: 'none', width: '100%' }}>
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

      {/* Labs — see the Settings rail for the Digests link under Labs. */}
    </AppShell>
  );
}
