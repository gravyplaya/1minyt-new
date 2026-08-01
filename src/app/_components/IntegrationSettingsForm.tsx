'use client';

import { useState, useTransition } from 'react';
import { saveIntegrationSettingsAction } from '@/app/actions';
import type { IntegrationKey } from '@/lib/integrations';

interface Props {
  integrationKey: IntegrationKey;
  label: string;
  tokenLabel: string;
  tokenHelp: string;
  implemented: boolean;
  /** Whether a token is currently saved. */
  configured: boolean;
}

/**
 * A single integration's settings row: a token input + save/clear buttons.
 * When the integration is not yet implemented, the row renders read-only with
 * a "coming soon" badge so the settings page still lists all three targets.
 */
export function IntegrationSettingsForm({ integrationKey, label, tokenLabel, tokenHelp, implemented, configured }: Props) {
  const [token, setToken] = useState('');
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const handleSave = () => {
    setError(null);
    setSavedMsg(null);
    start(async () => {
      const result = await saveIntegrationSettingsAction(integrationKey, token);
      if (!result.ok) {
        setError(result.error ?? 'Failed to save token.');
        return;
      }
      setToken('');
      setSavedMsg(result.configured ? 'Token saved.' : 'Token cleared.');
    });
  };

  const handleClear = () => {
    setError(null);
    setSavedMsg(null);
    start(async () => {
      const result = await saveIntegrationSettingsAction(integrationKey, '');
      if (!result.ok) {
        setError(result.error ?? 'Failed to clear token.');
        return;
      }
      setSavedMsg('Token cleared.');
    });
  };

  return (
    <div
      style={{
        border: '1px solid #2a2a33',
        borderRadius: 12,
        background: '#15151a',
        padding: 18,
        opacity: implemented ? 1 : 0.6,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
        <strong style={{ fontSize: 15 }}>{label}</strong>
        {configured ? (
          <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 999, background: 'rgba(92,217,163,0.12)', color: '#5cd9a3', border: '1px solid rgba(92,217,163,0.3)' }}>
            configured
          </span>
        ) : (
          <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 999, background: '#1f1f26', color: '#8b8b94', border: '1px solid #2a2a33' }}>
            not configured
          </span>
        )}
        {!implemented && (
          <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 999, background: 'rgba(255,184,77,0.12)', color: '#ffb84d', border: '1px solid rgba(255,184,77,0.3)' }}>
            coming soon
          </span>
        )}
      </div>

      <div style={{ fontSize: 12, color: '#8b8b94', marginBottom: 12 }}>{tokenHelp}</div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <input
          type="password"
          className="input"
          placeholder={tokenLabel}
          value={token}
          onChange={e => setToken(e.target.value)}
          disabled={!implemented || pending}
          style={{ flex: 1, minWidth: 220 }}
          autoComplete="off"
        />
        <button
          type="button"
          className="btn btn-primary"
          onClick={handleSave}
          disabled={!implemented || pending || token.trim().length === 0}
          style={{ fontSize: 12 }}
        >
          {pending ? 'Saving…' : 'Save token'}
        </button>
        {configured && (
          <button
            type="button"
            className="btn"
            onClick={handleClear}
            disabled={!implemented || pending}
            style={{ fontSize: 12 }}
          >
            Clear
          </button>
        )}
      </div>

      {savedMsg && <div style={{ marginTop: 8, fontSize: 12, color: '#5cd9a3' }}>✓ {savedMsg}</div>}
      {error && <div style={{ marginTop: 8, fontSize: 12, color: '#ff6363' }}>⚠ {error}</div>}
    </div>
  );
}
