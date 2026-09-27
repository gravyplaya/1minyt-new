/**
 * TAV-68a: Shared plumbing for the /api/extension/* routes — the HTTP surface
 * the browser extension (TAV-68) calls from youtube.com.
 *
 * The app's UI talks to server actions, which an extension can't invoke (they
 * need the Next.js client runtime). These helpers give every extension route a
 * uniform contract instead of each one re-rolling it:
 *
 *  - Auth: two layers. The extension presents a bearer key: either the
 *    operator's `EXTENSION_API_KEY` env master secret (TAV-68a) or a
 *    per-user key auto-listed on /extension (TAV-68h) — either one gates
 *    the whole surface. User identity then comes from the app's own
 *    session cookie (TAV-68): the extension runs in the same browser as
 *    the app and sends its credentials, so `requireExtensionUser` resolves
 *    the signed-in user every data route scopes its queries by. Signed-out
 *    callers get a friendly 401 JSON — never a redirect.
 *  - CORS: MV3 service workers with the app origin in host_permissions bypass
 *    CORS entirely, so these headers are belt-and-braces (they also keep
 *    curl / fetch dev tooling honest). Only chrome-extension:// origins are
 *    reflected, and always with credentials so the session cookie survives a
 *    CORS-checked request (no host permission granted).
 *  - Responses: the app-wide `{ ok, ...data }` / `{ ok: false, error }` shape
 *    the server-action outcomes already use.
 */

import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { getSessionUser, type SessionUser } from './auth';
import { lookupExtensionUserId } from './extension-keys';
import { parseYouTubeUrl } from './youtube-url';
import type { FollowUp, SummaryRow } from './types';

/** Standard JSON response with extension CORS headers attached. */
export function extensionJson(req: Request, data: unknown, status = 200): NextResponse {
  return NextResponse.json(data, { status, headers: extensionCorsHeaders(req) });
}

/** 204 for a CORS preflight. */
export function extensionPreflight(req: Request): NextResponse {
  return new NextResponse(null, { status: 204, headers: extensionCorsHeaders(req) });
}

function extensionCorsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('origin') ?? '';
  const headers: Record<string, string> = { Vary: 'Origin' };
  if (origin.startsWith('chrome-extension://')) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Access-Control-Allow-Credentials'] = 'true';
    headers['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS';
    headers['Access-Control-Allow-Headers'] = 'Authorization, Content-Type';
    headers['Access-Control-Max-Age'] = '86400';
  }
  return headers;
}

/**
 * Auth gate for every /api/extension/* handler. Returns a ready-to-send error
 * response, or null when the request may proceed.
 *
 * TAV-68h: two key flavors are accepted, same bearer header:
 *  1. `EXTENSION_API_KEY` env (TAV-68a) — the operator's master key. Kept for
 *     back-compat; unset is fine when per-user keys exist.
 *  2. A per-user key from `extension_keys` — the default flavor every
 *     non-developer gets: it's listed on /extension when signed in.
 * With neither configured the surface answers 503 (as before), so an
 * env-only deployment still surfaces "disabled" instead of 401-ing forever.
 */
export async function guardExtensionRequest(req: Request): Promise<NextResponse | null> {
  const master = process.env.EXTENSION_API_KEY;
  const match = /^Bearer (.+)$/.exec(req.headers.get('authorization') ?? '');
  const provided = match?.[1] ?? '';

  // Master key first — a constant-time compare against one env value, no DB.
  if (master && provided && keysMatch(provided, master)) {
    return null;
  }

  // Per-user key (TAV-68h): the indexed lookup by exact value IS the check.
  if (provided) {
    try {
      const owner = await lookupExtensionUserId(provided);
      if (owner) return null;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return extensionJson(req, { ok: false, error: msg }, 500);
    }
    // A presented-but-unknown key is a credential rejection, even when no
    // master key is configured — reserving 503 for "nothing presented and
    // nothing configured" keeps a typo'd paste debuggable as 401.
    return extensionJson(req, { ok: false, error: 'Invalid or missing API key.' }, 401);
  }

  if (!master) {
    return extensionJson(
      req,
      {
        ok: false,
        error:
          'Extension API is disabled — set EXTENSION_API_KEY on the server or sign in and use your personal key from /extension.',
      },
      503,
    );
  }
  return extensionJson(req, { ok: false, error: 'Invalid or missing API key.' }, 401);
}

/**
 * TAV-68: resolve which user an extension request acts as. The key gate above
 * authenticates the *extension*; this authenticates the *person* — the app
 * session cookie sent along with the request (the extension passes
 * credentials). Returns the signed-in user plus `denied: null`, or
 * `user: null` plus a ready-to-send error response (401 when there is no
 * session, 500 with the DB error otherwise — the session lookup runs outside
 * the routes' try/catch, so a database hiccup must be folded into the JSON
 * contract here or the extension would surface an opaque non-JSON 500 page).
 * Data routes never leak into the __anon bucket or trigger requireUserId's
 * redirect from a route handler. Caller shape matches guardExtensionRequest:
 * `const { user, denied } = await requireExtensionUser(req); if (denied) return denied;`
 */
export async function requireExtensionUser(
  req: Request,
): Promise<{ user: SessionUser; denied: null } | { user: null; denied: NextResponse }> {
  let user: SessionUser | null;
  try {
    user = await getSessionUser();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { user: null, denied: extensionJson(req, { ok: false, error: msg }, 500) };
  }
  if (!user) {
    return {
      user: null,
      denied: extensionJson(
        req,
        { ok: false, error: 'Not signed in — open the app in this browser and sign in, then try again.' },
        401,
      ),
    };
  }
  return { user, denied: null };
}

/** Constant-time compare; a length mismatch fails fast (length isn't secret). */
function keysMatch(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export interface ExtensionVideoId {
  ok: boolean;
  videoId?: string;
  error?: string;
}

/**
 * Reduce an `{ url | videoId }` body to a video id. Same parse rules as the
 * paste flow (TAV-67): any watch/shorts/embed/live/v/ URL, youtu.be link, or
 * bare 11-character id. Channel and playlist URLs get a specific reason so the
 * extension can tell the user *what* they sent.
 */
export function resolveExtensionVideoId(body: { url?: string; videoId?: string }): ExtensionVideoId {
  const input = (body.videoId ?? body.url ?? '').trim();
  if (!input) return { ok: false, error: 'Missing videoId or url.' };
  const parsed = parseYouTubeUrl(input);
  if (parsed.kind !== 'video') {
    const error =
      parsed.kind === 'playlist'
        ? 'Playlist URLs are not supported yet — use a single video URL.'
        : parsed.kind === 'channel'
          ? 'Channel URLs are not supported yet — use a single video URL.'
          : 'Could not find a video ID. Send a YouTube video URL or its 11-character ID.';
    return { ok: false, error };
  }
  return { ok: true, videoId: parsed.videoId };
}

/** camelCase summary shape shared by /video and /summarize — one consumer contract. */
export interface ExtensionSummary {
  tldr: string;
  keyPoints: string[];
  topics: string[];
  followUps: FollowUp[];
  createdAt: number;
  bookmarked: boolean;
}

/**
 * Map a stored SummaryRow to the extension shape. Drops the LLM prompt (heavy,
 * no use to the extension) and normalizes to camelCase. Null stays null —
 * "not summarized yet" is a state the extension badges on.
 */
export function extensionSummary(summary: SummaryRow | null): ExtensionSummary | null {
  if (!summary) return null;
  return {
    tldr: summary.tldr,
    keyPoints: summary.key_points,
    topics: summary.topics,
    followUps: summary.follow_ups,
    createdAt: summary.created_at,
    bookmarked: summary.bookmarked === 1,
  };
}
