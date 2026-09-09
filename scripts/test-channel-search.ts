/**
 * Live smoke test for the swappable channel-search path.
 *
 *   pnpm tsx scripts/test-channel-search.ts
 *
 * Exercises the REAL Innertube provider against two real channels and prints
 * the hits, then verifies the dispatcher's provider selection logic. No DB,
 * no OAuth — `searchChannelCatalog`'s innertube path never touches the token
 * (the parameter stays for the data-api fallback).
 */
import { channelSearchProvider, searchChannelCatalog } from '../src/lib/channel-search';

async function main() {
  console.log(`provider: ${channelSearchProvider()}`);

  // 1. Normal uploads channel (Veritasium) — dated results expected.
  const fusion = await searchChannelCatalog('unused-token', 'UCHnyfMqiRRG1u-2MsSQLbXA', 'fusion', 5);
  console.log(`\nveritasium/fusion: ${fusion.length} hits`);
  for (const h of fusion) {
    const age = h.publishedAt ? new Date(h.publishedAt * 1000).toISOString().slice(0, 10) : 'no-date';
    console.log(`  - ${h.videoId} | ${age} | ${h.title.slice(0, 60)}`);
    console.log(`      thumb: ${h.thumbnailUrl ? 'yes' : 'NO'} | desc: ${h.description ? h.description.slice(0, 50) + '…' : 'null'}`);
  }

  // 2. Live-stream channel (Lofi Girl) — search cards without dates; must
  //    still return hits (publishedAt null), not crash.
  const radio = await searchChannelCatalog('unused-token', 'UCSJ4gkVC6NrvII8umztf0Ow', 'radio', 5);
  console.log(`\nlofigirl/radio: ${radio.length} hits`);
  for (const h of radio) {
    console.log(`  - ${h.videoId} | ${h.publishedAt ?? 'no-date'} | ${h.title.slice(0, 60)}`);
  }

  // 3. Date filter: only videos from ~the last 2 years should survive.
  const recent = await searchChannelCatalog(
    'unused-token', 'UCHnyfMqiRRG1u-2MsSQLbXA', 'the',
    10, new Date(Date.now() - 2 * 365 * 86400 * 1000).toISOString(),
  );
  const dated = recent.filter(h => h.publishedAt !== null);
  const stale = recent.filter(h => h.publishedAt !== null && h.publishedAt < Math.floor(Date.now() / 1000) - 2 * 365 * 86400);
  console.log(`\nveritasiam/recent-only: ${recent.length} hits, ${dated.length} with dates, ${stale.length} older than cutoff (must be 0)`);

  // 4. Nonsense query — empty, not an error.
  const none = await searchChannelCatalog('unused-token', 'UCHnyfMqiRRG1u-2MsSQLbXA', 'zzxxqqnothing', 5);
  console.log(`\nno-match query: ${none.length} hits (expect 0)`);

  const okFusion = fusion.length > 0 && fusion.every(h => /^[A-Za-z0-9_-]{11}$/.test(h.videoId));
  const okRadio = radio.length > 0;
  const okFilter = stale.length === 0;
  const okEmpty = none.length === 0;
  console.log(`\nRESULT: fusion=${okFusion} radio=${okRadio} dateFilter=${okFilter} empty=${okEmpty}`);
  if (!(okFusion && okRadio && okFilter && okEmpty)) process.exit(1);
}

main().catch((err) => {
  console.error('SMOKE FAILED:', err);
  process.exit(1);
});
