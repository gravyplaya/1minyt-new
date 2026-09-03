/**
 * Transcript fetcher for TAV-4 (1-Click Instant Summaries).
 *
 * Strategy (fallback chain):
 *   1. Innertube ANDROID client → timedtext XML (primary, no API key, no
 *      binary dep, no rate limits).
 *   2. Supadata API → JSON transcript chunks (reliable hosted API with AI
 *      fallback for uncaptioned videos; requires SUPADATA_API_KEY).
 *   3. yt-dlp --write-auto-sub → VTT (age-restricted / consent-wall edge
 *      cases; requires system binary).
 *   4. Whisper speech-to-text (TAV-19; requires backend config).
 *
 * The transcript infrastructure here is reused by Chat-with-Video (TAV-3), so
 * the surface is deliberately narrow: `fetchTranscript(videoId) -> string|null`.
 *
 * We return a plain, timestamp-stripped text blob. The summarizer doesn't need
 * timing; keeping it text-only shrinks the prompt and avoids tokenizer noise.
 */

import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import type { TranscriptSegment } from './types';
import { transcribeWithWhisper, isWhisperEnabled } from './whisper';

export interface TranscriptResult {
  text: string;
  source: 'timedtext' | 'supadata' | 'yt-dlp' | 'whisper';
  /** Approx char count of the cleaned text — handy for truncation decisions. */
  length: number;
  /** Timestamped segments. Populated for all sources when available. */
  segments?: TranscriptSegment[];
}

/**
 * Fetch a transcript for a YouTube video. Returns null when no captions are
 * available (the video may be music-only, have no speech, or be region-blocked).
 */
export async function fetchTranscript(videoId: string): Promise<TranscriptResult | null> {
  // 1. Fast path: Innertube ANDROID client → timedtext XML. Free, no key,
  //    no rate limits. Handles the majority of captioned videos.
  const android = await fetchViaInnertube(videoId).catch(err => {
    console.warn(`fetchTranscript: Innertube failed for ${videoId}:`, err instanceof Error ? err.message : err);
    return null;
  });
  if (android && android.text.trim().length > 40) {
    return { text: android.text, source: 'timedtext', length: android.text.length, segments: android.segments };
  }

  // 2. Supadata API fallback. A hosted transcript service that covers videos
  //    where Innertube fails (UNPLAYABLE, empty bodies, age-restricted) and
  //    uncaptioned videos via its own AI transcription. Costs credits per
  //    request, so it sits after the free Innertube path.
  if (isSupadataEnabled()) {
    const viaSupadata = await fetchViaSupadata(videoId).catch(err => {
      console.warn(`fetchTranscript: Supadata failed for ${videoId}:`, err instanceof Error ? err.message : err);
      return null;
    });
    if (viaSupadata && viaSupadata.text.trim().length > 40) {
      return { text: viaSupadata.text, source: 'supadata', length: viaSupadata.text.length, segments: viaSupadata.segments };
    }
  } else {
    // Only reachable when Innertube already failed — exactly the situation where
    // a missing key silently narrows the fallback chain (e.g. on Netlify, where
    // Innertube often fails from datacenter IPs and yt-dlp doesn't exist).
    console.warn(`fetchTranscript: Supadata skipped for ${videoId} — SUPADATA_API_KEY not configured.`);
  }

  // 3. yt-dlp fallback. Handles age-restricted / consent-wall edge cases that
  //    even Supadata might miss. Requires the system binary.
  const viaYtDlp = await fetchViaYtDlp(videoId).catch(err => {
    console.warn(`fetchTranscript: yt-dlp failed for ${videoId}:`, err instanceof Error ? err.message : err);
    return null;
  });
  if (viaYtDlp && viaYtDlp.text.trim().length > 40) {
    return { text: viaYtDlp.text, source: 'yt-dlp', length: viaYtDlp.text.length, segments: viaYtDlp.segments };
  }

  // 4. Whisper speech-to-text fallback (TAV-19). Last resort for uncaptioned
  //    videos when no other path produced text. Requires a backend config.
  if (isWhisperEnabled()) {
    const viaWhisper = await transcribeWithWhisper(videoId).catch(err => {
      console.warn(`fetchTranscript: Whisper fallback failed for ${videoId}:`, err instanceof Error ? err.message : err);
      return null;
    });
    if (viaWhisper && viaWhisper.text.trim().length > 40) {
      return { text: viaWhisper.text, source: 'whisper', length: viaWhisper.text.length, segments: viaWhisper.segments };
    }
  }

  console.warn(`fetchTranscript: all strategies exhausted for ${videoId}, returning null.`);
  return null;
}

// ----- Innertube player API ---------------------------------------------------

/**
 * Well-known YouTube Innertube API key for the web client. This is the same
 * key embedded in every YouTube watch page; it is not a secret.
 */
const INNERTUBE_API_KEY = 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8';
const INNERTUBE_PLAYER_URL = `https://www.youtube.com/youtubei/v1/player?key=${INNERTUBE_API_KEY}`;

/**
 * The ANDROID client is used because it returns caption track URLs with valid
 * IP-agnostic signatures. The web client's embedded player response now
 * hardcodes ip=0.0.0.0 in the baseUrl, causing YouTube to return 0-byte
 * responses for every video.
 */
const ANDROID_USER_AGENT = 'com.google.android.youtube/20.10.38 (Linux; U; Android 11) gzip';

interface InnertubeCaptionTrack {
  baseUrl: string;
  languageCode: string;
  kind?: string; // "asr" = auto-generated
}

interface ParsedTranscript {
  text: string;
  segments: TranscriptSegment[];
}

/**
 * Call the Innertube player API with the ANDROID client to resolve caption
 * tracks, then fetch and parse the timedtext XML for the best English track.
 *
 * This does not consume YouTube Data API quota. The ANDROID client is less
 * restrictive than the web client and returns working caption URLs.
 */
async function fetchViaInnertube(videoId: string): Promise<ParsedTranscript | null> {
  const payload = {
    context: {
      client: {
        clientName: 'ANDROID',
        clientVersion: '20.10.38',
        androidSdkVersion: 30,
        osName: 'Android',
        osVersion: '11',
        platform: 'MOBILE',
      },
    },
    videoId,
  };

  const resp = await fetch(INNERTUBE_PLAYER_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': ANDROID_USER_AGENT,
      'Accept-Language': 'en-US,en;q=0.9',
    },
    body: JSON.stringify(payload),
  });

  if (!resp.ok) {
    console.warn(`fetchViaInnertube: player API HTTP ${resp.status} for ${videoId}`);
    return null;
  }

  const data = (await resp.json()) as {
    playabilityStatus?: { status?: string; reason?: string };
    captions?: {
      playerCaptionsTracklistRenderer?: {
        captionTracks?: InnertubeCaptionTrack[];
      };
    };
  };

  // Video may be unplayable (private, deleted, region-blocked, age-restricted).
  const status = data.playabilityStatus?.status;
  if (status !== 'OK') return null;

  const tracks = data.captions?.playerCaptionsTracklistRenderer?.captionTracks;
  if (!tracks || tracks.length === 0) return null;

  // Prefer a manual English track, then auto English, then anything English-ish.
  const pick =
    tracks.find(t => t.languageCode.startsWith('en') && !t.kind) ??
    tracks.find(t => t.languageCode.startsWith('en')) ??
    tracks[0];
  if (!pick?.baseUrl) return null;

  // The ANDROID client returns format=3 XML regardless of &fmt=, so we parse
  // XML rather than json3. Retry once on empty body — YouTube occasionally
  // returns 0-byte responses due to transient signature/caching issues.
  const xml = await fetchCaptionXml(pick.baseUrl, ANDROID_USER_AGENT);
  if (!xml) return null;

  return parseTimedTextXml(xml);
}

/**
 * Fetch a caption track URL and return the body text. Retries once on empty
 * response — YouTube's timedtext CDN occasionally returns 200 with a 0-byte
 * body due to transient signature or cache issues, and a second request
 * typically succeeds.
 */
async function fetchCaptionXml(baseUrl: string, userAgent: string): Promise<string | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const resp = await fetch(baseUrl, {
      headers: { 'User-Agent': userAgent },
      signal: AbortSignal.timeout(15_000),
    }).catch(() => null);

    if (!resp || !resp.ok) {
      if (attempt === 0) continue;
      return null;
    }

    const body = await resp.text().catch(() => '');
    // YouTube sometimes returns 200 with an empty body — retry once.
    if (body.trim().length === 0 && attempt === 0) continue;
    return body;
  }
  return null;
}

// ----- Supadata API ----------------------------------------------------------

const SUPADATA_BASE = 'https://api.supadata.ai/v1';

/** Whether the Supadata API key is configured. */
function isSupadataEnabled(): boolean {
  return !!process.env.SUPADATA_API_KEY?.trim();
}

/**
 * Fetch a transcript via the Supadata API. This is a hosted service that
 * resolves YouTube captions (and falls back to AI transcription for
 * uncaptioned videos) — covering videos where Innertube returns UNPLAYABLE
 * or an empty caption body.
 *
 * API: GET /youtube/transcript?videoId=…&lang=en
 * Returns { content: [{text, offset, duration, lang}, …], lang, availableLangs }
 * or an error (206 = transcript-unavailable, 404 = not found, etc.).
 *
 * We request the chunked format (not `text=true`) so we get timestamps for
 * chapter detection and chat citations.
 */
async function fetchViaSupadata(videoId: string): Promise<ParsedTranscript | null> {
  const apiKey = process.env.SUPADATA_API_KEY!.trim();
  const url = `${SUPADATA_BASE}/youtube/transcript?videoId=${encodeURIComponent(videoId)}&lang=en`;

  const resp = await fetch(url, {
    headers: {
      'x-api-key': apiKey,
      'Content-Type': 'application/json',
    },
    signal: AbortSignal.timeout(30_000),
  });

  // 206 = transcript-unavailable, 404 = not found — treat as "no transcript".
  if (resp.status === 206 || resp.status === 404) return null;
  if (!resp.ok) {
    const detail = await resp.text().catch(() => '');
    throw new Error(`Supadata API ${resp.status}: ${detail.slice(0, 300)}`);
  }

  const data = (await resp.json()) as {
    content?: Array<{ text: string; offset: number; duration: number; lang: string }>;
    lang?: string;
    availableLangs?: string[];
  };

  if (!Array.isArray(data.content) || data.content.length === 0) return null;

  const segments: TranscriptSegment[] = [];
  const lines: string[] = [];

  for (let i = 0; i < data.content.length; i++) {
    const chunk = data.content[i];
    const text = chunk.text.replace(/\s+/g, ' ').trim();
    if (!text) continue;
    const startMs = Math.round(chunk.offset);
    const endMs = startMs + Math.round(chunk.duration);
    segments.push({ text, start_ms: startMs, end_ms: endMs, seg_index: i });
    lines.push(text);
  }

  const text = clean(lines.join(' '));
  if (text.length < 40) return null;

  return { text, segments };
}

// ----- XML parsing -----------------------------------------------------------

/**
 * Parse YouTube's timedtext format=3 XML.
 *
 * Two variants exist:
 *   - Manual captions: <p t="1360" d="1680">text here</p>
 *     Text is a direct child of <p>.
 *   - Auto-generated captions: <p t="0" d="4240"><s>Are</s><s t="200"> you</s></p>
 *     Words are in <s> children of <p>.
 *
 * We extract <p> elements with regex, then for each one check whether it
 * contains <s> children (auto-generated) or has direct text (manual). This
 * avoids needing a DOM library — YouTube's timedtext XML is well-structured
 * and doesn't nest <p> tags.
 */
function parseTimedTextXml(xml: string): ParsedTranscript {
  const segments: TranscriptSegment[] = [];
  const lines: string[] = [];
  let segIndex = 0;

  // Match all <p ...>...</p> elements. The format is predictable enough that
  // a greedy match up to </p> works — <p> tags are never nested in timedtext.
  const pRegex = /<p\s+([^>]*)>([\s\S]*?)<\/p>/g;
  let match: RegExpExecArray | null;

  while ((match = pRegex.exec(xml)) !== null) {
    const attrs = match[1];
    const inner = match[2];

    // Extract t (start ms) and d (duration ms) from attributes.
    const tMatch = attrs.match(/\bt="(\d+)"/);
    const dMatch = attrs.match(/\bd="(\d+)"/);
    const startMs = tMatch ? parseInt(tMatch[1], 10) : 0;
    const endMs = dMatch ? startMs + parseInt(dMatch[1], 10) : null;

    // Collect text from <s> children (auto-generated), or use direct text (manual).
    const sMatches = inner.match(/<s(?:\s[^>]*)?>([^<]*)<\/s>/g);
    let line: string;
    if (sMatches && sMatches.length > 0) {
      // Extract text content from each <s> tag.
      const words = sMatches.map(s => {
        const m = s.match(/<s(?:\s[^>]*)?>([^<]*)<\/s>/);
        return m ? m[1] : '';
      });
      line = words.join(' ');
    } else {
      // Manual caption: text is direct child of <p>, strip any inline tags.
      line = inner.replace(/<[^>]+>/g, '');
    }

    // Decode XML entities, collapse whitespace.
    line = decodeXmlEntities(line)
      .replace(/\n/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!line) continue;

    segments.push({ text: line, start_ms: startMs, end_ms: endMs, seg_index: segIndex++ });
    lines.push(line);
  }

  return { text: clean(lines.join(' ')), segments };
}

/** Decode the handful of XML entities YouTube uses in timedtext. */
function decodeXmlEntities(s: string): string {
  return s
    .replace(/&#39;/g, "'")
    .replace(/"/g, '"')
    .replace(/</g, '<')
    .replace(/>/g, '>')
    .replace(/&/g, '&');
}

// ----- yt-dlp fallback -------------------------------------------------------

async function fetchViaYtDlp(videoId: string): Promise<ParsedTranscript | null> {
  const outDir = fs.mkdtempSync(path.join(tmpdir(), '1minyt-subs-'));
  const outTpl = path.join(outDir, '%(id)s');
  const url = `https://www.youtube.com/watch?v=${videoId}`;

  try {
    // Prefer manual subs, fall back to auto-generated. Write as vtt.
    await runYtDlp([
      '--skip-download',
      '--write-sub', '--write-auto-sub',
      '--sub-lang', 'en,en-US,en-GB',
      '--sub-format', 'vtt',
      '--no-playlist',
      '--quiet', '--no-warnings',
      '-o', outTpl,
      url,
    ]);

    // Find the produced vtt file.
    const files = fs.readdirSync(outDir).filter(f => f.endsWith('.vtt'));
    if (files.length === 0) return null;
    // Prefer the manual sub over the auto one when both exist.
    files.sort((a, b) => Number(/\.en\./.test(a) && /\.en\./.test(b) ? 0 : /\.en\./.test(a) ? -1 : 1));
    const vtt = fs.readFileSync(path.join(outDir, files[0]), 'utf8');
    return parseVtt(vtt);
  } finally {
    fs.rmSync(outDir, { recursive: true, force: true });
  }
}

function runYtDlp(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('yt-dlp', args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr?.on('data', d => { stderr += d.toString(); });
    child.on('error', reject);
    child.on('close', code => {
      if (code === 0) resolve();
      else reject(new Error(`yt-dlp exited ${code}: ${stderr.slice(0, 500)}`));
    });
  });
}

/** Strip VTT timestamps, cue headers, and duplicate cue lines. Returns segments with timing. */
function parseVtt(vtt: string): ParsedTranscript {
  const lines = vtt.split(/\r?\n/);
  const segments: TranscriptSegment[] = [];
  const seen = new Set<string>();
  let segIndex = 0;
  let pendingStart = 0;
  let pendingEnd: number | null = null;
  let pendingLines: string[] = [];

  const flush = () => {
    const text = pendingLines.join(' ').replace(/\s+/g, ' ').trim();
    if (text && !seen.has(text)) {
      seen.add(text);
      segments.push({ text, start_ms: pendingStart, end_ms: pendingEnd, seg_index: segIndex++ });
    }
    pendingLines = [];
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      flush();
      continue;
    }
    if (/^WEBVTT/.test(line)) continue;
    if (/^NOTE/.test(line)) continue;
    if (/^STYLE/.test(line)) continue;
    if (/^[0-9]+$/.test(line)) continue;       // cue index
    // Cue timestamp line: "00:00:01.000 --> 00:00:03.500"
    const tsMatch = line.match(/^([\d:.]+)\s*-->\s*([\d:.]+)/);
    if (tsMatch) {
      flush();
      pendingStart = parseVttTimecode(tsMatch[1]);
      pendingEnd = parseVttTimecode(tsMatch[2]);
      continue;
    }
    // Strip inline tags like <00:00:01.000> and <c> formatting.
    const cleaned = line.replace(/<[^>]+>/g, '').trim();
    if (!cleaned) continue;
    if (pendingEnd === null) {
      // No timestamp seen yet — skip header noise.
      continue;
    }
    pendingLines.push(cleaned);
  }
  flush();

  // If we never captured timing (malformed VTT), fall back to text-only.
  if (segments.length === 0) {
    return { text: '', segments: [] };
  }

  const text = clean(segments.map(s => s.text).join(' '));
  return { text, segments };
}

/** Parse a VTT timecode like "00:01:23.456" or "01:23.456" into milliseconds. */
function parseVttTimecode(tc: string): number {
  const parts = tc.split(':');
  let h = 0, m = 0, s = 0;
  if (parts.length === 3) {
    h = Number(parts[0]) || 0;
    m = Number(parts[1]) || 0;
    s = Number(parts[2]) || 0;
  } else if (parts.length === 2) {
    m = Number(parts[0]) || 0;
    s = Number(parts[1]) || 0;
  }
  return Math.round((h * 3600 + m * 60 + s) * 1000);
}

// ----- shared cleanup --------------------------------------------------------

/** Collapse whitespace and drop stray control chars. */
function clean(s: string): string {
  return s
    .replace(/\u0000/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
