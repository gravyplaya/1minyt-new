/**
 * AI chapter detection for TAV-13.
 *
 * Detects natural topic boundaries in a transcript by sampling the segment
 * list and asking an LLM to identify chapter starts with titles. The result
 * is a clickable chapter list rendered alongside the summary.
 *
 * Design choices:
 *  - We sample, not send the whole transcript. Every Nth segment's first
 *    ~200 chars keeps the prompt small and the LLM call cheap while still
 *    giving the model enough signal to spot topic shifts.
 *  - We send the segment's timestamp (mm:ss) alongside its text so the model
 *    returns timestamps that already align with the real transcript timeline.
 *  - We snap returned start times to the nearest actual segment start so the
 *    chapter links always jump to a real moment in the video.
 *  - Short transcripts (few segments) yield a single chapter or none — we
 *    never fabricate boundaries the content doesn't support.
 *
 * Reuses the OpenRouter chat/completions pattern from summarize.ts.
 */

import type { Chapter, TranscriptSegment } from './types';

export interface DetectChaptersInput {
  videoId: string;
  videoTitle: string;
  segments: TranscriptSegment[];
}

export interface DetectChaptersResult {
  chapters: Chapter[];
  model: string;
  prompt: string;
  tokenCount: number | null;
}

const OPENROUTER_BASE = 'https://openrouter.ai/api/v1';
// Reuse the same default model as the summarizer for consistency; override per
// deploy via CHAPTERS_MODEL in .env.
const DEFAULT_MODEL = process.env.CHAPTERS_MODEL?.trim() || process.env.SUMMARY_MODEL?.trim() || 'openrouter/free';

/** Send roughly every Nth segment to the LLM. */
const SAMPLE_EVERY_N = 5;
/** Cap chars per sampled segment so the prompt stays small. */
const SEG_CHAR_BUDGET = 200;
/** Hard cap on sampled transcript text sent to the model. */
const MAX_SAMPLE_CHARS = 12_000;
/** Minimum segments before we bother asking the model for chapters. */
const MIN_SEGMENTS_FOR_CHAPTERS = 8;
/** Minimum chapter gap — don't create chapters closer than this (ms). */
const MIN_CHAPTER_GAP_MS = 20_000;

export async function detectChapters(input: DetectChaptersInput): Promise<DetectChaptersResult> {
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) throw new Error('Missing OPENROUTER_API_KEY — set it in .env to enable chapter detection.');

  const { segments, videoTitle } = input;

  // Graceful handling for very short transcripts: one chapter covering the
  // whole video, or none at all.
  if (segments.length === 0) {
    return { chapters: [], model: DEFAULT_MODEL, prompt: '', tokenCount: null };
  }
  if (segments.length < MIN_SEGMENTS_FOR_CHAPTERS) {
    return {
      chapters: [{ title: truncateTitle(videoTitle) || 'Full video', startMs: segments[0].start_ms }],
      model: DEFAULT_MODEL,
      prompt: '',
      tokenCount: null,
    };
  }

  const sampled = sampleSegments(segments);
  const prompt = buildPrompt(videoTitle, sampled);

  const model = DEFAULT_MODEL;
  const body = {
    model,
    messages: [
      {
        role: 'system',
        content:
          'You are a video chapter editor. You receive sampled transcript lines with timestamps and identify natural topic boundaries. Return ONLY a JSON object. Never include prose outside the JSON.',
      },
      { role: 'user', content: prompt },
    ],
    temperature: 0.3,
    response_format: { type: 'json_object' },
  };

  const res = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`OpenRouter chat/completions failed (${res.status}): ${detail.slice(0, 400)}`);
  }

  const data = (await res.json()) as {
    choices: Array<{ message: { content: string } }>;
    usage?: { total_tokens?: number };
  };

  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error('OpenRouter returned an empty completion for chapter detection.');

  const rawChapters = parseChapters(content);
  const chapters = snapChapters(rawChapters, segments);

  return {
    chapters,
    model,
    prompt,
    tokenCount: data.usage?.total_tokens ?? null,
  };
}

// ----- helpers ---------------------------------------------------------------

/**
 * Sample the segment list: take every Nth segment, include its timestamp
 * (mm:ss) and the first ~200 chars of its text. Keeps the prompt compact.
 */
function sampleSegments(segments: TranscriptSegment[]): string[] {
  const lines: string[] = [];
  let totalChars = 0;
  for (let i = 0; i < segments.length; i += SAMPLE_EVERY_N) {
    const seg = segments[i];
    const tc = formatMmSs(seg.start_ms);
    const text = seg.text.slice(0, SEG_CHAR_BUDGET);
    const line = `[${tc}] ${text}`;
    if (totalChars + line.length > MAX_SAMPLE_CHARS) break;
    lines.push(line);
    totalChars += line.length;
  }
  return lines;
}

function buildPrompt(videoTitle: string, sampledLines: string[]): string {
  return [
    `Video title: ${videoTitle}`,
    '',
    'Below are sampled lines from this video\'s transcript, each prefixed with its timestamp (mm:ss). Identify the natural topic boundaries and produce a list of chapters.',
    '',
    'Transcript samples:',
    sampledLines.join('\n'),
    '',
    'Return a JSON object with exactly this key:',
    '- "chapters": an array of objects, each with "title" (a short, descriptive chapter title — 2-6 words, no timestamp prefix) and "start_ms" (the chapter start time in milliseconds, taken from one of the sampled timestamps above).',
    '',
    'Rules:',
    '- Include the first chapter starting at 0ms.',
    '- Aim for 3-8 chapters for a typical video; fewer if the video is short or covers a single topic.',
    '- Use the exact timestamp values shown in the samples for start_ms — do not invent timestamps.',
    '- Titles should describe the topic of the segment, not be generic ("Introduction", "Conclusion") unless that genuinely fits.',
  ].join('\n');
}

interface RawChapter {
  title?: unknown;
  start_ms?: unknown;
}

function parseChapters(content: string): { title: string; startMs: number }[] {
  let raw: { chapters?: unknown };
  try {
    raw = JSON.parse(content) as { chapters?: unknown };
  } catch {
    const match = content.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('Chapter detector returned non-JSON content.');
    raw = JSON.parse(match[0]) as { chapters?: unknown };
  }

  const arr = Array.isArray(raw.chapters) ? raw.chapters : [];
  const chapters: { title: string; startMs: number }[] = [];
  for (const item of arr) {
    if (!item || typeof item !== 'object') continue;
    const o = item as RawChapter;
    const title = typeof o.title === 'string' ? o.title.trim() : '';
    const startMs = typeof o.start_ms === 'number' ? o.start_ms : parseInt(String(o.start_ms), 10);
    if (!title || !Number.isFinite(startMs) || startMs < 0) continue;
    chapters.push({ title, startMs });
  }

  return chapters;
}

/**
 * Snap LLM-returned chapter start times to the nearest actual segment start,
 * dedupe chapters that land on the same segment, enforce a minimum gap, and
 * ensure the first chapter starts at 0ms.
 */
function snapChapters(raw: { title: string; startMs: number }[], segments: TranscriptSegment[]): Chapter[] {
  if (raw.length === 0) {
    return [{ title: 'Full video', startMs: segments[0].start_ms }];
  }

  // Sort by start time.
  const sorted = [...raw].sort((a, b) => a.startMs - b.startMs);

  const segmentStarts = segments.map(s => s.start_ms);

  const snapped: Chapter[] = [];
  for (const { title, startMs } of sorted) {
    const snappedMs = snapToNearest(startMs, segmentStarts);
    // Skip if too close to the previous chapter.
    if (snapped.length > 0 && snappedMs - snapped[snapped.length - 1].startMs < MIN_CHAPTER_GAP_MS) {
      continue;
    }
    // Skip duplicate timestamps.
    if (snapped.length > 0 && snappedMs === snapped[snapped.length - 1].startMs) {
      continue;
    }
    snapped.push({ title: truncateTitle(title), startMs: snappedMs });
  }

  // Ensure the first chapter starts at 0 (or the first segment's start).
  if (snapped.length === 0) {
    snapped.push({ title: 'Full video', startMs: segments[0].start_ms });
  } else if (snapped[0].startMs !== segments[0].start_ms) {
    snapped.unshift({ title: 'Introduction', startMs: segments[0].start_ms });
  }

  return snapped;
}

/** Find the segment start closest to the given timestamp. */
function snapToNearest(targetMs: number, segmentStarts: number[]): number {
  if (segmentStarts.length === 0) return targetMs;
  let best = segmentStarts[0];
  let bestDiff = Math.abs(targetMs - best);
  for (const start of segmentStarts) {
    const diff = Math.abs(targetMs - start);
    if (diff < bestDiff) {
      best = start;
      bestDiff = diff;
    }
  }
  return best;
}

/** Trim and cap chapter titles to keep the UI tidy. */
function truncateTitle(title: string): string {
  const t = title.trim();
  if (t.length <= 80) return t;
  return t.slice(0, 77).trimEnd() + '…';
}

/** Format milliseconds as mm:ss (or h:mm:ss for long videos). */
export function formatMmSs(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}
