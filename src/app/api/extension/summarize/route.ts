/**
 * TAV-68a: Save + summarize in one shot — POST /api/extension/summarize
 * Body: `{ url }` or `{ videoId }`. Auth: `Authorization: Bearer
 * <EXTENSION_API_KEY>` + the app session cookie (TAV-68) — tokens are spent
 * on the signed-in user's copy of the video.
 *
 * Chains the two explicit UI steps into the extension's ⚡ button: the TAV-67
 * paste flow (ingest + transcript), then `summarizeVideoAction` (LLM summary +
 * chapters + community pulse + summary indexing). An already-summarized video
 * short-circuits to the cached summary — the extension never double-spends
 * tokens. A video without a transcript fails with the same "no captions"
 * state the /watch page surfaces.
 */

import { processPastedUrlAction, summarizeVideoAction } from '@/app/actions';
import { getVideoWithSummary } from '@/lib/video-repo';
import {
  extensionJson,
  extensionPreflight,
  extensionSummary,
  guardExtensionRequest,
  requireExtensionUser,
  resolveExtensionVideoId,
} from '@/lib/extension-api';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function POST(req: Request) {
  const denied = guardExtensionRequest(req);
  if (denied) return denied;

  const { user, denied: noSession } = await requireExtensionUser(req);
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
  const videoId = parsed.videoId;

  try {
    // Stage 1: ingest + transcript (cached runs return immediately).
    const staged = await processPastedUrlAction(videoId);
    if (!staged.ok) {
      return extensionJson(req, { ok: false, videoId, error: staged.error }, 400);
    }

    // Paste-flow ok:true + warning means the transcript is unavailable —
    // there is nothing to summarize.
    if (staged.transcriptStatus !== 'fetched') {
      return extensionJson(
        req,
        { ok: false, videoId, error: staged.warning ?? 'No transcript available for this video.' },
        422,
      );
    }

    // Cached summary — return it without touching the LLM.
    if (staged.alreadySummarized) {
      const video = await getVideoWithSummary(user.id, videoId);
      return extensionJson(req, {
        ok: true,
        videoId,
        cached: true,
        summary: extensionSummary(video?.summary ?? null),
        chapters: video?.chapters ?? null,
      });
    }

    // Stage 2: summarize (also detects chapters + community pulse).
    const outcome = await summarizeVideoAction(videoId);
    if (!outcome.ok) {
      return extensionJson(req, { ok: false, videoId, error: outcome.error }, 400);
    }

    return extensionJson(req, {
      ok: true,
      videoId,
      cached: false,
      summary: extensionSummary(outcome.summary ?? null),
      chapters: outcome.chapters ?? null,
      communityPulse: outcome.communityPulse ?? null,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return extensionJson(req, { ok: false, error: msg }, 500);
  }
}

export async function OPTIONS(req: Request) {
  return extensionPreflight(req);
}
