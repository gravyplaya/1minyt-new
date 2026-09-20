/**
 * Decision layer (TAV-70): typed judgments from the JEV "System One" decision
 * model, served through OpenRouter's alpha decisions endpoint.
 *
 * JEV is not a chat model. It reads a `state` (the text/JSON to evaluate) and
 * answers typed questions about it, in one batched request:
 *   - noul   → P(yes) for a yes/no question
 *   - choice → one option from a set you define, plus the full probability
 *              distribution and a confidence score
 *   - score  → a position on an ordered rubric you define, plus per-level
 *              probabilities and confidence
 * Answers come back typed under the same question keys — no JSON parsing, no
 * fence tolerance.
 *
 * No SDK by choice: plain fetch with the same OPENROUTER_API_KEY the other
 * LLM features use. Unset key = askDecisions() returns null and every
 * consumer falls back to its non-JEV path — decisions are an enhancement,
 * never a hard dependency.
 *
 * First consumer: retrieval re-ranking (rerankByRelevance). The local hashing
 * vectorizer produces a cosine shortlist, JEV scores every candidate's
 * relevance to the query in a single request, and code reorders. Later
 * consumers (intent routing, injection filtering, ingest triage) should follow
 * the same rule: catch JEV failure in the consumer, degrade, never break the
 * feature.
 */

const DECISIONS_URL = 'https://openrouter.ai/api/alpha/decisions';
// Pinned version, never the `~typesafe/jev-latest` alias — the alias can move
// to a new release and silently change answers; thresholds and question
// criteria are tuned against one version.
const DEFAULT_DECISION_MODEL = process.env.DECISION_MODEL?.trim() || 'typesafe/jev-1.13';

/** JEV accepts strings, JSON objects, or arrays as state / instructions / criteria. */
export type DecisionText = string | Record<string, unknown> | unknown[];

export interface NoulQuestion {
  type: 'noul';
  instructions: DecisionText;
  criteria?: { true?: DecisionText; false?: DecisionText };
}

export interface ChoiceQuestion {
  type: 'choice';
  instructions: DecisionText;
  /** option → rubric description; null when an option needs no extra detail. Max 255 options. */
  criteria: Record<string, DecisionText | null>;
}

export interface ScoreQuestion {
  type: 'score';
  instructions: DecisionText;
  /** Ordered level descriptions (2-10); the answer's score indexes into this. */
  criteria: DecisionText[];
}

export type DecisionQuestion = NoulQuestion | ChoiceQuestion | ScoreQuestion;

export interface NoulAnswer {
  type: 'noul';
  /** P(yes), 0-1. Nouls have no separate confidence field. */
  noul: number;
}

export interface ChoiceAnswer {
  type: 'choice';
  /** The highest-probability option. */
  choice: string;
  /** Every option mapped to its probability (floats that sum to 1). */
  probabilities: Record<string, number>;
  /** Certainty derived from the distribution, 0-1. */
  confidence: number;
}

export interface ScoreAnswer {
  type: 'score';
  /** Probability-weighted position across the levels; can land between levels. */
  score: number;
  /** Level index (as string key) → the level description it was given. */
  legend: Record<string, string>;
  /** Level index (as string key) → probability (floats that sum to 1). */
  probabilities: Record<string, number>;
  confidence: number;
}

export type DecisionAnswer = NoulAnswer | ChoiceAnswer | ScoreAnswer;

export interface DecisionResult<A extends Record<string, DecisionAnswer>> {
  /** The versioned model id that answered — log this, never assume the alias. */
  model: string;
  answers: A;
  usage: { input_tokens: number; output_tokens: number };
}

/** Map each question type to its answer type so answer keys type-check. */
type AnswerFor<Q> = Q extends NoulQuestion ? NoulAnswer : Q extends ChoiceQuestion ? ChoiceAnswer : Q extends ScoreQuestion ? ScoreAnswer : never;

/**
 * Evaluate one state against a map of typed questions in a single request.
 * Returns null when OPENROUTER_API_KEY is unset (feature not enabled);
 * throws on HTTP/API failure so each caller decides whether that's fatal
 * or falls back.
 */
export async function askDecisions<Q extends Record<string, DecisionQuestion>>(
  state: DecisionText,
  questions: Q,
): Promise<DecisionResult<{ [K in keyof Q]: AnswerFor<Q[K]> }> | null> {
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) return null;

  const body = JSON.stringify({ model: DEFAULT_DECISION_MODEL, state, questions });

  let res = await postDecisions(apiKey, body);
  // JEV rate limits are still adjusting dynamically (per TypeSafe's docs) —
  // one patient retry on 429/529 before giving up. Honor `retry-after` when
  // the response carries one.
  if (res.status === 429 || res.status === 529) {
    const retryAfterMs = Number(res.headers.get('retry-after')) * 1000;
    const waitMs = Number.isFinite(retryAfterMs) && retryAfterMs > 0 ? Math.min(retryAfterMs, 10000) : 1000;
    await new Promise(resolve => setTimeout(resolve, waitMs));
    res = await postDecisions(apiKey, body);
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`OpenRouter decisions failed (${res.status}): ${detail.slice(0, 400)}`);
  }

  const data = (await res.json()) as DecisionResult<{ [K in keyof Q]: AnswerFor<Q[K]> }>;
  if (!data?.answers) throw new Error('OpenRouter decisions returned no answers.');
  return data;
}

function postDecisions(apiKey: string, body: string): Promise<Response> {
  return fetch(DECISIONS_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body,
  });
}

// ----- retrieval re-ranking ------------------------------------------------------

/** Cap per-candidate text so a 40-candidate state stays well inside JEV's 32k-token state budget. */
const RERANK_CANDIDATE_MAX_CHARS = 600;
/** Below this a reorder can't meaningfully help — cosine order is fine. */
const RERANK_MIN_CANDIDATES = 3;

/** Ordered relevance rubric for rerankByRelevance — a score indexes these levels. */
const RELEVANCE_LEVELS = [
  'Not relevant to the question — a different topic entirely',
  'Same general topic, but the passage does not help answer the question',
  'Partially answers the question, or gives directly useful supporting context',
  'Directly and substantively answers the question',
];

/**
 * Re-order retrieval hits by how well each passage answers the query, using
 * one JEV score question per candidate in a single batched request. A pure
 * reorder: nothing is dropped or rewritten, and ties keep cosine order.
 *
 * The state carries the query plus each candidate as a named field (`c0`,
 * `c1`, …); each question's instructions point at its candidate by name —
 * the fan-out pattern from TypeSafe's re-ranking cookbook.
 *
 * Enhancement, not a dependency: with too few candidates, no key, or any
 * failure, the input order is returned untouched so retrieval never breaks
 * because of the decision layer.
 */
export async function rerankByRelevance<T extends { chunkText: string }>(
  query: string,
  hits: T[],
): Promise<T[]> {
  if (hits.length < RERANK_MIN_CANDIDATES || !query.trim() || !process.env.OPENROUTER_API_KEY?.trim()) {
    return hits;
  }

  try {
    const state: Record<string, string> = { question: query };
    const questions: Record<string, DecisionQuestion> = {};
    hits.forEach((hit, i) => {
      const id = `c${i}`;
      state[id] = hit.chunkText.length > RERANK_CANDIDATE_MAX_CHARS
        ? hit.chunkText.slice(0, RERANK_CANDIDATE_MAX_CHARS)
        : hit.chunkText;
      questions[`q${i}`] = {
        type: 'score',
        instructions: `How well does the passage \`${id}\` answer \`question\`?`,
        criteria: RELEVANCE_LEVELS,
      };
    });

    const res = await askDecisions(state, questions);
    if (!res) return hits;

    const scored = hits.map((hit, i) => {
      const answer = res.answers[`q${i}`];
      return { hit, score: answer?.type === 'score' ? answer.score : -1 };
    });
    // Array.prototype.sort is stable — equal scores keep cosine order.
    scored.sort((a, b) => b.score - a.score);
    return scored.map(s => s.hit);
  } catch {
    return hits;
  }
}
