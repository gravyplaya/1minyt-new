/**
 * Smoke test: verify the DB layer works against the configured Postgres instance.
 * Requires DATABASE_URL to be set in .env.local.
 *
 * TAV-68: runs as a synthetic smoke-test user id (user_id columns carry no FK
 * to users, so a users row isn't needed) and additionally asserts the
 * multi-user schema surgery applied (composite PK on channels, per-user
 * unique indexes, users/sessions tables).
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

const SMOKE_USER = 'smoke-test-user';

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

  await upsertChannel(SMOKE_USER, channel);
  const folder = await createFolder(SMOKE_USER, `Test Folder ${Date.now()}`, '#ff6363');
  const tag = await createTag(SMOKE_USER, `important-${Date.now()}`);
  await setChannelFolders(SMOKE_USER, channelId, [folder.id]);
  await setChannelTags(SMOKE_USER, channelId, [tag.id]);

  const fetched = await getChannel(SMOKE_USER, channelId);
  if (!fetched) throw new Error('channel not found after insert');
  if (fetched.folder_ids.length !== 1) throw new Error('folder not associated');
  if (fetched.tag_ids.length !== 1) throw new Error('tag not associated');

  // Isolation: another user must not see the smoke channel.
  const otherUser = await listChannels('smoke-other-user');
  if (otherUser.some(c => c.channel_id === channelId)) {
    throw new Error('user isolation broken — other user sees smoke channel');
  }

  const all = await listChannels(SMOKE_USER);
  if (!all.some(c => c.channel_id === channelId)) throw new Error('listChannels did not include test channel');

  const musicList = await listChannels(SMOKE_USER, { onlyMusic: true });
  if (musicList.some(c => c.channel_id === channelId)) throw new Error('onlyMusic filter wrong');

  const searchList = await listChannels(SMOKE_USER, { search: 'Smoke Test' });
  if (!searchList.some(c => c.channel_id === channelId)) throw new Error('search filter wrong');

  console.log('SMOKE OK —', {
    channel: fetched.title,
    folders: fetched.folder_ids.length,
    tags: fetched.tag_ids.length,
    listCount: all.length,
  });

  // TAV-26: assert the playlist tables + indexes exist and are queryable.
  // TAV-68: assert the multi-user schema surgery applied.
  const schemaClient = await getDb();
  try {
    const tableChecks = await schemaClient.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public'
         AND table_name IN ('channel_playlists', 'playlist_videos', 'playlist_summaries', 'users', 'sessions')`,
    );
    const found = new Set(tableChecks.rows.map(r => r.table_name));
    for (const t of ['channel_playlists', 'playlist_videos', 'playlist_summaries', 'users', 'sessions']) {
      if (!found.has(t)) throw new Error(`table ${t} not created`);
    }
    const idxChecks = await schemaClient.query<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes
       WHERE schemaname = 'public'
         AND indexname IN ('idx_channel_playlists_channel', 'idx_playlist_videos_position', 'uq_playlist_summary_user',
                           'uq_summaries_user_video_model', 'uq_folders_user_name', 'uq_tags_user_name')`,
    );
    const idxFound = new Set(idxChecks.rows.map(r => r.indexname));
    for (const i of ['idx_channel_playlists_channel', 'idx_playlist_videos_position', 'uq_playlist_summary_user',
                     'uq_summaries_user_video_model', 'uq_folders_user_name', 'uq_tags_user_name']) {
      if (!idxFound.has(i)) throw new Error(`index ${i} not created`);
    }
    // channels PK must be the user-scoped composite (in key order, not table
    // column order — unnest with ordinality preserves the constraint's order).
    const pkCheck = await schemaClient.query<{ attname: string }>(
      `SELECT a.attname
         FROM pg_constraint c
         JOIN LATERAL unnest(c.conkey) WITH ORDINALITY AS x(attnum, ord) ON true
         JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = x.attnum
        WHERE c.conrelid = 'channels'::regclass AND c.contype = 'p'
        ORDER BY x.ord`,
    );
    const pkCols = pkCheck.rows.map(r => r.attname);
    if (pkCols.join(',') !== 'user_id,channel_id') {
      throw new Error(`channels PK is not (user_id, channel_id) — got (${pkCols.join(',')})`);
    }
  } finally {
    schemaClient.release();
  }
  console.log('SMOKE OK — TAV-26 playlist tables + TAV-68 multi-user schema verified');

  // Cleanup
  await deleteChannel(SMOKE_USER, channelId);
  await closePool();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
