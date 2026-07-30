/**
 * End-to-end smoke test for TAV-4: fetch a transcript for a real YouTube
 * video and run it through the Venice summarizer. Verifies the whole pipeline
 * (transcript fetch -> LLM call -> JSON parse) without needing the web server.
 *
 * Run: pnpm tsx scripts/smoke-summary.ts
 */
import { fetchTranscript } from '../src/lib/transcript';
import { summarizeVideo } from '../src/lib/summarize';

// A well-known English tech talk with reliable captions.
const VIDEO_ID = 'aircAruvnKk'; // 3Blue1Brown — "But what is a neural network?"
const VIDEO_TITLE = 'But what is a neural network?';
const CHANNEL_TITLE = '3Blue1Brown';

async function main() {
  console.log('1) Fetching transcript…');
  const transcript = await fetchTranscript(VIDEO_ID);
  if (!transcript) {
    console.error('FAIL: no transcript returned for', VIDEO_ID);
    process.exit(1);
  }
  console.log(`   ok (${transcript.source}, ${transcript.length} chars)`);

  console.log('2) Summarizing via Venice…');
  const summary = await summarizeVideo({
    videoId: VIDEO_ID,
    videoTitle: VIDEO_TITLE,
    channelTitle: CHANNEL_TITLE,
    transcript: transcript.text,
    recentUploads: [
      { video_id: 'aircAruvnKk', title: 'But what is a neural network?' },
      { video_id: 'IHZwWFHWa-w', title: 'Gradient descent, how neural networks learn' },
      { video_id: 'Ilg3gGewQ5U', title: 'What is backpropagation really doing?' },
    ],
  });

  console.log('\n=== TL;DR ===');
  console.log(summary.tldr);
  console.log('\n=== Key points ===');
  for (const p of summary.keyPoints) console.log(`  • ${p}`);
  console.log('\n=== Follow-ups ===');
  for (const f of summary.followUps) console.log(`  • ${f.title} (${f.video_id}) — ${f.reason}`);
  console.log(`\nmodel: ${summary.model}, tokens: ${summary.tokenCount ?? 'n/a'}`);

  if (!summary.tldr || summary.keyPoints.length === 0) {
    console.error('FAIL: empty summary');
    process.exit(1);
  }
  console.log('\nPASS');
}

main().catch(err => {
  console.error('FAIL:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
