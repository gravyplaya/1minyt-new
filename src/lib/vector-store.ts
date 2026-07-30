/**
 * Local vector store for TAV-5 (Chat with Video).
 *
 * Phase 1: SQLite only, no hosted service. Transcript segments are grouped
 * into ~300-500 char chunks, embedded with a local hashing vectorizer (see
 * embeddings.ts), and stored as Float32 BLOBs. Cosine similarity search is
 * computed in JS — fine for the per-video scale (~50-200 chunks). No
 * FAISS/ChromaDB dependency.
 *
 * Lifecycle:
 *  - `indexVideo(videoId)` — fetches (or reuses cached) transcript segments,
 *    chunks them, embeds all chunks, persists to SQLite.
 *  - `isIndexed(videoId)` — checks if chunks exist.
 *  - `search(videoId, query, k)` — embeds the query, compares against all
 *    chunks for that video, returns top-k with timestamps for citations.
 *  - `getSegments(videoId)` — returns the timestamped segments (for context
 *    expansion around retrieved chunks).
 */

import { getDb } from './db';
import { newId } from './id';
import { embed, embedQuery, cosineSim, EMBEDDING_MODEL } from './embeddings';
import { fetchTranscript } from './transcript';
import { setTranscript } from './video-repo';
import type { TranscriptSegment, TranscriptChunk } from './types';

/** Target chunk size in characters. ~400 chars ≈ 60-80 words ≈ 20-30s of speech. */
const CHUNK_TARGET_CHARS = 400;
/** Don't let a chunk exceed this many chars (keeps it under the model's token limit). */
const CHUNK_MAX_CHARS = 800;

export interface IndexResult {
  ok: boolean;
  videoId: string;
  chunkCount: number;
  embedModel: string;
  error?: string;
}

/**
 * Index a video's transcript for vector search. Fetches segments if not already
 * cached, chunks them, embeds, and persists. Re-indexing replaces prior chunks.
 */
export async function indexVideo(videoId: string): Promise<IndexResult> {
  try {
    // 1. Get or fetch timestamped segments.
    let segments = getSegments(videoId);
    if (segments.length === 0) {
      const fetched = await fetchTranscript(videoId);
      if (!fetched || !fetched.segments || fetched.segments.length === 0) {
        return { ok: false, videoId, chunkCount: 0, embedModel: EMBEDDING_MODEL, error: 'No transcript available for this video.' };
      }
      // Cache the plain-text transcript for the summarizer too.
      setTranscript(videoId, fetched.text);
      saveSegments(videoId, fetched.segments);
      segments = fetched.segments;
    }

    // 2. Chunk segments into passages.
    const chunks = chunkSegments(segments);
    if (chunks.length === 0) {
      return { ok: false, videoId, chunkCount: 0, embedModel: EMBEDDING_MODEL, error: 'Transcript produced no chunks.' };
    }

    // 3. Embed all chunk texts (local hashing vectorizer — synchronous, no API call).
    const { vectors, model } = embed(chunks.map(c => c.text));

    // 4. Persist — replace prior chunks for this video.
    const db = getDb();
    const now = Math.floor(Date.now() / 1000);
    const insert = db.prepare(`
      INSERT INTO transcript_chunks (id, video_id, chunk_index, text, start_ms, end_ms, embedding, embed_model, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    db.transaction(() => {
      db.prepare('DELETE FROM transcript_chunks WHERE video_id = ?').run(videoId);
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        const vec = vectors[i];
        if (!vec) continue;
        const blob = Buffer.from(vec.buffer, vec.byteOffset, vec.byteLength);
        insert.run(newId(), videoId, i, chunk.text, chunk.start_ms, chunk.end_ms ?? null, blob, model, now);
      }
    })();

    return { ok: true, videoId, chunkCount: chunks.length, embedModel: model };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, videoId, chunkCount: 0, embedModel: EMBEDDING_MODEL, error: msg };
  }
}

/** Whether a video has been indexed (chunks exist in the store). */
export function isIndexed(videoId: string): boolean {
  const row = getDb().prepare('SELECT 1 FROM transcript_chunks WHERE video_id = ? LIMIT 1').get(videoId);
  return !!row;
}

/** Count indexed chunks for a video — useful for UI status. */
export function chunkCount(videoId: string): number {
  const row = getDb().prepare('SELECT COUNT(*) as n FROM transcript_chunks WHERE video_id = ?').get(videoId) as { n: number };
  return row.n;
}

// ----- chunking ---------------------------------------------------------------

interface ChunkInput {
  text: string;
  start_ms: number;
  end_ms: number | null;
}

/**
 * Group adjacent transcript segments into ~400-char passages. Each chunk
 * preserves the start time of its first segment and the end time of its last.
 * We don't split mid-segment — segments are already sentence-ish units.
 */
export function chunkSegments(segments: TranscriptSegment[]): ChunkInput[] {
  const chunks: ChunkInput[] = [];
  let current: { text: string; start_ms: number; end_ms: number | null; segs: TranscriptSegment[] } | null = null;

  const flush = () => {
    if (current && current.segs.length > 0) {
      const text = current.segs.map(s => s.text).join(' ').replace(/\s+/g, ' ').trim();
      if (text) {
        chunks.push({ text, start_ms: current.start_ms, end_ms: current.end_ms });
      }
    }
    current = null;
  };

  for (const seg of segments) {
    if (!current) {
      current = { text: '', start_ms: seg.start_ms, end_ms: seg.end_ms, segs: [seg] };
    } else {
      const projectedLen = current.segs.map(s => s.text).join(' ').length + seg.text.length + 1;
      if (projectedLen >= CHUNK_MAX_CHARS) {
        flush();
        current = { text: '', start_ms: seg.start_ms, end_ms: seg.end_ms, segs: [seg] };
      } else {
        current.segs.push(seg);
        current.end_ms = seg.end_ms;
        if (projectedLen >= CHUNK_TARGET_CHARS) {
          flush();
        }
      }
    }
  }
  flush();

  return chunks;
}

// ----- retrieval --------------------------------------------------------------

export interface SearchResult {
  chunk: TranscriptChunk;
  score: number;
}

/**
 * Search a video's chunks for the top-k most similar to `query`. Embeds the
 * query, loads all chunk embeddings for the video, and ranks by cosine sim.
 */
export async function search(videoId: string, query: string, k = 5): Promise<SearchResult[]> {
  const db = getDb();
  const rows = db.prepare(`
    SELECT id, video_id, chunk_index, text, start_ms, end_ms, embedding
    FROM transcript_chunks WHERE video_id = ? ORDER BY chunk_index
  `).all(videoId) as Array<{ id: string; video_id: string; chunk_index: number; text: string; start_ms: number; end_ms: number | null; embedding: Uint8Array }>;

  if (rows.length === 0) return [];

  const queryVec = embedQuery(query);

  const scored: SearchResult[] = rows.map(row => {
    const chunkVec = new Float32Array(row.embedding.buffer, row.embedding.byteOffset, row.embedding.byteLength / 4);
    const score = cosineSim(queryVec, chunkVec);
    return {
      score,
      chunk: {
        id: row.id,
        video_id: row.video_id,
        chunk_index: row.chunk_index,
        text: row.text,
        start_ms: row.start_ms,
        end_ms: row.end_ms,
      },
    };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, k);
}

// ----- segment persistence ----------------------------------------------------

/** Save timestamped segments to SQLite (idempotent — replaces prior rows). */
export function saveSegments(videoId: string, segments: TranscriptSegment[]): void {
  const db = getDb();
  db.transaction(() => {
    db.prepare('DELETE FROM transcript_segments WHERE video_id = ?').run(videoId);
    const insert = db.prepare('INSERT INTO transcript_segments (video_id, seg_index, text, start_ms, end_ms) VALUES (?, ?, ?, ?, ?)');
    for (const seg of segments) {
      insert.run(videoId, seg.seg_index, seg.text, seg.start_ms, seg.end_ms ?? null);
    }
  })();
}

/** Load cached timestamped segments for a video. Empty if not yet fetched. */
export function getSegments(videoId: string): TranscriptSegment[] {
  const rows = getDb().prepare('SELECT * FROM transcript_segments WHERE video_id = ? ORDER BY seg_index').all(videoId) as Array<{
    seg_index: number;
    text: string;
    start_ms: number;
    end_ms: number | null;
  }>;
  return rows.map(r => ({ text: r.text, start_ms: r.start_ms, end_ms: r.end_ms, seg_index: r.seg_index }));
}
