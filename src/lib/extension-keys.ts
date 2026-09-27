/**
 * TAV-68h: per-user extension API keys.
 *
 * The shared-secret EXTENSION_API_KEY env var (TAV-68a) gates the extension
 * surface per *deployment* — fine for the operator, useless for everyone
 * they invite: a non-developer has no way to generate an env var, and the
 * operator has no safe way to hand the master key out. This module gives
 * every user exactly one key of their own instead:
 *
 *  - `ensureExtensionKey` — read the key, creating it on first access.
 *    The /extension page calls it render-time when signed in, so the key
 *    simply *appears* on the page — nothing to generate by hand.
 *  - `regenerateExtensionKey` — replace the value (rotate on leak/suspicion,
 *    or because the old one leaked into a screenshot).
 *  - `lookupExtensionUserId` — reverse lookup for the request gate in
 *    extension-api.ts, keeping that module free of a repo dependency.
 *
 * Threat model, deliberately: the key authenticates the *extension*, not the
 * person. Data routes still resolve the user from the session cookie
 * (requireExtensionUser), so a stolen key alone reads nothing — it just lets
 * someone's browser extension talk to a server it could reach anyway. The
 * user_id predicate on every query stays the actual isolation boundary.
 *
 * Plaintext storage matches integration_settings tokens: the whole feature is
 * "list my key on the page so I can copy it" — a hash would break that.
 */

import crypto from 'node:crypto';
import { query } from './db';

interface ExtensionKeyRow {
  user_id: string;
  api_key: string;
}

/** Opaque, URL-safe, copy-paste friendly: `ext_` prefix + 32 hex chars. */
function newExtensionKey(): string {
  return `ext_${crypto.randomBytes(16).toString('hex')}`;
}

/**
 * The user's extension key, creating it on first access. Safe to call on
 * every /extension render — the read runs first and the insert is
 * ON CONFLICT DO NOTHING, so concurrent first-visits can't throw.
 */
export async function ensureExtensionKey(userId: string): Promise<string> {
  const existing = await query<ExtensionKeyRow>(
    'SELECT user_id, api_key FROM extension_keys WHERE user_id = $1',
    [userId],
  );
  if (existing.rows[0]) return existing.rows[0].api_key;

  const now = Math.floor(Date.now() / 1000);
  const key = newExtensionKey();
  await query(
    `INSERT INTO extension_keys (user_id, api_key, created_at, updated_at)
     VALUES ($1, $2, $3, $3)
     ON CONFLICT (user_id) DO NOTHING`,
    [userId, key, now],
  );

  // A concurrent visitor may have won the insert — re-read so both callers
  // see the same value.
  const settled = await query<ExtensionKeyRow>(
    'SELECT user_id, api_key FROM extension_keys WHERE user_id = $1',
    [userId],
  );
  return settled.rows[0]?.api_key ?? key;
}

/**
 * Replace the key. The old value stops working immediately (the gate checks
 * the table, not a cache). Signed-in callers only — actions.ts wraps this
 * with requireUserId().
 */
export async function regenerateExtensionKey(userId: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const key = newExtensionKey();
  const { rows } = await query<ExtensionKeyRow>(
    `INSERT INTO extension_keys (user_id, api_key, created_at, updated_at)
     VALUES ($1, $2, $3, $3)
     ON CONFLICT (user_id) DO UPDATE SET api_key = $2, updated_at = $3
     RETURNING user_id, api_key`,
    [userId, key, now],
  );
  return rows[0].api_key;
}

/**
 * Reverse lookup for the extension-request gate: which user owns a presented
 * key. Returns null for unknown values. The env master key never appears
 * here — it is checked before this runs (see guardExtensionRequest).
 */
export async function lookupExtensionUserId(apiKey: string): Promise<string | null> {
  if (!apiKey) return null;
  const { rows } = await query<ExtensionKeyRow>(
    'SELECT user_id, api_key FROM extension_keys WHERE api_key = $1',
    [apiKey],
  );
  return rows[0]?.user_id ?? null;
}
