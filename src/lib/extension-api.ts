/**
 * TAV-68a: Shared plumbing for the /api/extension/* routes — the HTTP surface
 * the browser extension (TAV-68) calls from youtube.com.
 *
 * The app's UI talks to server actions, which an extension can't invoke (they
 * need the Next.js client runtime). These helpers give every extension route a
 * uniform contract instead of each one re-rolling it:
 *
 *  - Auth: two layers. `EXTENSION_API_KEY` on the server, sent by the extension
 *    as `Authorization: Bearer <key>`, gates the whole surface (no key
 *    configured = 503, wrong key = 401). User identity then comes from the
 *    app's own session cookie (TAV-68): the extension runs in the same browser
 *    as the app and sends its credentials, so `requireExtensionUser` resolves
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
 */
export function guardExtensionRequest(req: Request): NextResponse | null {
  const expected = process.env.EXTENSION_API_KEY;
  if (!expected) {
    return extensionJson(
      req,
      { ok: false, error: 'Extension API is disabled — set EXTENSION_API_KEY on the server.' },
      503,
    );
  }
  const match = /^Bearer (.+)$/.exec(req.headers.get('authorization') ?? '');
  if (!match || !keysMatch(match[1], expected)) {
    return extensionJson(req, { ok: false, error: 'Invalid or missing API key.' }, 401);
  }
  return null;
}

/**
 * TAV-68: resolve which user an extension request acts as. The key gate above
 * authenticates the *extension*; this authenticates the *person* — the app
 * session cookie sent along with the request (the extension passes
 * credentials). Returns the signed-in user plus `denied: null`, or
 * `user: null` plus a ready-to-send 401 response when there is no session, so
 * data routes never leak into the __anon bucket or trigger requireUserId's
 * redirect from a route handler. Caller shape matches guardExtensionRequest:
 * `const { user, denied } = await requireExtensionUser(req); if (denied) return denied;`
 */
export async function requireExtensionUser(
  req: Request,
): Promise<{ user: SessionUser; denied: null } | { user: null; denied: NextResponse }> {
  const user = await getSessionUser();
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
