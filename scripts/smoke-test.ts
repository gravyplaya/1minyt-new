/**
 * Smoke test: verify the DB layer works without touching the network.
 * Creates a temporary DB in /tmp, inserts a fake channel, queries it back.
 */
import { getDb } from '../src/lib/db';
import {
  createFolder,
  createTag,
  setChannelFolders,
  setChannelTags,
  upsertChannel,
  listChannels,
  getChannel,
} from '../src/lib/repo';

process.env.DATABASE_PATH = `/tmp/1minyt-smoke-${Date.now()}.db`;

const now = Math.floor(Date.now() / 1000);

const channel = {
  channel_id: 'UCsmoke123',
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

upsertChannel(channel);
const folder = createFolder('Test Folder', '#ff6363');
const tag = createTag('important');
setChannelFolders(channel.channel_id, [folder.id]);
setChannelTags(channel.channel_id, [tag.id]);

const fetched = getChannel(channel.channel_id);
if (!fetched) throw new Error('channel not found after insert');
if (fetched.folder_ids.length !== 1) throw new Error('folder not associated');
if (fetched.tag_ids.length !== 1) throw new Error('tag not associated');

const all = listChannels();
if (all.length !== 1) throw new Error('listChannels returned wrong count');

const musicList = listChannels({ onlyMusic: true });
if (musicList.length !== 0) throw new Error('onlyMusic filter wrong');

const searchList = listChannels({ search: 'Smoke' });
if (searchList.length !== 1) throw new Error('search filter wrong');

console.log('SMOKE OK —', {
  channel: fetched.title,
  folders: fetched.folder_ids.length,
  tags: fetched.tag_ids.length,
  listCount: all.length,
});