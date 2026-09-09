/**
 * TAV-68b: options — connect the extension to the app.
 *
 * Two fields: the app's base URL (default http://localhost:3000) and the
 * shared-secret API key (EXTENSION_API_KEY on the server). Saving:
 *  1. stores both in browser.storage.sync (they follow the user across
 *     machines),
 *  2. requests the optional host permission for the origin — with it, the
 *     service worker's fetches bypass CORS entirely; without it, the app's
 *     chrome-extension CORS headers still cover us,
 *  3. runs a health check so the user immediately sees whether it works.
 */

import { useEffect, useState } from 'react';
import { browser } from 'wxt/browser';
import { getSettings, normalizeServerUrl, saveSettings, serverOriginPattern } from '@/lib/api';
import { sendMessage } from '@/lib/messages';

type TestState = { kind: 'idle' } | { kind: 'saving' } | { kind: 'testing' } | { kind: 'ok' } | { kind: 'error'; message: string };

export default function App() {
  const [serverUrl, setServerUrl] = useState('http://localhost:3000');
  const [apiKey, setApiKey] = useState('');
  const [test, setTest] = useState<TestState>({ kind: 'idle' });

  useEffect(() => {
    (async () => {
      const settings = await getSettings();
      if (settings) {
        setServerUrl(settings.serverUrl);
        setApiKey(settings.apiKey);
      }
    })();
  }, []);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setTest({ kind: 'saving' });
    const normalized = normalizeServerUrl(serverUrl);
    if (!normalized) {
      setTest({ kind: 'error', message: 'Enter your 1minyt server URL.' });
      return;
    }

    await saveSettings({ serverUrl: normalized, apiKey });

    // Optional host permission for the app origin — best effort. The API also
    // works without it (the server reflects chrome-extension:// origins).
    const pattern = serverOriginPattern(normalized);
    if (pattern) {
      try {
        await browser.permissions.request({ origins: [pattern] });
      } catch {
        // Already granted or user gesture issue — non-fatal.
      }
    }

    setTest({ kind: 'testing' });
    const health = await sendMessage({ type: 'health' });
    setTest(health.ok ? { kind: 'ok' } : { kind: 'error', message: health.error });
  }

  return (
    <div className="page">
      <h1>⚡ 1minyt</h1>
      <p className="lede">
        Connect the extension to your 1minyt server. Both values come from the server: the URL where the app runs, and
        the <code>EXTENSION_API_KEY</code> env var set on it.
      </p>

      <form onSubmit={save}>
        <label>
          Server URL
          <input
            type="url"
            value={serverUrl}
            onChange={(e) => setServerUrl(e.target.value)}
            placeholder="http://localhost:3000"
            spellCheck={false}
          />
        </label>

        <label>
          API key
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="EXTENSION_API_KEY from the server"
            spellCheck={false}
          />
        </label>

        <button type="submit" className="btn primary">
          Save &amp; test connection
        </button>
      </form>

      {test.kind === 'ok' && <p className="ok">Connected ✓ — the extension is ready to use.</p>}
      {test.kind === 'error' && <p className="err">{test.message}</p>}
      {test.kind === 'testing' && <p className="muted">Testing connection…</p>}
      {test.kind === 'saving' && <p className="muted">Saving…</p>}

      <p className="muted small">
        Saved settings live in <code>browser.storage.sync</code> (follows your Chrome profile across machines). The
        server origin is also added to the extension&apos;s host permissions so background requests skip CORS.
      </p>
    </div>
  );
}
