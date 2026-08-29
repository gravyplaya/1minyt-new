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
// Default to OpenRouter's free-pool router — it always resolves to a currently
// available free model, so we don't break when a specific free slug is retired.
// Override per-deploy via SUMMARY_MODEL in .env.
const DEFAULT_MODEL = process.env.SUMMARY_MODEL?.trim() || 'openrouter/free';
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

// ----- TAV-26: Playlist synthesis ---------------------------------------------

export interface PlaylistSummarizeInput {
  playlistTitle: string;
  channelTitle: string;
  /** Up to N video summaries (TL;DR + key points) from the playlist. */
  videoSummaries: Array<{ video_id: string; title: string; tldr: string; key_points: string[] }>;
}

export interface PlaylistSummarizeResult {
  synthesis: string;
  themes: string[];
  start_here: string[];
  model: string;
  tokenCount: number | null;
}

const MAX_PLAYLIST_SUMMARY_CHARS = 12_000;

/**
 * Generate a synthesis of an entire curated playlist from the per-video
 * summaries already cached locally. This is cheaper and more reliable than
 * feeding raw transcripts — the per-video TL;DRs are already distilled.
 *
 * The prompt asks for a prose synthesis (what the playlist covers as a whole),
 * recurring themes, and a "start here" set of 2-5 video ids — the creator's
 * own curated collection, synthesized into a single entry point.
 *
 * Videos without a cached summary are skipped; if none have summaries, the
 * caller should fall back to summarizing individual videos first.
 */
export async function summarizePlaylist(input: PlaylistSummarizeInput): Promise<PlaylistSummarizeResult> {
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) throw new Error('Missing OPENROUTER_API_KEY — set it in .env to enable playlist summaries.');

  const model = DEFAULT_MODEL;
  const usable = input.videoSummaries.slice(0, 30);
  const block = usable.map(v =>
    `### ${v.title} (id: ${v.video_id})\nTL;DR: ${v.tldr}\nKey points: ${(v.key_points ?? []).join('; ')}`,
  ).join('\n\n');
  const trimmed = truncate(block, MAX_PLAYLIST_SUMMARY_CHARS);

  const prompt = [
    `Playlist title: ${input.playlistTitle}`,
    `Channel: ${input.channelTitle}`,
    '',
    'Per-video summaries from this playlist:',
    '"""',
    trimmed || '(no summaries available yet)',
    '"""',
    '',
    'Produce a JSON object with exactly these keys:',
    '- "synthesis": 2-4 paragraphs synthesizing what this playlist covers as a whole — the arc, the audience, why someone would watch it start to finish. Plain text, no markdown headings.',
    '- "themes": 3-7 recurring themes across the playlist (array of short strings, lowercase, no punctuation).',
    '- "start_here": 2-5 video ids from the list above that are the best starting points for a new viewer (array of the id strings only).',
  ].join('\n');

  const res = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: 'system',
          content:
            'You are a playlist curator. You receive per-video summaries of a YouTube playlist and synthesize them into a single overview. You return ONLY a JSON object. Never include prose outside the JSON.',
        },
        { role: 'user', content: prompt },
      ],
      temperature: 0.4,
      response_format: { type: 'json_object' },
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`OpenRouter playlist summary failed (${res.status}): ${detail.slice(0, 400)}`);
  }

  const data = (await res.json()) as {
    choices: Array<{ message: { content: string } }>;
    usage?: { total_tokens?: number };
  };

  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error('OpenRouter returned an empty playlist synthesis.');

  const parsed = parsePlaylistSummary(content);
  return {
    synthesis: parsed.synthesis,
    themes: parsed.themes,
    start_here: parsed.start_here,
    model,
    tokenCount: data.usage?.total_tokens ?? null,
  };
}

interface RawPlaylistSummary {
  synthesis?: unknown;
  themes?: unknown;
  start_here?: unknown;
}

function parsePlaylistSummary(content: string): { synthesis: string; themes: string[]; start_here: string[] } {
  let raw: RawPlaylistSummary;
  try {
    raw = JSON.parse(content) as RawPlaylistSummary;
  } catch {
    const match = content.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('Playlist summarizer returned non-JSON content.');
    try {
      raw = JSON.parse(match[0]) as RawPlaylistSummary;
    } catch {
      throw new Error('Playlist summarizer returned non-JSON content.');
    }
  }

  const synthesis = typeof raw.synthesis === 'string' ? raw.synthesis.trim() : '';
  if (!synthesis) throw new Error('Playlist summarizer returned an empty synthesis.');

  const themes: string[] = Array.isArray(raw.themes)
    ? raw.themes.map(String).map(s => s.trim().toLowerCase()).filter(Boolean)
    : [];

  const startHere: string[] = Array.isArray(raw.start_here)
    ? raw.start_here.map(String).map(s => s.trim()).filter(Boolean)
    : [];

  return { synthesis, themes, start_here: startHere };
}

export interface CommentSummarizeInput {
  videoId: string;
  videoTitle: string;
  /** The transcript TL;DR, so the comment summary can reference corrections. */
  transcriptTldr: string;
  comments: Array<{ author: string; text: string; like_count: number }>;
}

export interface CommentSummarizeResult {
  summary: string;
  model: string;
}

const MAX_COMMENT_CHARS = 6_000;

/**
 * Generate a short "Community Pulse" paragraph from a video's top comments.
 *
 * The prompt asks the model to act as a community reader: surface corrections,
 * added context, disagreements, and the dominant sentiment — not a list of each
 * comment. We pass the transcript TL;DR so the model can flag where commenters
 * contradict or refine the video's thesis.
 *
 * Returns a single string (no JSON) because this is a short paragraph, not a
 * structured artifact. Keeps the prompt cheap and the output directly renderable.
 */
export async function summarizeComments(input: CommentSummarizeInput): Promise<CommentSummarizeResult> {
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) throw new Error('Missing OPENROUTER_API_KEY — set it in .env to enable comment summaries.');

  const model = DEFAULT_MODEL;
  const bodyText = input.comments.slice(0, 20).map((c, i) =>
    `[${i + 1}] (${c.like_count} likes) ${c.author}: ${c.text}`,
  ).join('\n');
  const trimmed = truncate(bodyText, MAX_COMMENT_CHARS);

  const prompt = [
    `Video title: ${input.videoTitle}`,
    `Transcript TL;DR: ${input.transcriptTldr}`,
    '',
    'Top YouTube comments (by relevance/likes):',
    '"""',
    trimmed || '(no comments)',
    '"""',
    '',
    'Write a 2-4 sentence "Community Pulse" summary of what the top commenters are saying. ' +
      'Surface corrections, added context, and disagreements with the video where they exist; ' +
      'otherwise capture the dominant sentiment. Do not list each comment — synthesize. ' +
      'Be concrete and neutral. Do not add a heading or preamble.',
  ].join('\n');

  const res = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: 'system',
          content: 'You are a community analyst. You read YouTube comments and summarize what the audience collectively adds to a video — corrections, context, and sentiment. You write clear, neutral prose.',
        },
        { role: 'user', content: prompt },
      ],
      temperature: 0.3,
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`OpenRouter comment summary failed (${res.status}): ${detail.slice(0, 400)}`);
  }

  const data = (await res.json()) as {
    choices: Array<{ message: { content: string } }>;
  };

  const summary = data.choices?.[0]?.message?.content?.trim();
  if (!summary) throw new Error('OpenRouter returned an empty comment summary.');
  return { summary, model };
}
