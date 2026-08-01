/**
 * TAV-18: unit tests for the RSS feed parser (`parseRssFeed`).
 *
 * Runs with Node's built-in test runner via tsx:
 *   pnpm tsx scripts/test-rss-parser.ts
 *
 * No network, no DB — `parseRssFeed` is a pure function, so we feed it a
 * representative slice of the real feed XML and assert on the parsed entries.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRssFeed } from '../src/lib/youtube';

// A trimmed copy of a real YouTube channel RSS feed (two <entry> blocks).
// Entities, media: thumbnails, and media:statistics are all exercised.
const SAMPLE_FEED = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns:media="http://search.yahoo.com/mrss/" xmlns="http://www.w3.org/2005/Atom">
 <title>Test Channel</title>
 <entry>
  <id>yt:video:8uncdjpygSU</id>
  <yt:videoId>8uncdjpygSU</yt:videoId>
  <yt:channelId>UC_x5XG1OV2P6uZZ5FSM9Ttw</yt:channelId>
  <title>The documentary all devs would watch tbh…</title>
  <link rel="alternate" href="https://www.youtube.com/shorts/8uncdjpygSU"/>
  <published>2026-07-31T04:00:35+00:00</published>
  <updated>2026-07-31T09:06:36+00:00</updated>
  <media:group>
   <media:title>The documentary all devs would watch tbh…</media:title>
   <media:thumbnail url="https://i1.ytimg.com/vi/8uncdjpygSU/hqdefault.jpg" width="480" height="360"/>
   <media:description>We know it&amp;#39;s going to be a good story, especially when you force-pushed to prod… on a FRIDAY.</media:description>
   <media:community>
    <media:starRating count="30" average="5.00" min="1" max="5"/>
    <media:statistics views="1973"/>
   </media:community>
  </media:group>
 </entry>
 <entry>
  <id>yt:video:BXzFk5kK5_Q</id>
  <yt:videoId>BXzFk5kK5_Q</yt:videoId>
  <yt:channelId>UC_x5XG1OV2P6uZZ5FSM9Ttw</yt:channelId>
  <title>Android Studio Quail 2 &amp; Build with Gemini XPRIZE</title>
  <link rel="alternate" href="https://www.youtube.com/watch?v=BXzFk5kK5_Q"/>
  <published>2026-07-30T16:00:39+00:00</published>
  <updated>2026-07-30T16:14:20+00:00</updated>
  <media:group>
   <media:title>Android Studio Quail 2 &amp; Build with Gemini XPRIZE</media:title>
   <media:thumbnail url="https://i3.ytimg.com/vi/BXzFk5kK5_Q/hqdefault.jpg" width="480" height="360"/>
   <media:description>Welcome to Google Developer News! Join Christy Yao as we dive into the latest tools, updates, and opportunities for developers. In this episode, we cover the stable release of Android Studio Quail 2, new model evaluations in Android Bench, an exclusive look at YouTube&amp;#39;s AI prototyping stack, and how you can compete for a share of $2,000,000 in the Build with Gemini XPRIZE!</media:description>
   <media:community>
    <media:starRating count="120" average="4.80" min="1" max="5"/>
    <media:statistics views="5430"/>
   </media:community>
  </media:group>
 </entry>
</feed>`;

test('parseRssFeed extracts entries in feed order (newest first)', () => {
  const entries = parseRssFeed(SAMPLE_FEED);
  assert.equal(entries.length, 2, 'should parse both <entry> blocks');
  assert.equal(entries[0].videoId, '8uncdjpygSU');
  assert.equal(entries[1].videoId, 'BXzFk5kK5_Q');
});

test('parseRssFeed decodes XML entities in title and description', () => {
  const entries = parseRssFeed(SAMPLE_FEED);
  // The &amp; in the second title must decode to '&'.
  assert.equal(entries[1].title, 'Android Studio Quail 2 & Build with Gemini XPRIZE');
  // The &amp;#39; in the first description must decode to '&#39;' then to "'".
  assert.ok(entries[0].description!.includes("it's going to be a good story"),
    `expected decoded apostrophe in description, got: ${entries[0].description}`);
});

test('parseRssFeed extracts thumbnail url and view count', () => {
  const entries = parseRssFeed(SAMPLE_FEED);
  assert.equal(entries[0].thumbnailUrl, 'https://i1.ytimg.com/vi/8uncdjpygSU/hqdefault.jpg');
  assert.equal(entries[0].viewCount, 1973);
  assert.equal(entries[1].viewCount, 5430);
});

test('parseRssFeed parses published ISO-8601 to unix seconds', () => {
  const entries = parseRssFeed(SAMPLE_FEED);
  // Compute the expected unix seconds from the same ISO strings to avoid
  // hardcoding a value that drifts with timezone interpretation.
  const expected0 = Math.floor(Date.parse('2026-07-31T04:00:35+00:00') / 1000);
  const expected1 = Math.floor(Date.parse('2026-07-30T16:00:39+00:00') / 1000);
  assert.equal(entries[0].publishedAt, expected0);
  assert.equal(entries[1].publishedAt, expected1);
});

test('parseRssFeed returns [] for an empty or malformed feed', () => {
  assert.deepEqual(parseRssFeed(''), []);
  assert.deepEqual(parseRssFeed('<html>not xml</html>'), []);
  // An entry missing <yt:videoId> is skipped, not stored with a null id.
  const noIdFeed = `<feed><entry><title>no id</title></entry></feed>`;
  assert.deepEqual(parseRssFeed(noIdFeed), []);
});

test('parseRssFeed handles a feed with no view statistics (viewCount null)', () => {
  const noStats = `<?xml version="1.0"?><feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns:media="http://search.yahoo.com/mrss/">
   <entry>
    <id>yt:video:ABC123</id>
    <yt:videoId>ABC123</yt:videoId>
    <title>No stats</title>
    <published>2026-07-29T23:00:37+00:00</published>
    <media:group>
     <media:description>desc</media:description>
    </media:group>
   </entry>
  </feed>`;
  const entries = parseRssFeed(noStats);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].videoId, 'ABC123');
  assert.equal(entries[0].viewCount, null);
  assert.equal(entries[0].thumbnailUrl, null);
});
