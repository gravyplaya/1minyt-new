/**
 * TAV-62: Music track video presentation.
 *
 * Every YouTube track is a video file, so "has a video" means "should the
 * /music page render the full 16:9 player, or the minimized audio-only bar?"
 * The answer is computed server-side, once per track, and shipped to the client
 * as `video_pref` + `video_pref_source` on MusicQueueItem — the client never
 * re-implements the heuristic.
 *
 * Decision order:
 *   1. `videos.video_pref` (user override, set from the Now Playing panel)
 *      — 'video' or 'audio', final.
 *   2. Heuristic signals on the cached video metadata:
 *      - Title sniff: "Official Video", "Official Music Video", "Music
 *        Video", "Visualizer" etc. → video; "Official Audio", "Lyric Video"
 *        → audio.
 *      - Channel sniff: VEVO/Records/"Official" channels publish real filmed
 *        videos (unless the title carries an audio-first marker).
 *      - Auto-generated "- Topic" channels are audio-first by construction.
 *      - yt categoryId 10 ("Music") covers BOTH audio and video uploads, so
 *        it can only break ties, never decide on its own.
 *   3. Default: audio — the music page's default presentation.
 */

import type { MusicVideoPref, MusicVideoPrefSource } from './types';

// ---------- Heuristic signal tables -------------------------------------------

/**
 * Title phrases that indicate a real filmed/produced music video. Checked
 * case-insensitively against the video title (and, as a last resort, tags).
 */
const VIDEO_SIGNALS = [
  'official music video',
  'official video',
  'music video',
  'official visualizer',
  'visualizer',
  'official performance',
  'live performance',
  'official film',
  'short film',
  'teaser',
  'trailer',
];

/** Title phrases that indicate audio-first uploads. Checked against video title. */
const AUDIO_TITLE_SIGNALS = [
  'official audio',
  'audio only',
  'lyric video',
  'lyric',
  'lyrics',
  'audio',
];

/**
 * Fallback when title/channel sniffing finds nothing. yt categoryId 10 is
 * "Music" for both audio and video uploads — it cannot separate them, so it
 * only breaks ties, and only toward video (for a non-Topic artist channel,
 * "Music category + no audio marker" slightly favours a real video).
 */
const MUSIC_CATEGORY_ID = 10;

/** The heuristic's guess for one track. */
export interface MusicVideoPresentation {
  pref: MusicVideoPref;
  source: MusicVideoPrefSource;
}

/**
 * How a track presents on /music: the user's `videos.video_pref` override when
 * set, otherwise the metadata heuristic, otherwise audio (the music page's
 * default presentation).
 */
export function computeMusicVideoPresentation(input: {
  title: string;
  channelTitle?: string | null;
  tags?: string | null;
  categoryId?: number | null;
  /** The user's stored override: null/undefined = none. */
  videoPref?: string | null;
}): MusicVideoPresentation {
  const { title, channelTitle, tags, categoryId, videoPref } = input;

  // 1. User override — final.
  if (videoPref === 'video' || videoPref === 'audio') {
    return { pref: videoPref, source: 'override' };
  }

  // 2. Heuristic on cached metadata.
  const heuristic = inferFromMetadata(title, channelTitle ?? null, tags ?? null, categoryId ?? null);
  if (heuristic !== null) {
    return { pref: heuristic, source: 'heuristic' };
  }

  // 3. Default — audio-first, per the music page's design.
  return { pref: 'audio', source: 'heuristic' };
}

/**
 * The metadata heuristic proper. Returns 'video' / 'audio', or null when no
 * signal matched (caller falls back to default-audio).
 */
function inferFromMetadata(
  title: string,
  channelTitle: string | null,
  tags: string | null,
  categoryId: number | null,
): MusicVideoPref | null {
  const t = (title ?? '').toLowerCase();
  const ch = (channelTitle ?? '').toLowerCase();
  const isTopicChannel = /\s-\s?topic$/.test(ch.trim());

  // Positive title signals → video.
  if (VIDEO_SIGNALS.some((s) => t.includes(s))) return 'video';

  // Audio-first title markers → audio. Checked before channel signals so an
  // "Official Audio" upload on a VEVO channel is still audio-first.
  const titleHasAudioMarker = AUDIO_TITLE_SIGNALS.some((s) => t.includes(s));
  if (titleHasAudioMarker) return 'audio';

  // Channel-name signals: VEVO-style channels publish real videos.
  if (/vevo/.test(ch) || /records/.test(ch) || /\bofficial\b/.test(ch)) return 'video';

  // Negative channel signal: auto-generated "- Topic" channels are audio-first
  // by construction (they exist to host auto-generated audio uploads).
  if (isTopicChannel) return 'audio';

  // Tiebreaker — see MUSIC_CATEGORY_ID.
  if (categoryId === MUSIC_CATEGORY_ID) return 'video';

  // Last resort: snippet.tags (sync stores them as a JSON array).
  if (tags) {
    try {
      const parsed: unknown = JSON.parse(tags);
      if (Array.isArray(parsed)) {
        const joined = parsed
          .filter((x): x is string => typeof x === 'string')
          .join(' ')
          .toLowerCase();
        if (VIDEO_SIGNALS.some((s) => joined.includes(s))) return 'video';
        if (AUDIO_TITLE_SIGNALS.some((s) => joined.includes(s))) return 'audio';
      }
    } catch {
      // Malformed JSON — ignore tags entirely.
    }
  }

  return null;
}
