/**
 * Verify the music video presentation heuristic + override precedence (TAV-62).
 * Run: npx tsx scripts/test-music-video-pref.ts
 */
import { computeMusicVideoPresentation } from '../src/lib/music-video-pref';

const cases: Array<{
  name: string;
  input: Parameters<typeof computeMusicVideoPresentation>[0];
  expectedPref: 'video' | 'audio';
  expectedSource: 'override' | 'heuristic';
}> = [
  // ----- Overrides win over everything ---------------------------------------
  {
    name: 'override video beats audio-looking title',
    input: { title: 'Song (Official Audio)', videoPref: 'video' },
    expectedPref: 'video',
    expectedSource: 'override',
  },
  {
    name: 'override audio beats video-looking title',
    input: { title: 'Song (Official Music Video)', videoPref: 'audio' },
    expectedPref: 'audio',
    expectedSource: 'override',
  },
  {
    name: 'override video beats - Topic channel',
    input: { title: 'Song', channelTitle: 'Adele - Topic', videoPref: 'video' },
    expectedPref: 'video',
    expectedSource: 'override',
  },

  // ----- Title signals --------------------------------------------------------
  {
    name: 'official music video title → video',
    input: { title: 'Adele - Hello (Official Music Video)' },
    expectedPref: 'video',
    expectedSource: 'heuristic',
  },
  {
    name: 'official video title → video',
    input: { title: 'Song - Track Name (Official Video)' },
    expectedPref: 'video',
    expectedSource: 'heuristic',
  },
  {
    name: 'visualizer title → video',
    input: { title: 'Song (Official Visualizer)' },
    expectedPref: 'video',
    expectedSource: 'heuristic',
  },
  {
    name: 'official audio title → audio',
    input: { title: 'Song (Official Audio)' },
    expectedPref: 'audio',
    expectedSource: 'heuristic',
  },
  {
    name: 'lyric video title → audio',
    input: { title: 'Song (Official Lyric Video)' },
    expectedPref: 'audio',
    expectedSource: 'heuristic',
  },
  {
    name: 'plain title, no signals → audio default',
    input: { title: 'Song Title' },
    expectedPref: 'audio',
    expectedSource: 'heuristic',
  },

  // ----- Channel signals ------------------------------------------------------
  {
    name: 'VEVO channel, plain title → video',
    input: { title: 'Song Title', channelTitle: 'AdeleVEVO' },
    expectedPref: 'video',
    expectedSource: 'heuristic',
  },
  {
    name: 'Records channel, plain title → video',
    input: { title: 'Song Title', channelTitle: 'Blue Note Records' },
    expectedPref: 'video',
    expectedSource: 'heuristic',
  },
  {
    name: 'Official channel, plain title → video',
    input: { title: 'Song Title', channelTitle: 'The Official Channel' },
    expectedPref: 'video',
    expectedSource: 'heuristic',
  },
  {
    name: 'audio marker beats VEVO channel',
    input: { title: 'Song (Official Audio)', channelTitle: 'AdeleVEVO' },
    expectedPref: 'audio',
    expectedSource: 'heuristic',
  },
  {
    name: '- Topic channel, plain title → audio',
    input: { title: 'Song Title', channelTitle: 'Adele - Topic' },
    expectedPref: 'audio',
    expectedSource: 'heuristic',
  },
  {
    name: 'video title beats - Topic channel',
    input: { title: 'Song (Official Video)', channelTitle: 'Adele - Topic' },
    expectedPref: 'video',
    expectedSource: 'heuristic',
  },

  // ----- Category tiebreaker ---------------------------------------------------
  {
    name: 'music category, unknown channel, plain title → video',
    input: { title: 'Song Title', categoryId: 10 },
    expectedPref: 'video',
    expectedSource: 'heuristic',
  },
  {
    name: 'music category loses to - Topic channel',
    input: { title: 'Song Title', channelTitle: 'Artist - Topic', categoryId: 10 },
    expectedPref: 'audio',
    expectedSource: 'heuristic',
  },
  {
    name: 'non-music category, unknown channel, plain title → audio default',
    input: { title: 'Song Title', categoryId: 22 },
    expectedPref: 'audio',
    expectedSource: 'heuristic',
  },

  // ----- Tags last resort -------------------------------------------------------
  {
    name: 'tags with music video marker → video',
    input: { title: 'Untitled Upload', tags: JSON.stringify(['ArtistName', 'Official Music Video']) },
    expectedPref: 'video',
    expectedSource: 'heuristic',
  },
  {
    name: 'tags with audio marker → audio',
    input: { title: 'Untitled Upload', tags: JSON.stringify(['ArtistName', 'lyrics']) },
    expectedPref: 'audio',
    expectedSource: 'heuristic',
  },
  {
    name: 'malformed tags JSON ignored → audio default',
    input: { title: 'Untitled Upload', tags: '{not json' },
    expectedPref: 'audio',
    expectedSource: 'heuristic',
  },
];

let failed = 0;
for (const c of cases) {
  const got = computeMusicVideoPresentation(c.input);
  const ok = got.pref === c.expectedPref && got.source === c.expectedSource;
  console.log(
    `${ok ? '✓' : '✗'} ${c.name} → pref=${got.pref} source=${got.source} expected=${c.expectedPref}/${c.expectedSource}`,
  );
  if (!ok) failed++;
}
console.log(failed === 0 ? '\nALL VIDEO-PREF TESTS PASSED' : `\n${failed} TEST(S) FAILED`);
process.exit(failed === 0 ? 0 : 1);
