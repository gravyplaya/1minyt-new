/**
 * TAV-68a: Save a YouTube video to the library — POST /api/extension/ingest
 * Body: `{ url }` or `{ videoId }`. Auth: `Authorization: Bearer
 * <EXTENSION_API_KEY>` + the app session cookie (TAV-68) — the save lands in
 * the signed-in user's library.
 *
 * The extension's "Save to 1minyt" button. Thin wrapper over the TAV-67 paste
 * flow (`processPastedUrlAction`): ingest metadata when uncached (Data API for
 * connected accounts, Innertube for anonymous), then fetch the transcript.
 * Never spends LLM tokens — summarization stays an explicit second call,
 * mirroring the paste flow's design. The session guard here keeps the action's
 * anonymous-tolerant fallback (__anon) for the web paste flow only — an
 * extension save must be visible in the user's library, so signed-out callers
 * get a friendly 401 instead of a silent anon-bucket save.
 */

import { processPastedUrlAction } from '@/app/actions';
import {
  extensionJson,
  extensionPreflight,
  guardExtensionRequest,
  requireExtensionUser,
  resolveExtensionVideoId,
} from '@/lib/extension-api';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function POST(req: Request) {
  const denied = guardExtensionRequest(req);
  if (denied) return denied;

  const { denied: noSession } = await requireExtensionUser(req);
  if (noSession) return noSession;

  let body: { url?: string; videoId?: string };
  try {
    body = await req.json();
  } catch {
    return extensionJson(req, { ok: false, error: 'Invalid JSON body.' }, 400);
  }

  const parsed = resolveExtensionVideoId(body);
  if (!parsed.ok || !parsed.videoId) {
    return extensionJson(req, { ok: false, error: parsed.error }, 400);
  }

  try {
    // A bare 11-char id round-trips through parseYouTubeUrl inside the action.
    const result = await processPastedUrlAction(parsed.videoId);
    return extensionJson(req, result, result.ok ? 200 : 400);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return extensionJson(req, { ok: false, error: msg }, 500);
  }
}

export async function OPTIONS(req: Request) {
  return extensionPreflight(req);
}
