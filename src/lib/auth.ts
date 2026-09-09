/**
 * TAV-68: Multi-user session auth.
 *
 * Identity: the Google account's YouTube channel id (channels.list?mine=true
 * in the OAuth callback) is the stable unique key in `users`.
 *
 * Sessions: opaque random ids stored in `sessions` + an httpOnly cookie
 * (`1minyt_session`, 30-day sliding expiry). Server-side sessions (not JWTs)
 * so sign-out is a real DELETE and no signing secret is needed. The cookie is
 * set by the OAuth callback route handler and cleared by signOutAction.
 *
 * Data isolation: every data table carries a `user_id` column (see the TAV-68
 * block in lib/schema.ts). Repo functions take the user id as their first
 * parameter; actions/pages resolve it via getSessionUser / requireUserId.
 *
 * Anonymous mode (TAV-67): signed-out paste-a-URL and /watch activity is
 * scoped to the shared ANON_USER_ID bucket — public YouTube metadata and
 * transcripts only, no token spend, invisible to every real user's queries.
 *
 * Legacy adoption: pre-multiuser data is backfilled to the literal user id
 * 'me' with a users row whose google_channel_id is NULL. The FIRST Google
 * login after deploy claims that row (findOrCreateUserByGoogleChannel) and
 * with it the whole backfilled library — deploy, then have the owner log in
 * before anyone else.
 */

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import crypto from 'node:crypto';
import type { PoolClient } from 'pg';
import { getDb, query } from './db';
import { newId } from './id';
import { isConnected } from './tokens';

export const SESSION_COOKIE = '1minyt_session';
export const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;

/**
 * Sentinel owner for anonymous activity. Deliberately has no `users` row —
 * user_id columns carry no FK to users by design (see schema.ts).
 */
export const ANON_USER_ID = '__anon';

export interface SessionUser {
  id: string;
  displayName: string | null;
  avatarUrl: string | null;
}

interface SessionJoinRow {
  session_id: string;
  user_id: string;
  display_name: string | null;
  avatar_url: string | null;
}

interface UserRow {
  id: string;
  google_channel_id: string | null;
  display_name: string | null;
  avatar_url: string | null;
}

/**
 * The signed-in user, or null when signed out. Valid in RSC pages, server
 * actions, and route handlers — anywhere next/headers cookies() works.
 */
export async function getSessionUser(): Promise<SessionUser | null> {
  const store = await cookies();
  const sid = store.get(SESSION_COOKIE)?.value;
  if (!sid) return null;

  const now = Math.floor(Date.now() / 1000);
  const { rows } = await query<SessionJoinRow>(
    `SELECT s.id AS session_id, u.id AS user_id, u.display_name, u.avatar_url
       FROM sessions s
       JOIN users u ON u.id = s.user_id
      WHERE s.id = $1 AND s.expires_at > $2`,
    [sid, now],
  );
  const row = rows[0];
  if (!row) return null;

  // Sliding expiry — each visit extends the session another 30 days.
  await query('UPDATE sessions SET expires_at = $1 WHERE id = $2', [
    now + SESSION_TTL_SECONDS,
    row.session_id,
  ]);

  return { id: row.user_id, displayName: row.display_name, avatarUrl: row.avatar_url };
}

/**
 * The user id to scope anonymous-tolerant reads/writes (paste-a-URL, /watch
 * transcript fetches) with: the signed-in user's id, or the __anon bucket.
 */
export async function getScopedUserId(): Promise<string> {
  const user = await getSessionUser();
  return user?.id ?? ANON_USER_ID;
}

/**
 * For actions that touch personal data or spend tokens. Signed-out callers
 * are bounced to the landing page's sign-in CTA (redirect() throws, which
 * Next treats as the action's result).
 */
export async function requireUserId(): Promise<string> {
  const user = await getSessionUser();
  if (!user) redirect('/');
  return user.id;
}

/**
 * Page-level auth state in one call: the session user plus whether their
 * YouTube connection (oauth_tokens) is live. `connected` is the single gate
 * pages already render around — signed-out and disconnected visitors both see
 * the landing/empty state, and Connect == Sign in (the OAuth callback does
 * both). Returns user=null when signed out, so pages skip user-scoped queries.
 */
export async function resolvePageUser(): Promise<{ user: SessionUser | null; connected: boolean }> {
  const user = await getSessionUser();
  const connected = user ? await isConnected(user.id) : false;
  return { user, connected };
}

/**
 * Create a session row. The caller sets the cookie (the OAuth callback sets
 * it on its redirect response; server actions would use cookies().set).
 */
export async function createSession(userId: string): Promise<{ id: string; expiresAt: number }> {
  const id = crypto.randomBytes(32).toString('hex');
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + SESSION_TTL_SECONDS;
  const client = await getDb();
  try {
    await client.query(
      'INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES ($1, $2, $3, $4)',
      [id, userId, now, expiresAt],
    );
  } finally {
    client.release();
  }
  return { id, expiresAt };
}

/**
 * Sign out (server action context): delete the session row, clear the cookie.
 * Deliberately does NOT touch oauth_tokens — disconnecting YouTube is a
 * separate, explicit action (disconnectAction).
 */
export async function destroySession(): Promise<void> {
  const store = await cookies();
  const sid = store.get(SESSION_COOKIE)?.value;
  if (sid) await query('DELETE FROM sessions WHERE id = $1', [sid]);
  store.delete(SESSION_COOKIE);
}

/**
 * OAuth callback: resolve a Google identity (YouTube channel id) to a user
 * row. Order:
 *  1. Known identity → sign in (profile fields refreshed each login).
 *  2. The unclaimed legacy owner (google_channel_id IS NULL, created by the
 *     migration only when pre-multiuser data exists) → claim it. First login
 *     after deploy wins the backfilled library — intended to be the owner.
 *  3. Otherwise a brand-new user, seeded with the default folders.
 */
export async function findOrCreateUserByGoogleChannel(
  googleChannelId: string,
  displayName: string | null,
  avatarUrl: string | null,
): Promise<UserRow> {
  const now = Math.floor(Date.now() / 1000);
  const client = await getDb();
  try {
    await client.query('BEGIN');

    // 1. Known identity.
    const known = await client.query<UserRow>(
      'SELECT * FROM users WHERE google_channel_id = $1',
      [googleChannelId],
    );
    const existing = known.rows[0];
    if (existing) {
      await client.query(
        'UPDATE users SET display_name = $2, avatar_url = $3, updated_at = $4 WHERE id = $1',
        [existing.id, displayName, avatarUrl, now],
      );
      await client.query('COMMIT');
      return { ...existing, display_name: displayName, avatar_url: avatarUrl };
    }

    // 2. Claim the unclaimed legacy owner, if one exists.
    const legacy = await client.query<UserRow>(
      `UPDATE users
          SET google_channel_id = $1, display_name = $2, avatar_url = $3, updated_at = $4
        WHERE id IN (SELECT id FROM users WHERE google_channel_id IS NULL LIMIT 1)
        RETURNING *`,
      [googleChannelId, displayName, avatarUrl, now],
    );
    if (legacy.rows[0]) {
      console.warn(`[TAV-68] Legacy data pool claimed by Google channel ${googleChannelId} (${displayName ?? 'unknown'})`);
      await client.query('COMMIT');
      return legacy.rows[0];
    }

    // 3. Brand-new user + default folders.
    const id = newId();
    await client.query(
      `INSERT INTO users (id, google_channel_id, display_name, avatar_url, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $5)`,
      [id, googleChannelId, displayName, avatarUrl, now],
    );
    await seedDefaultFolders(client, id);
    await client.query('COMMIT');
    return { id, google_channel_id: googleChannelId, display_name: displayName, avatar_url: avatarUrl };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Default folders for a brand-new user — same two the app has always seeded
 * (lib/db.ts pre-TAV-68). Ids are fresh per user: folders.id is a global PK.
 */
async function seedDefaultFolders(client: PoolClient, userId: string): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const defaults = [
    { name: 'Watch Later', color: '#5b9eff', position: 0 },
    { name: 'Reference', color: '#7c5cff', position: 1 },
  ];
  for (const d of defaults) {
    await client.query(
      `INSERT INTO folders (id, user_id, name, color, position, created_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT DO NOTHING`,
      [newId(), userId, d.name, d.color, d.position, now],
    );
  }
}
