/**
 * Transcript fetcher for TAV-4 (1-Click Instant Summaries).
 *
 * Strategy:
 *   1. Try YouTube's timedtext API directly (zero quota, no download) — the same
 *      endpoint the web player uses. We fetch the auto-generated English caption
 *      track when one exists.
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
  /** Timestamped segments. Populated for json3 (timedtext) and VTT (yt-dlp). */
  segments?: TranscriptSegment[];
}

/**
 * Fetch a transcript for a YouTube video. Returns null when no captions are
 * available (the video may be music-only, have no speech, or be region-blocked).
 */
export async function fetchTranscript(videoId: string): Promise<TranscriptResult | null> {
  // 1. Fast path: direct timedtext. Cheap and usually sufficient for English content.
  const direct = await fetchViaTimedText(videoId).catch(() => null);
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

// ----- timedtext ------------------------------------------------------------

/**
 * Hit YouTube's internal timedtext endpoint. We resolve the caption track list
 * first, pick the first English track (manual or auto), then fetch its XML.
 *
 * This is the same mechanism the embedded player uses; it does not consume
 * YouTube Data API quota. It can break if YouTube changes the endpoint shape,
 * which is why we keep the yt-dlp fallback.
 */
async function fetchViaTimedText(videoId: string): Promise<ParsedTranscript | null> {
  // The most reliable entry point is the watch page's ytInitialPlayerResponse.
  const watchUrl = `https://www.youtube.com/watch?v=${videoId}`;
  const html = await fetch(watchUrl, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
      'Accept-Language': 'en-US,en;q=0.9',
    },
  }).then(r => r.text());

  // Extract captionTracks from the embedded player response.
  const tracks = extractCaptionTracks(html);
  if (tracks.length === 0) return null;

  // Prefer a manual English track, then auto English, then anything English-ish.
  const pick =
    tracks.find(t => t.languageCode.startsWith('en') && !t.kind) ??
    tracks.find(t => t.languageCode.startsWith('en')) ??
    tracks[0];
  if (!pick?.baseUrl) return null;

  const xml = await fetch(pick.baseUrl + '&fmt=json3').then(r => r.text());
  return parseJson3(xml);
}

interface CaptionTrack {
  baseUrl: string;
  languageCode: string;
  kind?: string; // "asr" = auto-generated
}

function extractCaptionTracks(html: string): CaptionTrack[] {
  // The player response nests captionTracks as a JSON array inside the page.
  const marker = '"captionTracks":';
  const idx = html.indexOf(marker);
  if (idx === -1) return [];
  // Find the array bounds.
  const start = html.indexOf('[', idx);
  if (start === -1) return [];
  let depth = 0;
  let end = start;
  for (let i = start; i < html.length; i++) {
    const ch = html[i];
    if (ch === '[') depth++;
    else if (ch === ']') {
      depth--;
      if (depth === 0) { end = i + 1; break; }
    }
  }
  try {
    const arr = JSON.parse(html.slice(start, end)) as CaptionTrack[];
    return arr.filter(t => t.baseUrl);
  } catch {
    return [];
  }
}

/** json3 format: { events: [{ segs: [{ utf8: "word" }] }] } */
interface Json3Event {
  tStartMs?: number;
  dDurationMs?: number;
  segs?: Array<{ utf8?: string }>;
}

interface ParsedTranscript {
  text: string;
  segments: TranscriptSegment[];
}

function parseJson3(json: string): ParsedTranscript {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return { text: '', segments: [] };
  }
  const events = (parsed as { events?: Json3Event[] }).events ?? [];
  const segments: TranscriptSegment[] = [];
  const lines: string[] = [];
  let segIndex = 0;
  for (const ev of events) {
    const segs = ev.segs ?? [];
    const line = segs.map(s => s.utf8 ?? '').join('').trim();
    if (!line) continue;
    const startMs = ev.tStartMs ?? 0;
    const endMs = ev.dDurationMs != null ? startMs + ev.dDurationMs : null;
    segments.push({ text: line, start_ms: startMs, end_ms: endMs, seg_index: segIndex++ });
    lines.push(line);
  }
  return { text: clean(lines.join(' ')), segments };
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
