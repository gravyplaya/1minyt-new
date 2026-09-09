/**
 * TAV-68a: Summarize-Later queue — POST /api/extension/queue
 * Body: `{ url | videoId, action?: 'add' | 'remove' }` (default 'add').
 * Auth: `Authorization: Bearer <EXTENSION_API_KEY>`.
 *
 * 'add' mirrors the "Summarize Later" button from the extension: it first
 * ensures the videos row exists (ingest-on-demand — `summarize_queue.video_id`
 * FKs to `videos`, and right-click → queue must work on videos we've never
 * seen), then enqueues. 'remove' mirrors the queue page's remove.
 */

import { addToQueueAction, removeFromQueueAction } from '@/app/actions';
import { getVideo } from '@/lib/video-repo';
import { ingestVideoById } from '@/lib/video-ingest';
import {
  extensionJson,
  extensionPreflight,
  guardExtensionRequest,
  resolveExtensionVideoId,
} from '@/lib/extension-api';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function POST(req: Request) {
  const denied = guardExtensionRequest(req);
  if (denied) return denied;

  let body: { url?: string; videoId?: string; action?: 'add' | 'remove' };
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
  const action = body.action === 'remove' ? 'remove' : 'add';

  try {
    if (action === 'remove') {
      const outcome = await removeFromQueueAction(videoId);
      return extensionJson(req, outcome, outcome.ok ? 200 : 400);
    }

    // Ingest-on-demand for videos the library has never seen.
    const existing = await getVideo(videoId);
    if (!existing) {
      const ingested = await ingestVideoById(videoId);
      if (!ingested.ok) {
        return extensionJson(
          req,
          { ok: false, videoId, queued: false, error: ingested.error ?? 'Failed to fetch the video.' },
          400,
        );
      }
    }

    const outcome = await addToQueueAction(videoId);
    return extensionJson(req, outcome, outcome.ok ? 200 : 400);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return extensionJson(req, { ok: false, error: msg }, 500);
  }
}

export async function OPTIONS(req: Request) {
  return extensionPreflight(req);
}
