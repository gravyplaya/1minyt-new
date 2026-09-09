/**
 * TAV-68a: Library state for one video — GET /api/extension/video?id=<videoId>
 * Auth: `Authorization: Bearer <EXTENSION_API_KEY>` + the app session cookie
 * (TAV-68) — the badge reflects the signed-in user's library.
 *
 * Lets the extension badge the YouTube watch page (Saved? Summarized?) and
 * render the cached summary without re-running anything. The transcript text
 * and the LLM prompt are deliberately dropped — heavy, and the extension has
 * no use for them (the search endpoint surfaces snippets).
 *
 * A video not in the library is `ok: true, saved: false` — a state, not an
 * error, so the extension can badge "not saved yet".
 */

import { getVideoWithSummary } from '@/lib/video-repo';
import {
  extensionJson,
  extensionPreflight,
  extensionSummary,
  guardExtensionRequest,
  requireExtensionUser,
} from '@/lib/extension-api';

export const dynamic = 'force-dynamic';

const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;

export async function GET(req: Request) {
  const denied = guardExtensionRequest(req);
  if (denied) return denied;

  const { user, denied: noSession } = await requireExtensionUser(req);
  if (noSession) return noSession;

  const videoId = new URL(req.url).searchParams.get('id')?.trim() ?? '';
  if (!VIDEO_ID_RE.test(videoId)) {
    return extensionJson(req, { ok: false, error: 'Missing or invalid video id.' }, 400);
  }

  try {
    const video = await getVideoWithSummary(user.id, videoId);
    if (!video) {
      return extensionJson(req, { ok: true, saved: false, video: null, summary: null, chapters: null });
    }

    return extensionJson(req, {
      ok: true,
      saved: true,
      video: {
        videoId: video.video_id,
        channelId: video.channel_id,
        title: video.title,
        thumbnailUrl: video.thumbnail_url,
        durationSeconds: video.duration_seconds,
        publishedAt: video.published_at,
        transcriptStatus: video.transcript_status,
        transcriptSource: video.transcript_source,
        isLive: video.is_live === 1,
      },
      summary: extensionSummary(video.summary),
      chapters: video.chapters,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return extensionJson(req, { ok: false, error: msg }, 500);
  }
}

export async function OPTIONS(req: Request) {
  return extensionPreflight(req);
}
