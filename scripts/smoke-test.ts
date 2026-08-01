/**
 * Smoke test: verify the DB layer works against the configured Postgres instance.
 * Requires DATABASE_URL to be set in .env.local.
 *
 * Run: pnpm tsx scripts/smoke-test.ts
 */
import { getDb, closePool } from '../src/lib/db';
import {
  createFolder,
  createTag,
  setChannelFolders,
  setChannelTags,
  upsertChannel,
  listChannels,
  getChannel,
  deleteChannel,
} from '../src/lib/repo';

async function main() {
  const now = Math.floor(Date.now() / 1000);
  const channelId = `UCsmoke${Date.now()}`;

  const channel = {
    channel_id: channelId,
    title: 'Smoke Test Channel',
    handle: '@smoke',
    description: 'A test channel',
    thumbnail_url: null,
    subscriber_count: 1234,
    video_count: 42,
    country: 'US',
    custom_url: '@smoke',
    music_flag: 0 as const,
    music_score: 0,
    hidden: 0 as const,
    notes: null,
    subscribed_at: now,
    synced_at: now,
    created_at: now,
    updated_at: now,
    // TAV-17: new persisted fields (null for test rows).
    topic_categories: null,
    banner_image_url: null,
    branding_keywords: null,
  };

  await upsertChannel(channel);
  const folder = await createFolder(`Test Folder ${Date.now()}`, '#ff6363');
  const tag = await createTag(`important-${Date.now()}`);
  await setChannelFolders(channelId, [folder.id]);
  await setChannelTags(channelId, [tag.id]);

  const fetched = await getChannel(channelId);
  if (!fetched) throw new Error('channel not found after insert');
  if (fetched.folder_ids.length !== 1) throw new Error('folder not associated');
  if (fetched.tag_ids.length !== 1) throw new Error('tag not associated');

  const all = await listChannels();
  if (!all.some(c => c.channel_id === channelId)) throw new Error('listChannels did not include test channel');

  const musicList = await listChannels({ onlyMusic: true });
  if (musicList.some(c => c.channel_id === channelId)) throw new Error('onlyMusic filter wrong');

  const searchList = await listChannels({ search: 'Smoke Test' });
  if (!searchList.some(c => c.channel_id === channelId)) throw new Error('search filter wrong');

  console.log('SMOKE OK —', {
    channel: fetched.title,
    folders: fetched.folder_ids.length,
    tags: fetched.tag_ids.length,
    listCount: all.length,
  });

  // TAV-26: assert the playlist tables + indexes exist and are queryable.
  const schemaClient = await getDb();
  try {
    const tableChecks = await schemaClient.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public'
         AND table_name IN ('channel_playlists', 'playlist_videos', 'playlist_summaries')`,
    );
    const found = new Set(tableChecks.rows.map(r => r.table_name));
    for (const t of ['channel_playlists', 'playlist_videos', 'playlist_summaries']) {
      if (!found.has(t)) throw new Error(`table ${t} not created`);
    }
    const idxChecks = await schemaClient.query<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes
       WHERE schemaname = 'public'
         AND indexname IN ('idx_channel_playlists_channel', 'idx_playlist_videos_position', 'uq_playlist_summary')`,
    );
    const idxFound = new Set(idxChecks.rows.map(r => r.indexname));
    for (const i of ['idx_channel_playlists_channel', 'idx_playlist_videos_position', 'uq_playlist_summary']) {
      if (!idxFound.has(i)) throw new Error(`index ${i} not created`);
    }
  } finally {
    schemaClient.release();
  }
  console.log('SMOKE OK — TAV-26 playlist tables + indexes verified');

  // Cleanup
  await deleteChannel(channelId);
  await closePool();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
