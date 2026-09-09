/**
 * TAV-68a: Cross-video transcript search — GET /api/extension/search?q=<query>
 * Auth: `Authorization: Bearer <EXTENSION_API_KEY>` + the app session cookie
 * (TAV-68) — results come from the signed-in user's library.
 *
 * Wraps the TAV-10 index (`searchTranscriptsAction` → vector-store
 * `searchAcross`) so the extension popup can search the library from anywhere.
 * Returns the same TranscriptSearchResult rows the /search page renders.
 */

import { searchTranscriptsAction } from '@/app/actions';
import {
  extensionJson,
  extensionPreflight,
  guardExtensionRequest,
  requireExtensionUser,
} from '@/lib/extension-api';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const denied = guardExtensionRequest(req);
  if (denied) return denied;

  const { denied: noSession } = await requireExtensionUser(req);
  if (noSession) return noSession;

  const q = new URL(req.url).searchParams.get('q') ?? '';
  try {
    // The action trims and returns [] for an empty query — no special case here.
    const results = await searchTranscriptsAction(q);
    return extensionJson(req, { ok: true, query: q, results });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return extensionJson(req, { ok: false, error: msg }, 500);
  }
}

export async function OPTIONS(req: Request) {
  return extensionPreflight(req);
}
