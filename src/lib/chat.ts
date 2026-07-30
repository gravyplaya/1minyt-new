/**
 * RAG chat over video transcripts for TAV-5 (Chat with Video).
 *
 * Flow:
 *  1. Embed the user's question (local hashing vectorizer — see embeddings.ts).
 *  2. Retrieve top-k transcript chunks via cosine similarity (vector-store.ts).
 *  3. Build a context prompt with timestamped citations.
 *  4. Send to OpenRouter /chat/completions with the context + conversation history.
 *  5. The model answers grounded in the transcript, citing timestamps like
 *     [2:34] which the UI links back to the exact moment in the YouTube video.
 *
 * Conversation history is passed as prior messages so the model can follow up.
 * We don't do streaming in Phase 1 — the answers are short and the latency
 * of a single completion is acceptable.
 */

import { search } from './vector-store';
import type { ChatMessage, ChatCitation, TranscriptChunk } from './types';

const OPENROUTER_BASE = 'https://openrouter.ai/api/v1';
const DEFAULT_CHAT_MODEL = process.env.CHAT_MODEL?.trim() || 'openai/gpt-oss-20b:free';
const MAX_HISTORY = 10; // last N messages to include as context

export interface ChatInput {
  videoId: string;
  videoTitle: string;
  question: string;
  history: ChatMessage[];
}

export interface ChatResult {
  answer: string;
  citations: ChatCitation[];
  model: string;
}

/**
 * Answer a question about a video grounded in its transcript. The caller is
 * responsible for ensuring the video has been indexed (chunks exist in the
 * store). If no chunks are found, we fall back to a no-RAG answer.
 */
export async function chatWithVideo(input: ChatInput): Promise<ChatResult> {
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) throw new Error('Missing OPENROUTER_API_KEY — set it in .env to enable chat.');

  // 1. Retrieve relevant chunks.
  const results = await search(input.videoId, input.question, 5);
  const retrievedChunks: TranscriptChunk[] = results.map(r => r.chunk);

  // 2. Build context with timestamp markers.
  const contextBlock = retrievedChunks.length > 0
    ? buildContextBlock(retrievedChunks)
    : "(No transcript context available. Answer based on general knowledge if possible, otherwise say you don't have enough context.)";

  const citations: ChatCitation[] = retrievedChunks.map(c => ({
    start_ms: c.start_ms,
    end_ms: c.end_ms,
    text: c.text,
  }));

  // 3. Build messages: system + context + history + question.
  const messages = buildMessages(input, contextBlock);

  // 4. Call OpenRouter chat completions.
  const body = {
    model: DEFAULT_CHAT_MODEL,
    messages,
    temperature: 0.3,
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
  };

  const answer = data.choices?.[0]?.message?.content;
  if (!answer) throw new Error('OpenRouter returned an empty chat completion.');

  return { answer: answer.trim(), citations, model: DEFAULT_CHAT_MODEL };
}

// ----- prompt building --------------------------------------------------------

function buildContextBlock(chunks: TranscriptChunk[]): string {
  const lines = chunks.map((c, i) => {
    const ts = formatTimestamp(c.start_ms);
    return `[${i + 1}] ${ts} — ${c.text}`;
  });
  return [
    'Transcript excerpts (with timestamps):',
    ...lines,
    '',
    'Cite sources using [N] format matching the excerpt numbers above. Include the timestamp when the cited content occurs.',
  ].join('\n');
}

function buildMessages(input: ChatInput, contextBlock: string): Array<{ role: string; content: string }> {
  const system = [
    'You are a helpful assistant that answers questions about a YouTube video based on its transcript.',
    `Video title: ${input.videoTitle}`,
    '',
    'Rules:',
    "- Answer ONLY based on the transcript excerpts provided. If the answer isn't in the transcript, say so.",
    '- When you reference something from the transcript, cite it using [N] format (matching the excerpt numbers).',
    '- Keep answers concise and direct. 2-4 sentences for simple questions.',
    '- If the user asks about a specific moment, include the timestamp from the citation.',
  ].join('\n');

  const messages: Array<{ role: string; content: string }> = [
    { role: 'system', content: system },
    { role: 'user', content: contextBlock },
  ];

  // Add conversation history (last N messages) so follow-ups have context.
  const recent = input.history.slice(-MAX_HISTORY);
  for (const msg of recent) {
    messages.push({ role: msg.role, content: msg.content });
  }

  // The current question.
  messages.push({ role: 'user', content: input.question });

  return messages;
}

/** Format milliseconds as M:SS or H:MM:SS for prompt citations. */
function formatTimestamp(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}
