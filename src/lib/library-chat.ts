/**
 * Library-wide chat (TAV-63/64/65) — options E, F, G, H from the discovery pass.
 *
 *  E  Global RAG: embed the question, retrieve top-k chunks across the *whole*
 *     indexed corpus (transcript + summary chunks), answer with citations that
 *     point at a moment inside a specific video.
 *  F  Scoped chat: the retrieval query pushes a folder/tag/channel filter into
 *     SQL (see searchLibrary) so "chat with my Tech folder" only scores that
 *     collection's chunks.
 *  G  Channel memory: when the scope is a channel with a generated dossier
 *     (see dossier.ts), the dossier is injected into the system prompt so
 *     answers carry the channel's long-term context, not just raw chunks.
 *  H  Deep Research (agentic): an OpenAI-tools loop — the model may call
 *     search_transcripts / search_summaries / list_channels / get_channel_profile
 *     across up to MAX_TOOL_ROUNDS rounds before answering.
 *
 * Conversation history persists per scope string in library_chat_messages
 * (see library-chat-repo.ts).
 */

import { searchLibrary } from './vector-store';
import { listChannels } from './repo';
import { loadDossier } from './dossier';
import { listVideosByChannel } from './video-repo';
import type { ChatScopeKind, LibraryChatCitation, LibraryChatResult } from './types';

/** Prior turns only need role + content — any message row shape satisfies this. */
interface HistoryMessage {
  role: 'user' | 'assistant';
  content: string;
}

const OPENROUTER_BASE = 'https://openrouter.ai/api/v1';
const DEFAULT_CHAT_MODEL = process.env.CHAT_MODEL?.trim() || 'openrouter/free';
const MAX_HISTORY = 10;
const STANDARD_K = 14;
const MAX_TOOL_ROUNDS = 4;
const MAX_CITATIONS = 12;

// ----- scope handling -----------------------------------------------------------

/** Serialize a scope into its storage string: 'all' | 'kind:id'. */
export function scopeString(kind: ChatScopeKind, id?: string | null): string {
  if (kind === 'all' || !id) return 'all';
  return `${kind}:${id}`;
}

/** Parsed scope with a human label for prompts and UI. */
export interface ParsedScope {
  kind: ChatScopeKind;
  id: string | null;
  label: string;
}

/**
 * Parse a scope string from the client. Unknown formats fall back to 'all'
 * (whole library) rather than erroring — a stale UI scope should never break
 * a question.
 */
export function parseScope(raw: string | null | undefined): ParsedScope {
  const s = (raw ?? '').trim();
  if (s === 'all' || s === '') return { kind: 'all', id: null, label: 'your entire library' };
  const idx = s.indexOf(':');
  const kind = idx > 0 ? s.slice(0, idx) : '';
  const id = idx > 0 ? s.slice(idx + 1) : s;
  if (kind === 'channel') return { kind: 'channel', id, label: 'this channel' };
  if (kind === 'folder') return { kind: 'folder', id, label: 'this folder' };
  if (kind === 'tag') return { kind: 'tag', id, label: 'this tag' };
  return { kind: 'all', id: null, label: 'your entire library' };
}

// ----- standard (single-shot RAG) chat ------------------------------------------

export interface LibraryChatInput {
  question: string;
  scope: string;
  history: HistoryMessage[];
}

/**
 * One grounded Q&A turn over the library (or a scope of it). Retrieves the
 * top-k matching chunks across the corpus, builds a citation-numbered context
 * block, and asks the model to answer with [N] citations.
 */
export async function chatWithLibrary(input: LibraryChatInput): Promise<LibraryChatResult> {
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) throw new Error('Missing OPENROUTER_API_KEY — set it in .env to enable chat.');

  const scope = parseScope(input.scope);
  const hits = await searchLibrary(input.question, STANDARD_K, scopeToFilter(scope));
  return completeLibraryAnswer({ apiKey, question: input.question, scope, hits, history: input.history });
}

/**
 * The `searchLibrary` opts shape expects optional filters; folder/tag ids only
 * apply to their own kind, never all at once.
 */
function scopeToFilter(scope: ParsedScope): { channelId?: string | null; folderId?: string | null; tagId?: string | null } {
  switch (scope.kind) {
    case 'channel': return { channelId: scope.id };
    case 'folder': return { folderId: scope.id };
    case 'tag': return { tagId: scope.id };
    default: return {};
  }
}

// ----- Deep Research (agentic) chat ---------------------------------------------

export interface AgentChatInput {
  question: string;
  scope: string;
  history: HistoryMessage[];
}

export interface AgentChatResult extends LibraryChatResult {
  /** Short human-readable tool-call labels, e.g. "search_transcripts(\"x\")". */
  toolCalls: string[];
}

/**
 * Deep Research mode (option H): an OpenAI tools loop. The model plans its own
 * retrieval — searching transcripts, searching summaries, listing channels, or
 * pulling a channel profile — over up to MAX_TOOL_ROUNDS rounds, then answers
 * grounded in what it gathered. Scope filters apply to every search call, so
 * the agent stays inside the user's chosen collection.
 */
export async function chatWithLibraryAgent(input: AgentChatInput): Promise<AgentChatResult> {
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) throw new Error('Missing OPENROUTER_API_KEY — set it in .env to enable chat.');

  const scope = parseScope(input.scope);
  const filter = scopeToFilter(scope);

  const citations: LibraryChatCitation[] = [];
  const toolCalls: string[] = [];

  const messages: Array<Record<string, unknown>> = [
    { role: 'system', content: buildAgentSystemPrompt(scope) },
    { role: 'user', content: buildAgentQuestionBlock(input.question) },
  ];
  for (const msg of input.history.slice(-MAX_HISTORY)) {
    messages.push({ role: msg.role, content: msg.content });
  }

  let answer: string | null = null;

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const body = {
      model: DEFAULT_CHAT_MODEL,
      messages,
      temperature: 0.3,
      tools: TOOLS,
    };

    const res = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`OpenRouter chat/completions failed (${res.status}): ${detail.slice(0, 400)}`);
    }

    const data = (await res.json()) as {
      choices: Array<{ message: { content: string | null; tool_calls?: Array<{ id: string; type: string; function: { name: string; arguments: string } }> } }>;
    };

    const message = data.choices?.[0]?.message;
    if (!message) throw new Error('OpenRouter returned an empty chat completion.');

    if (!message.tool_calls || message.tool_calls.length === 0) {
      answer = (message.content ?? '').trim();
      break;
    }

    // Execute each requested tool, append results as role:'tool' messages.
    messages.push({ role: 'assistant', content: message.content ?? null, tool_calls: message.tool_calls });
    for (const call of message.tool_calls) {
      let resultJson: string;
      try {
        const args = JSON.parse(call.function.arguments || '{}') as Record<string, unknown>;
        resultJson = await executeTool(call.function.name, args, filter, citations, toolCalls);
      } catch (err) {
        resultJson = JSON.stringify({ error: err instanceof Error ? err.message : String(err) });
      }
      messages.push({ role: 'tool', tool_call_id: call.id, content: resultJson });
    }
  }

  if (answer === null) {
    // Ran out of tool rounds without a final answer — force one more call
    // without tools so the model must summarize what it gathered.
    messages.push({ role: 'user', content: 'You have used your research budget. Answer the question now based on what you found.' });
    answer = await completePlain(apiKey, messages);
  }

  if (!answer) throw new Error('The agent returned an empty answer.');

  return {
    answer,
    citations: citations.slice(0, MAX_CITATIONS),
    model: DEFAULT_CHAT_MODEL,
    toolCalls,
  };
}

/** One final no-tools completion (budget exhausted fallback). */
async function completePlain(apiKey: string, messages: Array<Record<string, unknown>>): Promise<string> {
  const res = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: DEFAULT_CHAT_MODEL, messages, temperature: 0.3 }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`OpenRouter chat/completions failed (${res.status}): ${detail.slice(0, 400)}`);
  }
  const data = (await res.json()) as { choices: Array<{ message: { content: string } }> };
  return (data.choices?.[0]?.message?.content ?? '').trim();
}

// ----- shared completion ----------------------------------------------------------

interface CompleteArgs {
  apiKey: string;
  question: string;
  scope: ParsedScope;
  hits: Awaited<ReturnType<typeof searchLibrary>>;
  history: HistoryMessage[];
}

/** Build the final prompt from retrieved hits and call OpenRouter once. */
async function completeLibraryAnswer(args: CompleteArgs): Promise<LibraryChatResult> {
  const { apiKey, question, scope, hits, history } = args;

  const numbered = hits.map((h, i) => ({
    citation: {
      videoId: h.videoId,
      videoTitle: h.videoTitle,
      channelTitle: h.channelTitle,
      startMs: h.startMs,
      endMs: h.endMs,
      text: h.chunkText,
      chunkType: h.chunkType,
    } as LibraryChatCitation,
    n: i + 1,
  }));

  const contextBlock = numbered.length > 0
    ? [
        `Excerpts from ${scope.label} (numbered; each shows the video, channel, and timestamp it came from):`,
        ...numbered.map(({ citation: c, n }) => {
          const ts = formatTimestamp(c.startMs);
          return `[${n}] "${c.videoTitle}" (${c.channelTitle}) at ${ts}${c.chunkType === 'summary' ? ' [video summary]' : ''} — ${c.text}`;
        }),
        '',
        'Cite sources as [N] matching these excerpt numbers, naming the video (and timestamp when relevant) that each claim comes from.',
      ].join('\n')
    : `(No indexed transcript or summary excerpts matched this question in ${scope.label}. Answer from general knowledge, but say clearly that nothing in the indexed library covers it.)`;

  const dossierBlock = scope.kind === 'channel' ? await buildDossierBlock(scope.id) : '';

  const system = [
    'You are a research assistant answering questions about the user\'s YouTube library.',
    `The current scope is ${scope.label}. All excerpts come from videos the user actually follows.`,
    dossierBlock,
    'Rules:',
    '- Ground your answer in the numbered excerpts. If they don\'t contain the answer, say so and fall back to general knowledge clearly labeled as such.',
    '- Cite sources as [N] matching the excerpt numbers, naming the video and channel.',
    '- Synthesize across videos when several excerpts are relevant — the user wants the collective picture, not a per-video list, unless they ask for one.',
    '- Keep answers concise and direct.',
  ].filter(Boolean).join('\n\n');

  const messages: Array<{ role: string; content: string }> = [
    { role: 'system', content: system },
    { role: 'user', content: contextBlock },
  ];
  for (const msg of history.slice(-MAX_HISTORY)) {
    messages.push({ role: msg.role, content: msg.content });
  }
  messages.push({ role: 'user', content: question });

  const res = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: DEFAULT_CHAT_MODEL, messages, temperature: 0.3 }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`OpenRouter chat/completions failed (${res.status}): ${detail.slice(0, 400)}`);
  }

  const data = (await res.json()) as { choices: Array<{ message: { content: string } }> };
  const answer = data.choices?.[0]?.message?.content;
  if (!answer) throw new Error('OpenRouter returned an empty chat completion.');

  return {
    answer: answer.trim(),
    citations: numbered.map(x => x.citation),
    model: DEFAULT_CHAT_MODEL,
    toolCalls: [],
  };
}

// ----- dossier injection (G) -------------------------------------------------------

/** Load the channel dossier for a channel-scoped chat, as a prompt block. */
async function buildDossierBlock(channelId: string | null): Promise<string> {
  if (!channelId) return '';
  try {
    const dossier = await loadDossier(channelId);
    if (!dossier) return '';
    return [
      'Channel memory (a distillation of this channel\'s summarized videos):',
      dossier.dossier,
      `Recurring themes: ${dossier.themes.join(', ') || '(none)'}`,
    ].join('\n');
  } catch {
    return '';
  }
}

// ----- agent tools (H) -----------------------------------------------------------------

type ToolFilter = { channelId?: string | null; folderId?: string | null; tagId?: string | null };

const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'search_transcripts',
      description: 'Search the user\'s indexed video transcripts (semantic search). Returns matching passages with the video title, channel, and timestamp.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'What to search for in the transcripts.' },
          limit: { type: 'integer', description: 'Max passages to return (default 6, max 12).' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_summaries',
      description: 'Search the AI-generated per-video summaries (TL;DR + key points). Better than transcript search for "what videos cover X" questions.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'What to search for in the summaries.' },
          limit: { type: 'integer', description: 'Max summaries to return (default 6, max 12).' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_channels',
      description: 'List the user\'s subscribed channels (id + title). Use to resolve a channel name to an id, or to enumerate coverage.',
      parameters: {
        type: 'object',
        properties: {
          filter: { type: 'string', description: 'Optional case-insensitive substring to filter channel titles.' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_channel_profile',
      description: 'Get a channel\'s long-term profile: its LLM-generated dossier, recurring themes, and recent video titles. Use before answering questions about one channel\'s overall perspective.',
      parameters: {
        type: 'object',
        properties: {
          channel_id: { type: 'string', description: 'The channel id (from list_channels).' },
        },
        required: ['channel_id'],
      },
    },
  },
];

/**
 * Execute one agent tool call and return the JSON result string. Search tools
 * accumulate citations as a side effect so the final answer can show them.
 */
async function executeTool(
  name: string,
  args: Record<string, unknown>,
  filter: ToolFilter,
  citations: LibraryChatCitation[],
  toolCalls: string[],
): Promise<string> {
  switch (name) {
    case 'search_transcripts':
    case 'search_summaries': {
      const query = String(args.query ?? '').trim();
      if (!query) return JSON.stringify({ results: [], note: 'Empty query.' });
      const limit = clamp(Number(args.limit ?? 6) || 6, 1, 12);
      const chunkType = name === 'search_summaries' ? 'summary' : 'transcript';
      const hits = await searchLibrary(query, limit, { ...filter, chunkType });
      for (const h of hits) {
        if (citations.length >= 24) break;
        citations.push({
          videoId: h.videoId,
          videoTitle: h.videoTitle,
          channelTitle: h.channelTitle,
          startMs: h.startMs,
          endMs: h.endMs,
          text: h.chunkText,
          chunkType: h.chunkType,
        });
      }
      toolCalls.push(`${name}("${truncateLabel(query, 40)}")`);
      return JSON.stringify({
        results: hits.map(h => ({
          video: h.videoTitle,
          channel: h.channelTitle,
          videoId: h.videoId,
          at: formatTimestamp(h.startMs),
          startMs: h.startMs,
          excerpt: h.chunkText,
        })),
        note: 'Cite as [video title] (channel) at timestamp. videoId values can be shown to the user as links.',
      });
    }

    case 'list_channels': {
      const filterText = String(args.filter ?? '').trim().toLowerCase();
      const channels = await listChannels({ includeMusic: true, hidden: true, limit: 500 });
      const filtered = filterText
        ? channels.filter(c => c.title.toLowerCase().includes(filterText) || (c.handle ?? '').toLowerCase().includes(filterText))
        : channels.slice(0, 60);
      toolCalls.push(`list_channels(${filterText ? `"${truncateLabel(filterText, 30)}"` : ''})`);
      return JSON.stringify({
        channels: filtered.map(c => ({ id: c.channel_id, title: c.title })),
        total: channels.length,
      });
    }

    case 'get_channel_profile': {
      const channelId = String(args.channel_id ?? '').trim();
      if (!channelId) return JSON.stringify({ error: 'channel_id is required.' });
      const [dossier, videos] = await Promise.all([
        loadDossier(channelId).catch(() => null),
        listVideosByChannel(channelId, 10).catch(() => []),
      ]);
      const channel = await import('./repo').then(m => m.getChannel(channelId));
      toolCalls.push('get_channel_profile()');
      return JSON.stringify({
        channel: channel?.title ?? channelId,
        dossier: dossier?.dossier ?? '(no dossier generated yet — rely on search tools instead)',
        themes: dossier?.themes ?? [],
        recentVideos: videos.map(v => v.title),
      });
    }

    default:
      return JSON.stringify({ error: `Unknown tool: ${name}` });
  }
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function truncateLabel(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + '…' : s;
}

// ----- prompts ---------------------------------------------------------------------

function buildAgentSystemPrompt(scope: ParsedScope): string {
  return [
    'You are a research agent answering questions about the user\'s YouTube library.',
    `Current scope: ${scope.label}. Your search tools only see videos in this scope.`,
    '',
    'You have tools to search indexed transcripts and AI-generated summaries, list the user\'s channels, and pull a channel\'s long-term profile.',
    'Plan briefly: resolve any channel names first, then search summaries for topic questions and transcripts for detail questions. Use 1-4 tool calls total; do not repeat identical searches.',
    '',
    'When you answer:',
    '- Cite what you found as [video title] (channel) at M:SS.',
    '- Synthesize across videos; say clearly when the library doesn\'t cover something.',
    '- Keep answers concise and direct.',
  ].join('\n');
}

function buildAgentQuestionBlock(question: string): string {
  return `Question: ${question}`;
}

function formatTimestamp(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}
