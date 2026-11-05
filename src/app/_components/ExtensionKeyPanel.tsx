'use client';

/**
 * TAV-68h: the personal extension-key panel on /extension.
 *
 * Shows the signed-in user's key (auto-created server-side on page render),
 * copy-to-clipboard, and regenerate. The key is the *extension* credential —
 * data routes still require the session cookie — so the panel's copy says
 * "paste into the extension options" rather than treating it as a password.
 * The field itself is masked like one, though (TAV-68h follow-up): rendered
 * as a read-only password input, revealed on demand with Show/Hide, so the
 * value doesn't sit in plain text on the screen or in screenshots.
 *
 * Copy uses the async Clipboard API with a textarea fallback for
 * non-secure contexts (http://localhost dev). Regenerate calls the server
 * action and swaps in the returned key; the old key dies server-side on the
 * very next extension request.
 */

import { useState, useTransition } from 'react';
import { regenerateExtensionKeyAction } from '@/app/actions';

interface Props {
  apiKey: string;
}

export function ExtensionKeyPanel({ apiKey: initialKey }: Props) {
  const [apiKey, setApiKey] = useState(initialKey);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  // Masked by default so the key reads like a password field — visible only
  // on demand. Copy/regenerate operate on the state value, not the field's
  // rendering, so masking never gets in the way.
  const [revealed, setRevealed] = useState(false);

  async function copy() {
    setError(null);
    try {
      await navigator.clipboard.writeText(apiKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback for non-secure contexts (plain http dev).
      try {
        const ta = document.createElement('textarea');
        ta.value = apiKey;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch {
        setError('Copy failed — select the key manually.');
      }
    }
  }

  function regenerate() {
    setError(null);
    start(async () => {
      const result = await regenerateExtensionKeyAction();
      if (!result.ok || !result.apiKey) {
        setError(result.error ?? 'Failed to regenerate the key.');
        return;
      }
      setApiKey(result.apiKey);
    });
  }

  return (
    <div>
      <h3
        style={{
          fontSize: 16,
          fontWeight: 600,
          color: '#e7e7ea',
          margin: '0 0 6px',
        }}
      >
        Your extension key
      </h3>
      <p
        style={{
          fontSize: 13.5,
          color: '#b8b8c2',
          lineHeight: 1.6,
          margin: '0 0 14px',
        }}
      >
        One personal key for this account. Paste it into the extension options
        (toolbar icon → gear) together with the server URL — no env vars, no
        asking the admin. It only works with your signed-in browser session.
      </p>

      <div
        style={{
          display: 'flex',
          gap: 8,
          alignItems: 'center',
          flexWrap: 'wrap',
        }}
      >
        <input
          type={revealed ? 'text' : 'password'}
          value={apiKey}
          readOnly
          autoComplete="off"
          spellCheck={false}
          onFocus={(e) => e.currentTarget.select()}
          aria-label="Your extension key"
          style={{
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
            fontSize: 13,
            color: '#d4d4dc',
            background: 'rgba(21, 21, 26, 0.9)',
            border: '1px solid #2a2a33',
            borderRadius: 8,
            padding: '10px 14px',
            flex: 1,
            minWidth: 240,
            // Match the landing page's input reset (no default appearance).
            appearance: 'none',
            outline: 'none',
          }}
        />
        <button
          type="button"
          className="btn"
          onClick={() => setRevealed((v) => !v)}
          disabled={pending}
          style={{ fontSize: 12 }}
          aria-pressed={revealed}
        >
          {revealed ? 'Hide' : 'Show'}
        </button>
        <button
          type="button"
          className="btn"
          onClick={copy}
          disabled={pending}
          style={{ fontSize: 12 }}
        >
          {copied ? 'Copied ✓' : 'Copy'}
        </button>
        <button
          type="button"
          className="btn"
          onClick={regenerate}
          disabled={pending}
          style={{ fontSize: 12 }}
        >
          {pending ? 'Regenerating…' : 'Regenerate'}
        </button>
      </div>

      {error && (
        <div style={{ marginTop: 10, fontSize: 12, color: '#ff6363' }}>⚠ {error}</div>
      )}
      <p
        style={{
          fontSize: 12,
          color: '#6f6f78',
          margin: '12px 0 0',
          lineHeight: 1.6,
        }}
      >
        Regenerate replaces the value — anything still holding the old key
        (the extension options page, a screenshot) stops working immediately.
      </p>
    </div>
  );
}
