/**
 * Smoke test for TAV-5: verifies the local embedding vectorizer, chunking, and
 * cosine similarity search work end-to-end without any network calls or API keys.
 *
 * Run: pnpm tsx scripts/smoke-chat.ts
 */
import { embed, embedQuery, cosineSim, EMBEDDING_DIM } from '../src/lib/embeddings';
import { chunkSegments } from '../src/lib/vector-store';
import type { TranscriptSegment } from '../src/lib/types';

let passed = 0;
let failed = 0;

function check(name: string, condition: boolean, detail?: string) {
  const status = condition ? 'PASS' : 'FAIL';
  if (condition) passed++;
  else failed++;
  console.log(`  ${status} — ${name}${detail ? ` (${detail})` : ''}`);
}

console.log('TAV-5 smoke test — local embeddings + chunking\n');

// Test 1: Embedding produces correct dimension
const v = embedQuery('hello world');
check('embedding dimension', v.length === EMBEDDING_DIM, `${v.length} dims`);

// Test 2: Similar texts have higher similarity than dissimilar
const v1 = embedQuery('neural network training');
const v2 = embedQuery('neural network learning');
const v3 = embedQuery('chocolate cake recipe');
const sim12 = cosineSim(v1, v2);
const sim13 = cosineSim(v1, v3);
check('similar > dissimilar', sim12 > sim13, `sim=${sim12.toFixed(3)} vs ${sim13.toFixed(3)}`);

// Test 3: Self-similarity is ~1
const self = cosineSim(v1, v1);
check('self-similarity ≈ 1', Math.abs(self - 1) < 0.01, `${self.toFixed(3)}`);

// Test 4: Batch embed returns correct count
const batch = embed(['one', 'two', 'three']);
check('batch count', batch.vectors.length === 3, `${batch.vectors.length} vectors`);

// Test 5: Chunking produces reasonable chunks
const segs: TranscriptSegment[] = [];
for (let i = 0; i < 20; i++) {
  segs.push({
    text: `This is segment number ${i} about topic ${i % 3}. It contains some words for testing.`,
    start_ms: i * 5000,
    end_ms: (i + 1) * 5000,
    seg_index: i,
  });
}
const chunks = chunkSegments(segs);
check('chunking reduces count', chunks.length > 0 && chunks.length < 20, `${chunks.length} chunks from 20 segs`);
check('first chunk starts at 0', chunks[0]?.start_ms === 0, `start_ms=${chunks[0]?.start_ms}`);

// Test 6: Empty text handling (should not crash)
const emptyVec = embedQuery('');
check('empty text handled', emptyVec.length === EMBEDDING_DIM, `${emptyVec.length} dims`);

// Test 7: L2 normalization (norm should be 0 or 1)
const norm = Math.sqrt(embedQuery('some text here').reduce((s, x) => s + x * x, 0));
check('L2 normalized', Math.abs(norm - 1) < 0.01 || norm === 0, `norm=${norm.toFixed(4)}`);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
console.log('PASS');