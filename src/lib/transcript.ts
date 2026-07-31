/**
 * Transcript fetcher for TAV-4 (1-Click Instant Summaries).
 *
 * Strategy:
 *   1. Try YouTube's Innertube player API (ANDROID client) to resolve caption
 *      track URLs, then fetch the timedtext XML. The ANDROID client returns
 *      URLs with valid signatures that work from any IP — unlike the web
 *      client's embedded player response, which now hardcodes ip=0.0.0.0
 *      and returns 0-byte responses.
 *   2. Fall back to `yt-dlp --write-auto-sub` which writes a VTT file we parse.
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

export interface TranscriptResult {
  text: string;
  source: 'timedtext' | 'yt-dlp';
  /** Approx char count of the cleaned text — handy for truncation decisions. */
  length: number;
  /** Timestamped segments. Populated for XML (timedtext) and VTT (yt-dlp). */
  segments?: TranscriptSegment[];
}

/**
 * Fetch a transcript for a YouTube video. Returns null when no captions are
 * available (the video may be music-only, have no speech, or be region-blocked).
 */
export async function fetchTranscript(videoId: string): Promise<TranscriptResult | null> {
  // 1. Fast path: Innertube player API → timedtext XML.
  const direct = await fetchViaInnertube(videoId).catch(() => null);
  if (direct && direct.text.trim().length > 40) {
    return {
      text: direct.text,
      source: 'timedtext',
      length: direct.text.length,
      segments: direct.segments,
    };
  }

  // 2. yt-dlp fallback. Slower but handles more cases and languages.
  const viaYtDlp = await fetchViaYtDlp(videoId).catch(() => null);
  if (viaYtDlp && viaYtDlp.text.trim().length > 40) {
    return {
      text: viaYtDlp.text,
      source: 'yt-dlp',
      length: viaYtDlp.text.length,
      segments: viaYtDlp.segments,
    };
  }

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

  if (!resp.ok) return null;

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
  // XML rather than json3.
  const xml = await fetch(pick.baseUrl, {
    headers: { 'User-Agent': ANDROID_USER_AGENT },
  }).then(r => r.text());

  return parseTimedTextXml(xml);
}

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
    .replace(/&amp;/g, '&')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
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
