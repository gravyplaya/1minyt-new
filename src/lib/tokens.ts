/**
 * OAuth tokens persist in SQLite so the user only has to authorize once.
 *
 * The user_id is hardcoded to "me" because this is a personal-MVP single-user
 * app. Phase 2 (multi-user) will swap this for a real users table.
 */

import { getDb } from './db';
import { refreshAccessToken } from './youtube';

interface TokenRow {
  user_id: string;
  access_token: string;
  refresh_token: string;
  expiry_date: number | null;
  updated_at: number;
}

export function saveTokens(userId: string, accessToken: string, refreshToken: string, expiryDate: number | null): void {
  getDb().prepare(`
    INSERT INTO oauth_tokens (user_id, access_token, refresh_token, expiry_date, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      access_token=excluded.access_token,
      refresh_token=excluded.refresh_token,
      expiry_date=excluded.expiry_date,
      updated_at=excluded.updated_at
  `).run(userId, accessToken, refreshToken, expiryDate, Math.floor(Date.now() / 1000));
}

export function loadTokens(userId: string): TokenRow | null {
  return getDb().prepare('SELECT * FROM oauth_tokens WHERE user_id = ?').get(userId) as TokenRow | null;
}

export function clearTokens(userId: string): void {
  getDb().prepare('DELETE FROM oauth_tokens WHERE user_id = ?').run(userId);
}

export function isConnected(userId = 'me'): boolean {
  return loadTokens(userId)?.refresh_token ? true : false;
}

/**
 * Return an access token, refreshing if it's within 60s of expiry.
 */
export async function getValidAccessToken(userId = 'me'): Promise<string> {
  const tokens = loadTokens(userId);
  if (!tokens) throw new Error('Not connected — authorize first');
  const now = Math.floor(Date.now() / 1000);
  if (tokens.expiry_date && tokens.expiry_date - now > 60) {
    return tokens.access_token;
  }
  const refreshed = await refreshAccessToken(tokens.refresh_token);
  saveTokens(userId, refreshed.access_token, tokens.refresh_token, refreshed.expiry_date);
  return refreshed.access_token;
}