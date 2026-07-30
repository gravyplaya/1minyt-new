/**
 * Local vector store for TAV-5 (Chat with Video).
 *
 * Phase 1: PostgreSQL only, no hosted service. Transcript segments are grouped
 * into ~300-500 char chunks, embedded with a local hashing vectorizer (see
 * embeddings.ts), and stored as BYTEA in Postgres. Cosine similarity search is
 * computed in JS — fine for the per-video scale (~50-200 chunks).
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
 * Index a video's transcript for vector search.
 */
export async function indexVideo(videoId: string): Promise<IndexResult> {
  try {
    // 1. Get or fetch timestamped segments.
    let segments = await getSegments(videoId);
    if (segments.length === 0) {
      const fetched = await fetchTranscript(videoId);
      if (!fetched || !fetched.segments || fetched.segments.length === 0) {
        return { ok: false, videoId, chunkCount: 0, embedModel: EMBEDDING_MODEL, error: 'No transcript available for this video.' };
      }
      await setTranscript(videoId, fetched.text);
      await saveSegments(videoId, fetched.segments);
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
    const client = await getDb();
    try {
      const now = Math.floor(Date.now() / 1000);
      await client.query('BEGIN');
      await client.query('DELETE FROM transcript_chunks WHERE video_id = $1', [videoId]);
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        const vec = vectors[i];
        if (!vec) continue;
        const blob = Buffer.from(vec.buffer, vec.byteOffset, vec.byteLength);
        await client.query(
          `INSERT INTO transcript_chunks (id, video_id, chunk_index, text, start_ms, end_ms, embedding, embed_model, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [newId(), videoId, i, chunk.text, chunk.start_ms, chunk.end_ms ?? null, blob, model, now],
        );
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }

    return { ok: true, videoId, chunkCount: chunks.length, embedModel: model };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, videoId, chunkCount: 0, embedModel: EMBEDDING_MODEL, error: msg };
  }
}

/** Whether a video has been indexed (chunks exist in the store). */
export async function isIndexed(videoId: string): Promise<boolean> {
  const client = await getDb();
  try {
    const { rows } = await client.query('SELECT 1 FROM transcript_chunks WHERE video_id = $1 LIMIT 1', [videoId]);
    return rows.length > 0;
  } finally {
    client.release();
  }
}

/** Count indexed chunks for a video — useful for UI status. */
export async function chunkCount(videoId: string): Promise<number> {
  const client = await getDb();
  try {
    const { rows } = await client.query('SELECT COUNT(*) as n FROM transcript_chunks WHERE video_id = $1', [videoId]);
    return Number(rows[0].n);
  } finally {
    client.release();
  }
}

// ----- chunking ---------------------------------------------------------------

interface ChunkInput {
  text: string;
  start_ms: number;
  end_ms: number | null;
}

/**
 * Group adjacent transcript segments into ~400-char passages.
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
 * Search a video's chunks for the top-k most similar to `query`.
 */
export async function search(videoId: string, query: string, k = 5): Promise<SearchResult[]> {
  const client = await getDb();
  try {
    const { rows } = await client.query(
      `SELECT id, video_id, chunk_index, text, start_ms, end_ms, embedding
       FROM transcript_chunks WHERE video_id = $1 ORDER BY chunk_index`,
      [videoId],
    );

    if (rows.length === 0) return [];

    const queryVec = embedQuery(query);

    const scored: SearchResult[] = rows.map((row: { id: string; video_id: string; chunk_index: number; text: string; start_ms: number; end_ms: number | null; embedding: Buffer }) => {
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
  } finally {
    client.release();
  }
}

// ----- segment persistence ----------------------------------------------------

/** Save timestamped segments to Postgres (idempotent — replaces prior rows). */
export async function saveSegments(videoId: string, segments: TranscriptSegment[]): Promise<void> {
  const client = await getDb();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM transcript_segments WHERE video_id = $1', [videoId]);
    for (const seg of segments) {
      await client.query(
        'INSERT INTO transcript_segments (video_id, seg_index, text, start_ms, end_ms) VALUES ($1, $2, $3, $4, $5)',
        [videoId, seg.seg_index, seg.text, seg.start_ms, seg.end_ms ?? null],
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** Load cached timestamped segments for a video. Empty if not yet fetched. */
export async function getSegments(videoId: string): Promise<TranscriptSegment[]> {
  const client = await getDb();
  try {
    const { rows } = await client.query(
      'SELECT * FROM transcript_segments WHERE video_id = $1 ORDER BY seg_index',
      [videoId],
    );
    return rows.map((r: { seg_index: number; text: string; start_ms: number; end_ms: number | null }) => ({
      text: r.text,
      start_ms: r.start_ms,
      end_ms: r.end_ms,
      seg_index: r.seg_index,
    }));
  } finally {
    client.release();
  }
}
