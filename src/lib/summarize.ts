/**
 * LLM summarizer for TAV-4 (1-Click Instant Summaries).
 *
 * Sends the transcript to OpenRouter's `/chat/completions` endpoint with a
 * strict JSON-object response format. The schema is enforced via prompt +
 * json_object mode; the parser tolerates fences and partial output.
 *
 * OpenRouter is the default because it's already wired into this environment
 * and is OpenAI-compatible; swapping to OpenAI/Anthropic later only changes the
 * URL + auth header.
 *
 * Cost / latency notes:
 *   - We cap the transcript to ~24k chars before sending. That's enough for a
 *     ~30-45 min video and keeps the prompt well under context limits.
 *   - We ask for a compact JSON object, no prose preamble, to keep token usage
 *     predictable.
 */

import type { FollowUp } from './types';

export interface SummarizeInput {
  videoId: string;
  videoTitle: string;
  channelTitle: string;
  transcript: string;
  /** Recent uploads from the same channel, for the follow-ups recommendation. */
  recentUploads: { video_id: string; title: string }[];
}

export interface SummarizeResult {
  tldr: string;
  keyPoints: string[];
  followUps: FollowUp[];
  /** 2–5 short topic tags extracted from the transcript (lowercase). */
  topics: string[];
  model: string;
  prompt: string;
  tokenCount: number | null;
}

const OPENROUTER_BASE = 'https://openrouter.ai/api/v1';
// Default to a free text model with reliable json_object output.
// Override per-deploy via SUMMARY_MODEL in .env.
const DEFAULT_MODEL = process.env.SUMMARY_MODEL?.trim() || 'openai/gpt-oss-20b:free';
const MAX_TRANSCRIPT_CHARS = 24_000;

export async function summarizeVideo(input: SummarizeInput): Promise<SummarizeResult> {
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) throw new Error('Missing OPENROUTER_API_KEY — set it in .env to enable summaries.');

  const transcript = truncate(input.transcript, MAX_TRANSCRIPT_CHARS);
  const uploads = input.recentUploads.slice(0, 12); // keep the model's choice focused

  const prompt = buildPrompt({
    videoTitle: input.videoTitle,
    channelTitle: input.channelTitle,
    transcript,
    uploads,
  });

  const model = DEFAULT_MODEL;

  const body = {
    model,
    messages: [
      {
        role: 'system',
        content:
          'You are a precise video summarizer. You receive a YouTube transcript and return ONLY a JSON object. Never include prose outside the JSON. Be concrete and specific; avoid filler like "the video discusses".',
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
  if (!content) throw new Error('OpenRouter returned an empty completion.');

  const parsed = parseSummary(content);
  return {
    tldr: parsed.tldr,
    keyPoints: parsed.key_points,
    followUps: parsed.follow_ups,
    topics: parsed.topics,
    model,
    prompt,
    tokenCount: data.usage?.total_tokens ?? null,
  };
}

// ----- helpers ---------------------------------------------------------------

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  // Keep the head — intros usually establish the topic; the tail is often credits.
  return s.slice(0, max) + '…';
}

interface PromptParts {
  videoTitle: string;
  channelTitle: string;
  transcript: string;
  uploads: { video_id: string; title: string }[];
}

function buildPrompt(p: PromptParts): string {
  const uploadLines = p.uploads.map(u => `- ${u.video_id} :: ${u.title}`).join('\n');
  return [
    `Video title: ${p.videoTitle}`,
    `Channel: ${p.channelTitle}`,
    '',
    'Transcript:',
    '"""',
    p.transcript,
    '"""',
    '',
    'Recent uploads from the SAME channel (use ONLY these for follow_ups):',
    uploadLines || '(none available)',
    '',
    'Produce a JSON object with exactly these keys:',
    '- "tldr": 1-2 sentence summary of what the video actually covers.',
    '- "key_points": 3-7 concrete takeaways a viewer would want to remember (array of strings).',
    '- "follow_ups": 0-3 entries picked ONLY from the recent uploads list above. Each is an object with "video_id", "title", and "reason" (one-line reason). If none fit, return an empty array.',
    '- "topics": 2-5 short topic tags describing what the video is about (array of strings, single words or short phrases, lowercase, no punctuation).',
  ].join('\n');
}

interface RawSummary {
  tldr?: unknown;
  key_points?: unknown;
  follow_ups?: unknown;
  topics?: unknown;
}

function parseSummary(content: string): { tldr: string; key_points: string[]; follow_ups: FollowUp[]; topics: string[] } {
  let raw: RawSummary;
  try {
    raw = JSON.parse(content) as RawSummary;
  } catch {
    // Some models occasionally wrap JSON in fences — try to salvage.
    const match = content.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('Summarizer returned non-JSON content.');
    raw = JSON.parse(match[0]) as RawSummary;
  }

  const tldr = typeof raw.tldr === 'string' ? raw.tldr.trim() : '';
  if (!tldr) throw new Error('Summarizer returned an empty tldr.');

  const keyPoints = Array.isArray(raw.key_points)
    ? raw.key_points.map(String).map(s => s.trim()).filter(Boolean)
    : [];
  if (keyPoints.length === 0) throw new Error('Summarizer returned no key points.');

  const followUps: FollowUp[] = Array.isArray(raw.follow_ups)
    ? raw.follow_ups
        .map((f): FollowUp | null => {
          if (!f || typeof f !== 'object') return null;
          const o = f as Record<string, unknown>;
          const video_id = typeof o.video_id === 'string' ? o.video_id.trim() : '';
          const title = typeof o.title === 'string' ? o.title.trim() : '';
          const reason = typeof o.reason === 'string' ? o.reason.trim() : '';
          if (!video_id || !title) return null;
          return { video_id, title, reason: reason || 'Recommended follow-up.' };
        })
        .filter((f): f is FollowUp => f !== null)
    : [];

  // Topics: tolerate missing/fewer/more than 2–5, normalize to lowercase.
  const topics: string[] = Array.isArray(raw.topics)
    ? raw.topics.map(String).map(s => s.trim().toLowerCase()).filter(Boolean)
    : [];

  return { tldr, key_points: keyPoints, follow_ups: followUps, topics };
}
