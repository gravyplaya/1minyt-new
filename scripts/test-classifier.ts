/**
 * Verify the music classifier heuristics.
 * Run: npx tsx scripts/test-classifier.ts
 */
import { classifyMusic } from '../src/lib/music-classifier';

const cases: Array<{ name: string; ch: any; expected: 0 | 1 | 2 }> = [
  {
    name: 'VEVO channel',
    ch: { snippet: { title: 'Adele VEVO', customUrl: '@AdeleVEVO' }, topicDetails: { topicIds: ['/m/04rlf'] } },
    expected: 1,
  },
  {
    name: '" - Topic" auto-gen channel',
    ch: { snippet: { title: 'Adele - Topic' } },
    expected: 1,
  },
  {
    name: 'gaming channel',
    ch: { snippet: { title: 'Some Gamer', description: 'gameplay walkthrough tutorials' }, topicDetails: { topicIds: ['/m/0bzvm2'] } },
    expected: 2,
  },
  {
    name: 'unknown channel',
    ch: { snippet: { title: 'Random Channel' } },
    expected: 0,
  },
  {
    name: 'cooking channel',
    ch: { snippet: { title: 'Chef Marie', description: 'recipes and cooking tips' }, brandingSettings: { channel: { keywords: 'cooking,recipe,food' } } },
    expected: 2,
  },
  {
    name: 'official music keyword',
    ch: { snippet: { title: 'Mix Master' }, brandingSettings: { channel: { keywords: 'official music video lyric video' } } },
    expected: 1,
  },
];

let failed = 0;
for (const c of cases) {
  const got = classifyMusic(c.ch);
  const ok = got.flag === c.expected;
  console.log(`${ok ? '✓' : '✗'} ${c.name} → flag=${got.flag} score=${got.score.toFixed(2)} expected=${c.expected} ${got.reasons.length ? '(' + got.reasons.join('; ') + ')' : ''}`);
  if (!ok) failed++;
}
console.log(failed === 0 ? '\nALL CLASSIFIER TESTS PASSED' : `\n${failed} TEST(S) FAILED`);
process.exit(failed === 0 ? 0 : 1);