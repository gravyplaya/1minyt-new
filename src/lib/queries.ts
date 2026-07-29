import { getDb } from './db';
import { listChannels } from './repo';
import type { ChannelQuery } from './types';

/**
 * Aggregate counts for the sidebar badges. Single round-trip; cheap because
 * we only fetch four small numbers from SQLite.
 */
export function countChannels() {
  const db = getDb();
  const total = (db.prepare('SELECT COUNT(*) as n FROM channels WHERE hidden = 0').get() as { n: number }).n;
  const unfiled = (db.prepare(`
    SELECT COUNT(*) as n FROM channels c
    WHERE c.hidden = 0
      AND (c.music_flag IS NULL OR c.music_flag != 1)
      AND NOT EXISTS (SELECT 1 FROM channel_folders cf WHERE cf.channel_id = c.channel_id)
  `).get() as { n: number }).n;
  const music = (db.prepare('SELECT COUNT(*) as n FROM channels WHERE music_flag = 1').get() as { n: number }).n;
  const hidden = (db.prepare('SELECT COUNT(*) as n FROM channels WHERE hidden = 1').get() as { n: number }).n;
  return { total, unfiled, music, hidden };
}

/**
 * Thin wrapper around listChannels with string-ish inputs from search params.
 * Centralizes the parsing so the page component doesn't grow a forest of `??`.
 */
export function queryChannelsFromParams(params: {
  q?: string;
  folder?: string | null;
  tag?: string | null;
  sort?: string;
  dir?: string;
  showMusic?: string;
  showHidden?: string;
}) {
  const query: ChannelQuery = {};
  if (params.q) query.search = params.q;
  if (params.folder) query.folderId = params.folder;
  if (params.tag) query.tagId = params.tag;
  if (params.sort === 'recent' || params.sort === 'alpha' || params.sort === 'subscribers' || params.sort === 'videos' || params.sort === 'updated') {
    query.sort = params.sort;
  }
  if (params.dir === 'asc' || params.dir === 'desc') query.dir = params.dir;
  query.includeMusic = params.showMusic === '1';
  query.onlyMusic = params.showMusic === '1';
  query.hidden = params.showHidden === '1';
  return listChannels(query);
}