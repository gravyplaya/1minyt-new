/**
 * CLI: run `pnpm run sync:videos` to refresh recent uploads for every channel
 * using the RSS-first sync path (TAV-18).
 *
 * This is the cron-friendly entry point for hourly video sync. Because RSS is
 * free and unauthenticated, this can run far more frequently than the
 * subscription sync (`pnpm run sync`) without consuming YouTube Data API quota
 * — the API is only touched to enrich newly-detected video ids with duration,
 * tags, and category.
 *
 * Suggested crontab (hourly):
 *   0 * * * *  cd /path/to/1minyt && pnpm run sync:videos >> /tmp/1minyt-videos.log 2>&1
 *
 * Keep `pnpm run sync` (subscription refresh) on a slower cadence — e.g. daily —
 * since it always costs API quota.
 */
import { listChannels } from '../src/lib/repo';
import { syncChannelVideos } from '../src/lib/video-sync';
import { closePool } from '../src/lib/db';

async function main() {
  const channels = await listChannels({ hidden: false, includeMusic: true, limit: 500 });
  console.log(`Syncing videos for ${channels.length} channel(s)...`);

  let totalFetched = 0;
  let rssChannels = 0;
  const errors: string[] = [];

  for (const channel of channels) {
    const result = await syncChannelVideos(channel.channel_id, 15);
    totalFetched += result.fetched;
    if (result.rss) rssChannels += 1;
    if (result.errors.length > 0) {
      errors.push(`${channel.title}: ${result.errors.join('; ')}`);
    }
  }

  const summary = {
    channels: channels.length,
    fetched: totalFetched,
    rssChannels,
    apiFallbackChannels: channels.length - rssChannels,
    errors,
  };
  console.log(JSON.stringify(summary, null, 2));
  if (errors.length > 0) process.exit(1);
}

main()
  .catch(err => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => closePool());
