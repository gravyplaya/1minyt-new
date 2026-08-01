/**
 * Whisper speech-to-text fallback for uncaptioned videos (TAV-19).
 *
 * When YouTube has no captions (Innertube + yt-dlp both return nothing — about
 * 40% of videos), this downloads the audio stream with yt-dlp and runs it
 * through a Whisper transcription backend. The result is a plain-text
 * transcript that feeds into the same summary / chat / chapter pipeline as a
 * captioned transcript — everything downstream only needs text + segments.
 *
 * Two interchangeable backends, selected by env vars:
 *
 *   1. OpenAI Whisper API (cloud) — `OPENAI_API_KEY` set.
 *      POST /audio/transcriptions with the audio file. Simple, no local model
 *      install, costs a fraction of a cent per video. Returns text (+ optional
 *      verbose_json segments).
 *
 *   2. whisper.cpp (self-hosted) — `WHISPER_CPP_BINARY` set to a whisper.cpp
 *      `main` (or `whisper-cli`) executable, plus `WHISPER_MODEL_PATH` pointing
 *      at a .bin model file. Runs fully offline on CPU/GPU. Used when no
 *      OpenAI key is configured or when the operator prefers self-hosting.
 *
 * If neither is configured, `transcribe` returns null and the caller treats
 * the video as captionless (status 'unavailable'), exactly as before — so the
 * feature is strictly opt-in and degrades gracefully.
 *
 * Audio download notes:
 *   - yt-dlp extracts the smallest audio-only stream (bestaudio → m4a/webm).
 *   - We cap duration at 2 hours (7200s) to bound cost; longer videos are
 *     skipped with a null result rather than silently truncating content.
 *   - The audio file is written to a temp dir that is removed on completion.
 */

import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import type { TranscriptSegment } from './types';

/** A transcript produced by Whisper — text plus optional timed segments. */
export interface WhisperTranscript {
  text: string;
  segments?: TranscriptSegment[];
}

/** Max audio duration we'll transcribe, in seconds. Longer videos are skipped. */
const MAX_DURATION_SECONDS = 2 * 60 * 60;

/** OpenAI Whisper API endpoint. */
const OPENAI_WHISPER_URL = 'https://api.openai.com/v1/audio/transcriptions';

/**
 * Transcribe a YouTube video's audio with Whisper. Returns null when no
 * backend is configured, the video is too long, or transcription fails — the
 * caller treats null as "no transcript available".
 *
 * @param videoId 11-char YouTube video id.
 */
export async function transcribeWithWhisper(videoId: string): Promise<WhisperTranscript | null> {
  const backend = pickBackend();
  if (!backend) return null;

  const outDir = fs.mkdtempSync(path.join(tmpdir(), '1minyt-whisper-'));
  try {
    const audioPath = await downloadAudio(videoId, outDir).catch(() => null);
    if (!audioPath) return null;

    const result = await backend.transcribe(audioPath).catch(err => {
      console.error('Whisper transcription failed:', err instanceof Error ? err.message : err);
      return null;
    });
    return result;
  } finally {
    fs.rmSync(outDir, { recursive: true, force: true });
  }
}

/** Whether any Whisper backend is configured. Used by the caller to decide
 *  whether the whisper fallback is even worth attempting. */
export function isWhisperEnabled(): boolean {
  return pickBackend() !== null;
}

// ----- backend dispatch -----------------------------------------------------

interface WhisperBackend {
  name: 'openai' | 'whisper.cpp';
  transcribe: (audioPath: string) => Promise<WhisperTranscript | null>;
}

function pickBackend(): WhisperBackend | null {
  if (process.env.OPENAI_API_KEY?.trim()) {
    return { name: 'openai', transcribe: transcribeViaOpenAI };
  }
  const bin = process.env.WHISPER_CPP_BINARY?.trim();
  const model = process.env.WHISPER_MODEL_PATH?.trim();
  if (bin && model) {
    return { name: 'whisper.cpp', transcribe: (p) => transcribeViaWhisperCpp(p, bin, model) };
  }
  return null;
}

// ----- audio download --------------------------------------------------------

/**
 * Download the best audio-only stream via yt-dlp into `outDir`. Returns the
 * absolute path to the produced file, or null if the video is too long or no
 * audio stream could be extracted.
 */
async function downloadAudio(videoId: string, outDir: string): Promise<string | null> {
  const outTpl = path.join(outDir, 'audio.%(ext)s');
  const url = `https://www.youtube.com/watch?v=${videoId}`;

  // First, check duration via a quick --dump-json (no download) so we can skip
  // overlong videos before spending bandwidth on the audio.
  const meta = await runYtDlpJson([
    '--dump-json',
    '--no-playlist',
    '--quiet', '--no-warnings',
    url,
  ]).catch(() => null);

  if (meta?.duration && meta.duration > MAX_DURATION_SECONDS) {
    console.warn(`Whisper: skipping ${videoId} — duration ${meta.duration}s exceeds ${MAX_DURATION_SECONDS}s cap.`);
    return null;
  }

  await runYtDlp([
    '-x',                        // audio-only extract
    '--audio-format', 'm4a',     // normalize container; whisper accepts m4a
    '--audio-quality', '5',      // 0 (best) .. 10 (worst); 5 keeps files small
    '--no-playlist',
    '--quiet', '--no-warnings',
    '-o', outTpl,
    url,
  ]);

  const files = fs.readdirSync(outDir).filter(f => f.startsWith('audio.'));
  if (files.length === 0) return null;
  return path.join(outDir, files[0]);
}

// ----- OpenAI Whisper API backend -------------------------------------------

async function transcribeViaOpenAI(audioPath: string): Promise<WhisperTranscript | null> {
  const apiKey = process.env.OPENAI_API_KEY!.trim();
  const filename = path.basename(audioPath);

  // Stream the file off disk via fs.openAsBlob (Node ≥19) rather than buffering
  // the whole audio into memory with readFileSync. A 2-hour clip at quality 5
  // can be 50–100 MB; holding that in a single server-action allocation is
  // risky under concurrent summarise runs, and the OpenAI endpoint accepts a
  // Blob-backed form field without needing the bytes resident.
  const fileBlob = await fs.openAsBlob(audioPath);

  // Request verbose_json so we get segment timestamps for chat citations.
  const form = new FormData();
  form.append('file', fileBlob, filename);
  form.append('model', process.env.WHISPER_MODEL?.trim() || 'whisper-1');
  form.append('response_format', 'verbose_json');

  const res = await fetch(OPENAI_WHISPER_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`OpenAI Whisper API failed (${res.status}): ${detail.slice(0, 400)}`);
  }

  const data = (await res.json()) as {
    text?: string;
    segments?: Array<{ start: number; end?: number; text: string }>;
  };

  const text = (data.text ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return null;

  const segments: TranscriptSegment[] | undefined = Array.isArray(data.segments)
    ? data.segments
        .map((s, i) => ({
          text: s.text.replace(/\s+/g, ' ').trim(),
          start_ms: Math.round(s.start * 1000),
          end_ms: s.end != null ? Math.round(s.end * 1000) : null,
          seg_index: i,
        }))
        .filter(s => s.text.length > 0)
    : undefined;

  return { text, segments };
}

// ----- whisper.cpp (self-hosted) backend ------------------------------------

async function transcribeViaWhisperCpp(
  audioPath: string,
  binary: string,
  modelPath: string,
): Promise<WhisperTranscript | null> {
  const outDir = path.dirname(audioPath);
  const base = path.join(outDir, 'transcript');

  // whisper-cli/main -m model -f audio -osrt -of base  →  base.srt
  await new Promise<void>((resolve, reject) => {
    const args = [
      '-m', modelPath,
      '-f', audioPath,
      '-osrt',
      '-of', base,
      '--no-prints',
    ];
    const child = spawn(binary, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr?.on('data', d => { stderr += d.toString(); });
    child.on('error', reject);
    child.on('close', code => {
      if (code === 0) resolve();
      else reject(new Error(`whisper.cpp exited ${code}: ${stderr.slice(0, 500)}`));
    });
  });

  const srtPath = `${base}.srt`;
  if (!fs.existsSync(srtPath)) return null;
  const srt = fs.readFileSync(srtPath, 'utf8');
  return parseSrt(srt);
}

/** Parse an SRT subtitle file into text + timed segments. */
function parseSrt(srt: string): WhisperTranscript {
  const segments: TranscriptSegment[] = [];
  const lines: string[] = [];
  let segIndex = 0;
  const blocks = srt.split(/\r?\n\r?\n/);

  for (const block of blocks) {
    const linesOf = block.split(/\r?\n/).filter(Boolean);
    if (linesOf.length < 2) continue;

    // SRT block: index, timecode, one-or-more text lines.
    const tsLine = linesOf.find(l => l.includes('-->'));
    if (!tsLine) continue;
    const tsMatch = tsLine.match(/^([\d:,]+)\s*-->\s*([\d:,]+)/);
    if (!tsMatch) continue;
    const startMs = parseSrtTimecode(tsMatch[1]);
    const endMs = parseSrtTimecode(tsMatch[2]);

    const textLines = linesOf.filter(l => l !== linesOf[0] && l !== tsLine);
    const text = textLines.join(' ').replace(/\s+/g, ' ').trim();
    if (!text) continue;

    segments.push({ text, start_ms: startMs, end_ms: endMs, seg_index: segIndex++ });
    lines.push(text);
  }

  return { text: lines.join(' '), segments };
}

/** Parse an SRT timecode "HH:MM:SS,mmm" into milliseconds. */
function parseSrtTimecode(tc: string): number {
  const parts = tc.split(':');
  let h = 0, m = 0, s = 0;
  if (parts.length === 3) {
    h = Number(parts[0]) || 0;
    m = Number(parts[1]) || 0;
    s = Number(parts[2].replace(',', '.')) || 0;
  } else if (parts.length === 2) {
    m = Number(parts[0]) || 0;
    s = Number(parts[1].replace(',', '.')) || 0;
  }
  return Math.round((h * 3600 + m * 60 + s) * 1000);
}

// ----- shared yt-dlp runner -------------------------------------------------

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

/** Run yt-dlp --dump-json and parse the first JSON line. */
async function runYtDlpJson(args: string[]): Promise<{ duration?: number } | null> {
  return new Promise((resolve, reject) => {
    const child = spawn('yt-dlp', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', d => { stdout += d.toString(); });
    child.stderr?.on('data', d => { stderr += d.toString(); });
    child.on('error', reject);
    child.on('close', code => {
      if (code !== 0) return reject(new Error(`yt-dlp --dump-json exited ${code}: ${stderr.slice(0, 500)}`));
      const line = stdout.split(/\r?\n/).find(Boolean);
      if (!line) return resolve(null);
      try {
        resolve(JSON.parse(line) as { duration?: number });
      } catch {
        resolve(null);
      }
    });
  });
}
