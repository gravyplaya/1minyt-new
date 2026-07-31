import { getDb } from './db';
import { listChannelsPage } from './repo';
import type { ChannelQuery, PaginatedChannels } from './types';

/** Default number of channels per page. */
export const CHANNEL_PAGE_SIZE = 25;

/** Available page-size options for the toolbar dropdown. */
export const PAGE_SIZE_OPTIONS = [10, 25, 50] as const;

/**
 * Aggregate counts for the sidebar badges.
 */
export async function countChannels() {
  const client = await getDb();
  try {
    const totalResult = await client.query('SELECT COUNT(*) as n FROM channels WHERE hidden = 0');
    const total = Number(totalResult.rows[0].n);

    const unfiledResult = await client.query(`
      SELECT COUNT(*) as n FROM channels c
      WHERE c.hidden = 0
        AND (c.music_flag IS NULL OR c.music_flag != 1)
        AND NOT EXISTS (SELECT 1 FROM channel_folders cf WHERE cf.channel_id = c.channel_id)
    `);
    const unfiled = Number(unfiledResult.rows[0].n);

    const musicResult = await client.query('SELECT COUNT(*) as n FROM channels WHERE music_flag = 1');
    const music = Number(musicResult.rows[0].n);

    const hiddenResult = await client.query('SELECT COUNT(*) as n FROM channels WHERE hidden = 1');
    const hidden = Number(hiddenResult.rows[0].n);

    return { total, unfiled, music, hidden };
  } finally {
    client.release();
  }
}

/**
 * Thin wrapper around listChannelsPage with string-ish inputs from search params.
 * Accepts a 1-based page number and returns the page slice plus the total count.
 */
export async function queryChannelsFromParams(params: {
  q?: string;
  folder?: string | null;
  tag?: string | null;
  sort?: string;
  dir?: string;
  showMusic?: string;
  showHidden?: string;
  page?: number;
  pageSize?: number;
}): Promise<PaginatedChannels> {
  const query: ChannelQuery = {};
  if (params.q) query.search = params.q;
  if (params.folder) query.folderId = params.folder;
  if (params.tag) query.tagId = params.tag;
  if (params.sort === 'recent' || params.sort === 'alpha' || params.sort === 'alpha-desc' || params.sort === 'subscribers' || params.sort === 'videos' || params.sort === 'updated') {
    query.sort = params.sort;
  }
  if (params.dir === 'asc' || params.dir === 'desc') query.dir = params.dir;
  query.includeMusic = params.showMusic === '1';
  query.onlyMusic = params.showMusic === '1';
  query.hidden = params.showHidden === '1';

  const pageSize = params.pageSize ?? CHANNEL_PAGE_SIZE;
  const page = Math.max(1, params.page ?? 1);
  query.limit = pageSize;
  query.offset = (page - 1) * pageSize;

  return listChannelsPage(query);
}
