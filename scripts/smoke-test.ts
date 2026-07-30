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

  // Cleanup
  await deleteChannel(channelId);
  await closePool();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
