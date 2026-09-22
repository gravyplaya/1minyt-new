/**
 * Smoke test for TAV-70: verifies the JEV decision layer end-to-end against
 * OpenRouter's alpha decisions endpoint — typed answers (noul/choice/score)
 * in one batched request, and rerankByRelevance ordering. Requires
 * OPENROUTER_API_KEY; skips (exit 0) when unset so the script stays safe in
 * key-less environments.
 *
 * Run: pnpm smoke:decision
 */
import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { askDecisions, rerankByRelevance } from '../src/lib/decision';
import type { DecisionQuestion } from '../src/lib/decision';

let passed = 0;
let failed = 0;

function check(name: string, condition: boolean, detail?: string) {
  const status = condition ? 'PASS' : 'FAIL';
  if (condition) passed++;
  else failed++;
  console.log(`  ${status} — ${name}${detail ? ` (${detail})` : ''}`);
}

async function main() {
  // tsx (unlike Next's dev server) doesn't load .env files — do it ourselves
  // so the smoke runs with the same key the app uses. loadEnvFile never
  // overrides shell-exported vars; a missing file or older Node falls through
  // to the SKIP guard below.
  for (const file of ['.env.local', '.env']) {
    try {
      if (existsSync(file)) loadEnvFile(file);
    } catch {
      // Not fatal — keep going and let the guard decide.
    }
  }

  if (!process.env.OPENROUTER_API_KEY?.trim()) {
    console.log('SKIP — OPENROUTER_API_KEY not set; nothing to smoke test.');
    return;
  }

  console.log('TAV-70 smoke test — JEV decision layer via OpenRouter\n');

  // Test 1: all three primitives in one batched request.
  const questions: Record<string, DecisionQuestion> = {
    is_urgent: {
      type: 'noul',
      instructions: 'Does this message convey urgency?',
      criteria: { true: 'Explicitly time-sensitive', false: 'No urgency expressed' },
    },
    department: {
      type: 'choice',
      instructions: 'Which team should handle this?',
      criteria: {
        billing: 'Payments, invoicing, refunds',
        technical: 'Bugs, outages, integrations',
      },
    },
    frustration: {
      type: 'score',
      instructions: 'How frustrated is the customer?',
      criteria: ['Calm', 'Frustrated', 'Very angry'],
    },
  };
  const res = await askDecisions('Help! My payouts have been failing for 3 days.', questions);
  check('askDecisions returns answers', !!res?.answers, res ? `model=${res.model}` : 'null');

  if (res) {
    const noul = res.answers['is_urgent'];
    check(
      'noul answer is a probability in [0,1]',
      noul?.type === 'noul' && noul.noul >= 0 && noul.noul <= 1,
      noul?.type === 'noul' ? `noul=${noul.noul.toFixed(2)}` : `type=${noul?.type}`,
    );

    const choiceQ = questions['department'];
    const choice = res.answers['department'];
    const options = choiceQ?.type === 'choice' ? Object.keys(choiceQ.criteria) : [];
    check(
      'choice answer picks a defined option',
      choice?.type === 'choice' && options.includes(choice.choice),
      choice?.type === 'choice' ? `choice=${choice.choice}` : `type=${choice?.type}`,
    );

    const score = res.answers['frustration'];
    check(
      'score lands on the rubric [0, levels-1]',
      score?.type === 'score' && score.score >= 0 && score.score <= 2,
      score?.type === 'score' ? `score=${score.score.toFixed(2)}` : `type=${score?.type}`,
    );

    check('usage reported', res.usage.input_tokens > 0, `${res.usage.input_tokens} in / ${res.usage.output_tokens} out`);
  }

  // Test 2: rerankByRelevance puts the on-topic passage first, drops nothing.
  const pool = [
    { chunkText: 'Preheat the oven to 350 degrees and cream the butter with sugar for the cake batter.' },
    { chunkText: 'The gradient descent update rule subtracts the learning rate times the gradient of the loss.' },
    { chunkText: 'Today the host discussed his favorite hiking trails in the Pacific Northwest.' },
    { chunkText: 'Cast on forty stitches and work the ribbing in knit two, purl two for the scarf edge.' },
    { chunkText: 'Backpropagation computes the gradient of the loss with respect to every weight in the network.' },
  ];
  const reranked = await rerankByRelevance('How does gradient descent update the model weights during training?', pool);
  check(
    'rerank puts the on-topic passage first',
    reranked[0]?.chunkText.includes('gradient descent') === true,
    `first="${reranked[0]?.chunkText.slice(0, 50)}…"`,
  );
  check('rerank never drops candidates', reranked.length === pool.length, `${reranked.length}/${pool.length}`);

  // Test 3: graceful fallback — a JEV failure must return the input untouched.
  // (Simulated by an empty query, one of the documented pass-through guards.)
  const untouched = await rerankByRelevance('', pool);
  check('empty query returns input order', untouched[0] === pool[0], 'guard hit');

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
  console.log('PASS');
}

main().catch(err => {
  console.error(`\nFAIL — unexpected error: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
