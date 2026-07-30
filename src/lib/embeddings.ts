/**
 * Local embedding vectorizer for TAV-5 (Chat with Video).
 *
 * Phase 1 constraint: "local vector store only — no hosted service needed."
 * OpenRouter (the project's existing LLM provider) has no /embeddings endpoint,
 * so rather than introduce a new API key dependency, we generate embeddings
 * locally with a hashing vectorizer (a.k.a. "hashing trick" / feature hashing).
 *
 * How it works:
 *  - Tokenize text into lowercase word n-grams (unigrams + bigrams).
 *  - Hash each token to an index in a fixed-size vector (1024 dims).
 *  - Use a sign hash to add +1 / -1 at each index (the sign reduces collision
 *    bias — the expected dot product of two different tokens averages to 0).
 *  - L2-normalize the result so cosine similarity is just a dot product.
 *
 * This produces real Float32 vectors that:
 *  - Are stored as BLOBs in SQLite (same schema as a neural embedding would use).
 *  - Support cosine similarity search.
 *  - Work well for transcript retrieval at the per-video scale (50-200 chunks).
 *
 * It's not semantically rich like bge-m3 — "car" and "automobile" won't map to
 * nearby vectors — but for keyword-level grounding of questions in a single
 * video's transcript, it's a strong, zero-dependency, zero-cost Phase 1 baseline.
 * Swapping to a neural embedding later only changes this file; the vector-store
 * and chat layers are embedding-model-agnostic.
 */

/** Vector dimensionality. Stored alongside chunks so upgrades don't break old data. */
export const EMBEDDING_DIM = 1024;
/** Model label persisted with each chunk. Change when you change the method. */
export const EMBEDDING_MODEL = 'local-hashing-v1';

export interface EmbedResult {
  vectors: Float32Array[];
  model: string;
}

/**
 * Embed one or more texts. Pure local computation — no network call.
 */
export function embed(texts: string[]): EmbedResult {
  const vectors = texts.map(t => embedQuery(t));
  return { vectors, model: EMBEDDING_MODEL };
}

/**
 * Embed a single text into a fixed-size, L2-normalized Float32 vector.
 */
export function embedQuery(text: string): Float32Array {
  const vec = new Float32Array(EMBEDDING_DIM);
  const tokens = tokenize(text);

  for (const token of tokens) {
    const { index, sign } = hashToken(token);
    vec[index] += sign;
  }

  // L2-normalize so cosine similarity is a simple dot product.
  let norm = 0;
  for (let i = 0; i < vec.length; i++) norm += vec[i] * vec[i];
  norm = Math.sqrt(norm);
  if (norm > 0) {
    for (let i = 0; i < vec.length; i++) vec[i] /= norm;
  }

  return vec;
}

/**
 * Cosine similarity between two Float32Arrays. Since vectors are L2-normalized,
 * this is just a dot product, but we compute it generally for safety.
 */
export function cosineSim(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i];
  }
  return dot;
}

// ----- tokenization -----------------------------------------------------------

/**
 * Split text into lowercase word unigrams + bigrams. Strips punctuation and
 * very short tokens. This is deliberately simple — good enough for transcript
 * retrieval without pulling in a tokenizer dependency.
 */
function tokenize(text: string): string[] {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length >= 2);

  const tokens: string[] = [];
  for (let i = 0; i < words.length; i++) {
    tokens.push(words[i]); // unigram
    if (i + 1 < words.length) {
      tokens.push(`${words[i]}_${words[i + 1]}`); // bigram
    }
  }
  return tokens;
}

// ----- hashing ----------------------------------------------------------------

/**
 * Hash a token to an (index, sign) pair. The sign (+1/-1) is the "signed hash
 * trick" — it makes the expected dot product of two distinct tokens zero,
 * reducing collision noise in the vector.
 */
function hashToken(token: string): { index: number; sign: number } {
  // FNV-1a hash — fast, good distribution for short strings.
  let h1 = 0x811c9dc5;
  for (let i = 0; i < token.length; i++) {
    h1 ^= token.charCodeAt(i);
    h1 = Math.imul(h1, 0x01000193);
  }
  // Second hash for the sign bit.
  let h2 = 0x12345678;
  for (let i = 0; i < token.length; i++) {
    h2 ^= token.charCodeAt(i);
    h2 = Math.imul(h2, 0x05031803);
  }

  const index = (h1 >>> 0) % EMBEDDING_DIM;
  const sign = (h2 & 1) === 0 ? 1 : -1;
  return { index, sign };
}
