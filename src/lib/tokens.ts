/**
 * OAuth tokens persist in Postgres so each user only has to authorize once.
 *
 * TAV-68: keyed by the real user id (users.id — see lib/auth.ts). Callers
 * must pass the id explicitly; there is no default user anymore.
 */

import { getDb } from './db';
import { refreshAccessToken } from './youtube';

interface TokenRow {
  user_id: string;
  access_token: string;
  refresh_token: string;
  expiry_date: number | null;
  updated_at: number;
  display_name: string | null;
  avatar_url: string | null;
}

export interface UserProfile {
  displayName: string | null;
  avatarUrl: string | null;
}

export async function saveTokens(
  userId: string,
  accessToken: string,
  refreshToken: string,
  expiryDate: number | null,
  profile?: UserProfile,
): Promise<void> {
  // Google returns expiry_date in milliseconds; store as seconds to fit INTEGER
  // (consistent with updated_at and all other timestamp columns in the schema).
  const expirySec = expiryDate !== null ? Math.floor(expiryDate / 1000) : null;
  const client = await getDb();
  try {
    await client.query(
      `INSERT INTO oauth_tokens (user_id, access_token, refresh_token, expiry_date, updated_at, display_name, avatar_url)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT(user_id) DO UPDATE SET
        access_token=excluded.access_token,
        refresh_token=excluded.refresh_token,
        expiry_date=excluded.expiry_date,
        updated_at=excluded.updated_at,
        display_name=excluded.display_name,
        avatar_url=excluded.avatar_url`,
      [userId, accessToken, refreshToken, expirySec, Math.floor(Date.now() / 1000), profile?.displayName ?? null, profile?.avatarUrl ?? null],
    );
  } finally {
    client.release();
  }
}

export async function loadTokens(userId: string): Promise<TokenRow | null> {
  const client = await getDb();
  try {
    const { rows } = await client.query<TokenRow>('SELECT * FROM oauth_tokens WHERE user_id = $1', [userId]);
    return rows[0] ?? null;
  } finally {
    client.release();
  }
}

export async function clearTokens(userId: string): Promise<void> {
  const client = await getDb();
  try {
    await client.query('DELETE FROM oauth_tokens WHERE user_id = $1', [userId]);
  } finally {
    client.release();
  }
}

export async function isConnected(userId: string): Promise<boolean> {
  const tokens = await loadTokens(userId);
  return tokens?.refresh_token ? true : false;
}

/**
 * Return an access token, refreshing if it's within 60s of expiry.
 */
export async function getValidAccessToken(userId: string): Promise<string> {
  const tokens = await loadTokens(userId);
  if (!tokens) throw new Error('Not connected — authorize first');
  const nowSec = Math.floor(Date.now() / 1000);
  if (tokens.expiry_date && tokens.expiry_date - nowSec > 60) {
    return tokens.access_token;
  }
  const refreshed = await refreshAccessToken(tokens.refresh_token);
  // Preserve the existing profile when refreshing the access token.
  await saveTokens(userId, refreshed.access_token, tokens.refresh_token, refreshed.expiry_date, {
    displayName: tokens.display_name,
    avatarUrl: tokens.avatar_url,
  });
  return refreshed.access_token;
}

export async function getUserProfile(userId: string): Promise<UserProfile | null> {
  const tokens = await loadTokens(userId);
  if (!tokens) return null;
  return { displayName: tokens.display_name, avatarUrl: tokens.avatar_url };
}

/**
 * TAV-68: every user with a stored refresh token. Headless sync (pnpm sync,
 * cron POST /api/sync) iterates these — each user's subscriptions sync
 * independently with their own token.
 */
export async function listConnectedUserIds(): Promise<string[]> {
  const client = await getDb();
  try {
    const { rows } = await client.query<{ user_id: string }>(
      'SELECT user_id FROM oauth_tokens WHERE refresh_token IS NOT NULL',
    );
    return rows.map(r => r.user_id);
  } finally {
    client.release();
  }
}
