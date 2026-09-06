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
import type { TranscriptSegment, TranscriptChunk, TranscriptSearchResult } from './types';

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
      // TAV-30: only delete transcript chunks — summary chunks coexist now.
      await client.query('DELETE FROM transcript_chunks WHERE video_id = $1 AND chunk_type = \'transcript\'', [videoId]);
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        const vec = vectors[i];
        if (!vec) continue;
        const blob = Buffer.from(vec.buffer, vec.byteOffset, vec.byteLength);
        await client.query(
          `INSERT INTO transcript_chunks (id, video_id, chunk_index, text, start_ms, end_ms, embedding, embed_model, created_at, chunk_type)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'transcript')`,
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

// ----- TAV-30: summary indexing ---------------------------------------------

/**
 * Index a video's summary as a single searchable chunk. The chunk text combines
 * the TL;DR, key points, and topic tags so a searchAcross query can surface the
 * video by what its summary says — without anyone having to chat with it first.
 *
 * Uses chunk_index = -1 and chunk_type = 'summary' to stay distinct from
 * transcript chunks. start_ms/end_ms are 0/null — a summary isn't timestamped.
 * Idempotent: replaces any prior summary chunk for this video before inserting.
 */
export async function indexSummary(videoId: string, summary: {
  tldr: string;
  key_points: string[];
  topics: string[];
}): Promise<IndexResult> {
  try {
    const text = buildSummaryChunkText(summary);
    if (!text.trim()) {
      return { ok: false, videoId, chunkCount: 0, embedModel: EMBEDDING_MODEL, error: 'Summary produced no indexable text.' };
    }

    const { vectors, model } = embed([text]);
    const vec = vectors[0];
    if (!vec) {
      return { ok: false, videoId, chunkCount: 0, embedModel: EMBEDDING_MODEL, error: 'Embedding returned no vector.' };
    }

    const client = await getDb();
    try {
      const now = Math.floor(Date.now() / 1000);
      const blob = Buffer.from(vec.buffer, vec.byteOffset, vec.byteLength);
      await client.query('BEGIN');
      await client.query('DELETE FROM transcript_chunks WHERE video_id = $1 AND chunk_type = \'summary\'', [videoId]);
      await client.query(
        `INSERT INTO transcript_chunks (id, video_id, chunk_index, text, start_ms, end_ms, embedding, embed_model, created_at, chunk_type)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'summary')`,
        [newId(), videoId, -1, text, 0, null, blob, model, now],
      );
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }

    return { ok: true, videoId, chunkCount: 1, embedModel: model };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, videoId, chunkCount: 0, embedModel: EMBEDDING_MODEL, error: msg };
  }
}

/** Build a single indexable text blob from a summary's distilled fields. */
function buildSummaryChunkText(summary: { tldr: string; key_points: string[]; topics: string[] }): string {
  const parts: string[] = [];
  if (summary.tldr.trim()) parts.push(summary.tldr.trim());
  if (summary.key_points.length > 0) {
    parts.push(summary.key_points.map(p => `• ${p}`).join('\n'));
  }
  if (summary.topics.length > 0) {
    parts.push(`Topics: ${summary.topics.join(', ')}`);
  }
  return parts.join('\n\n');
}

/** Whether a video has been indexed (transcript chunks exist in the store). */
export async function isIndexed(videoId: string): Promise<boolean> {
  const client = await getDb();
  try {
    const { rows } = await client.query('SELECT 1 FROM transcript_chunks WHERE video_id = $1 AND chunk_type = \'transcript\' LIMIT 1', [videoId]);
    return rows.length > 0;
  } finally {
    client.release();
  }
}

/** Count indexed transcript chunks for a video — useful for UI status. */
export async function chunkCount(videoId: string): Promise<number> {
  const client = await getDb();
  try {
    const { rows } = await client.query('SELECT COUNT(*) as n FROM transcript_chunks WHERE video_id = $1 AND chunk_type = \'transcript\'', [videoId]);
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

// ----- cross-video search (TAV-10) ------------------------------------------

/**
 * Search across *all* indexed transcript chunks. Returns the top-k matches
 * with joined video and channel metadata for display.
 *
 * Like `search()` but without the single-video filter. We fetch all chunks
 * (with a video/channel join) and score in JS — fine for the current scale
 * (hundreds to low-thousands of chunks across a subscription library).
 *
 * Pass `channelId` to restrict scoring to a single channel's chunks. That
 * pushes the filter into SQL so cosine scoring only runs over that channel's
 * rows, instead of loading every channel's chunks and filtering in JS.
 */
export async function searchAcross(
  query: string,
  k = 20,
  channelId?: string,
): Promise<TranscriptSearchResult[]> {
  const client = await getDb();
  try {
    const params: (string | Buffer)[] = [];
    let where = '';
    if (channelId) {
      params.push(channelId);
      where = 'WHERE v.channel_id = $1';
    }
    const { rows } = await client.query(
      `SELECT tc.text, tc.start_ms, tc.end_ms, tc.embedding, tc.chunk_type,
              v.video_id, v.title AS video_title, v.channel_id,
              c.title AS channel_title
       FROM transcript_chunks tc
       JOIN videos v   ON v.video_id = tc.video_id
       JOIN channels c  ON c.channel_id = v.channel_id
       ${where}
       ORDER BY tc.video_id, tc.chunk_index`,
      params,
    );

    if (rows.length === 0) return [];

    const queryVec = embedQuery(query);

    const scored: TranscriptSearchResult[] = rows.map((row: {
      text: string;
      start_ms: number;
      end_ms: number | null;
      embedding: Buffer;
      chunk_type: string;
      video_id: string;
      video_title: string;
      channel_id: string;
      channel_title: string;
    }) => {
      const chunkVec = new Float32Array(row.embedding.buffer, row.embedding.byteOffset, row.embedding.byteLength / 4);
      const score = cosineSim(queryVec, chunkVec);
      return {
        videoId: row.video_id,
        videoTitle: row.video_title,
        channelId: row.channel_id,
        channelTitle: row.channel_title,
        chunkText: row.text,
        startMs: row.start_ms,
        endMs: row.end_ms,
        score,
        chunkType: row.chunk_type === 'summary' ? 'summary' : 'transcript',
      };
    });

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, k);
  } finally {
    client.release();
  }
}

// ----- library-wide scoped search (TAV-63, E + F) ----------------------------

/** Optional filters for library-wide retrieval. Undefined/null = no filter. */
export interface LibrarySearchOpts {
  /** Restrict to one channel's chunks. */
  channelId?: string | null;
  /** Restrict to channels filed in this folder (channel_folders join). */
  folderId?: string | null;
  /** Restrict to channels carrying this tag (channel_tags join). */
  tagId?: string | null;
  /** 'transcript' | 'summary' — omit for both. */
  chunkType?: 'transcript' | 'summary' | null;
}

/**
 * Search across the whole (or scoped) library like `searchAcross`, but with
 * folder/tag/chunk-type filters so /chat can ground answers in a collection —
 * "chat with my Tech folder", "search only this channel's summaries".
 *
 * Filters are pushed into SQL so cosine scoring only runs over the matching
 * rows. Scale is the same as `searchAcross` (hundreds to low-thousands of
 * chunks), scored in JS.
 */
export async function searchLibrary(
  query: string,
  k = 20,
  opts: LibrarySearchOpts = {},
): Promise<TranscriptSearchResult[]> {
  const client = await getDb();
  try {
    const params: (string | Buffer)[] = [];
    const joins: string[] = [];
    const where: string[] = [];

    if (opts.channelId) {
      params.push(opts.channelId);
      where.push(`v.channel_id = $${params.length}`);
    }
    if (opts.folderId) {
      params.push(opts.folderId);
      joins.push('JOIN channel_folders cf ON cf.channel_id = c.channel_id AND cf.folder_id = $' + params.length);
      where.push('c.hidden = 0');
    }
    if (opts.tagId) {
      params.push(opts.tagId);
      joins.push('JOIN channel_tags ct ON ct.channel_id = c.channel_id AND ct.tag_id = $' + params.length);
      where.push('c.hidden = 0');
    }
    if (opts.chunkType) {
      params.push(opts.chunkType);
      where.push(`tc.chunk_type = $${params.length}`);
    }

    const { rows } = await client.query(
      `SELECT tc.text, tc.start_ms, tc.end_ms, tc.embedding, tc.chunk_type,
              v.video_id, v.title AS video_title, v.channel_id,
              c.title AS channel_title
       FROM transcript_chunks tc
       JOIN videos v   ON v.video_id = tc.video_id
       JOIN channels c  ON c.channel_id = v.channel_id
       ${joins.join('\n       ')}
       ${where.length > 0 ? 'WHERE ' + where.join(' AND ') : ''}
       ORDER BY tc.video_id, tc.chunk_index`,
      params,
    );

    if (rows.length === 0) return [];

    const queryVec = embedQuery(query);

    const scored: TranscriptSearchResult[] = rows.map((row: {
      text: string;
      start_ms: number;
      end_ms: number | null;
      embedding: Buffer;
      chunk_type: string;
      video_id: string;
      video_title: string;
      channel_id: string;
      channel_title: string;
    }) => {
      const chunkVec = new Float32Array(row.embedding.buffer, row.embedding.byteOffset, row.embedding.byteLength / 4);
      const score = cosineSim(queryVec, chunkVec);
      return {
        videoId: row.video_id,
        videoTitle: row.video_title,
        channelId: row.channel_id,
        channelTitle: row.channel_title,
        chunkText: row.text,
        startMs: row.start_ms,
        endMs: row.end_ms,
        score,
        chunkType: row.chunk_type === 'summary' ? 'summary' : 'transcript',
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
