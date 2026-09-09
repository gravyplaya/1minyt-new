/**
 * Channels / folders / tags / sync-log CRUD.
 *
 * TAV-68: every function takes the owner's user id as its first parameter and
 * every query carries a user_id predicate. Channels/folders/tags are per-user
 * rows; upserts conflict on the user-scoped keys.
 */

import { getDb } from './db';
import type { PoolClient } from 'pg';
import { newId } from './id';
import type {
  ChannelQuery,
  ChannelRow,
  ChannelSort,
  ChannelWithRelations,
  FolderRow,
  MusicFlag,
  PaginatedChannels,
  TagRow,
} from './types';

const SORT_SQL: Record<ChannelSort, string> = {
  alpha:       'title',
  'alpha-desc':'title',
  recent:      'COALESCE(subscribed_at, 0)',
  subscribers:  'COALESCE(subscriber_count, 0)',
  videos:      'COALESCE(video_count, 0)',
  updated:      'updated_at',
};

const DEFAULT_DIR: Record<ChannelSort, 'asc' | 'desc'> = {
  alpha:       'asc',
  'alpha-desc':'desc',
  recent:      'desc',
  subscribers:  'desc',
  videos:      'desc',
  updated:      'desc',
};

/**
 * Build the WHERE clause (and bound params) shared by the list and count queries.
 * Returns the SQL fragment (empty string when no filters apply) and the param
 * array — the count query reuses the same params. TAV-68: the user_id filter
 * is always first param, so every channel list/count is owner-scoped.
 */
function buildChannelWhere(userId: string, query: ChannelQuery): { whereSql: string; params: unknown[] } {
  const where: string[] = ['c.user_id = $1'];
  const params: unknown[] = [userId];
  let paramIdx = 2;

  if (!query.includeMusic && !query.onlyMusic) {
    where.push('(c.music_flag IS NULL OR c.music_flag != 1)');
  }
  if (query.onlyMusic) {
    where.push('c.music_flag = 1');
  }
  if (!query.hidden) {
    where.push('c.hidden = 0');
  }
  if (query.search?.trim()) {
    where.push(`(c.title ILIKE $${paramIdx} OR c.handle ILIKE $${paramIdx} OR c.description ILIKE $${paramIdx})`);
    params.push(`%${query.search.trim()}%`);
    paramIdx++;
  }

  if (query.folderId === 'none') {
    where.push('NOT EXISTS (SELECT 1 FROM channel_folders cf WHERE cf.channel_id = c.channel_id AND cf.user_id = c.user_id)');
  } else if (query.folderId) {
    where.push(`EXISTS (SELECT 1 FROM channel_folders cf WHERE cf.channel_id = c.channel_id AND cf.user_id = c.user_id AND cf.folder_id = $${paramIdx})`);
    params.push(query.folderId);
    paramIdx++;
  }
  if (query.tagId === 'none') {
    where.push('NOT EXISTS (SELECT 1 FROM channel_tags ct WHERE ct.channel_id = c.channel_id AND ct.user_id = c.user_id)');
  } else if (query.tagId) {
    where.push(`EXISTS (SELECT 1 FROM channel_tags ct WHERE ct.channel_id = c.channel_id AND ct.user_id = c.user_id AND ct.tag_id = $${paramIdx})`);
    params.push(query.tagId);
    paramIdx++;
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  return { whereSql, params };
}

/** Hydrate folder_ids and tag_ids for a batch of channel rows in two bulk queries. */
async function hydrateRelations(
  client: PoolClient,
  userId: string,
  rows: ChannelRow[],
): Promise<ChannelWithRelations[]> {
  if (rows.length === 0) return [];

  const ids = rows.map(r => r.channel_id);
  const placeholders = ids.map((_, i) => `$${i + 2}`).join(',');

  const folderResult = await client.query(
    `SELECT channel_id, folder_id FROM channel_folders WHERE user_id = $1 AND channel_id IN (${placeholders})`,
    [userId, ...ids],
  );
  const tagResult = await client.query(
    `SELECT channel_id, tag_id FROM channel_tags WHERE user_id = $1 AND channel_id IN (${placeholders})`,
    [userId, ...ids],
  );

  const folderMap = new Map<string, string[]>();
  for (const f of folderResult.rows as { channel_id: string; folder_id: string }[]) {
    const list = folderMap.get(f.channel_id) ?? [];
    list.push(f.folder_id);
    folderMap.set(f.channel_id, list);
  }
  const tagMap = new Map<string, string[]>();
  for (const t of tagResult.rows as { channel_id: string; tag_id: string }[]) {
    const list = tagMap.get(t.channel_id) ?? [];
    list.push(t.tag_id);
    tagMap.set(t.channel_id, list);
  }

  return rows.map(row => ({
    ...row,
    folder_ids: folderMap.get(row.channel_id) ?? [],
    tag_ids:    tagMap.get(row.channel_id) ?? [],
  }));
}

export async function listChannels(userId: string, query: ChannelQuery = {}): Promise<ChannelWithRelations[]> {
  const client = await getDb();
  try {
    const { whereSql, params } = buildChannelWhere(userId, query);

    const sort: ChannelSort = query.sort ?? 'alpha';
    const dir: 'asc' | 'desc' = query.dir ?? DEFAULT_DIR[sort];
    const orderSql = `ORDER BY ${SORT_SQL[sort]} ${dir.toUpperCase()}`;

    const limitSql = query.limit != null ? `LIMIT ${Number(query.limit)}` : '';
    const offsetSql = query.offset != null ? `OFFSET ${Number(query.offset)}` : '';

    const sql = `SELECT c.* FROM channels c ${whereSql} ${orderSql} ${limitSql} ${offsetSql}`.trim();
    const { rows } = await client.query<ChannelRow>(sql, params);

    return hydrateRelations(client, userId, rows);
  } finally {
    client.release();
  }
}

/**
 * Paginated channel query: returns the page of channels plus the total matching
 * count (ignoring limit/offset) so the UI can render pagination controls.
 */
export async function listChannelsPage(userId: string, query: ChannelQuery = {}): Promise<PaginatedChannels> {
  const client = await getDb();
  try {
    const { whereSql, params } = buildChannelWhere(userId, query);

    // Total count (no LIMIT/OFFSET) — same params, same WHERE.
    const countSql = `SELECT COUNT(*) as n FROM channels c ${whereSql}`.trim();
    const countResult = await client.query(countSql, params);
    const total = Number(countResult.rows[0].n);

    if (total === 0) return { channels: [], total: 0 };

    const sort: ChannelSort = query.sort ?? 'alpha';
    const dir: 'asc' | 'desc' = query.dir ?? DEFAULT_DIR[sort];
    const orderSql = `ORDER BY ${SORT_SQL[sort]} ${dir.toUpperCase()}`;

    const limitSql = query.limit != null ? `LIMIT ${Number(query.limit)}` : '';
    const offsetSql = query.offset != null ? `OFFSET ${Number(query.offset)}` : '';

    const sql = `SELECT c.* FROM channels c ${whereSql} ${orderSql} ${limitSql} ${offsetSql}`.trim();
    const { rows } = await client.query<ChannelRow>(sql, params);

    const channels = await hydrateRelations(client, userId, rows);
    return { channels, total };
  } finally {
    client.release();
  }
}

export async function getChannel(userId: string, channelId: string): Promise<ChannelWithRelations | null> {
  const client = await getDb();
  try {
    const { rows } = await client.query<ChannelRow>(
      'SELECT * FROM channels WHERE user_id = $1 AND channel_id = $2',
      [userId, channelId],
    );
    const row = rows[0];
    if (!row) return null;
    const folderResult = await client.query(
      'SELECT folder_id FROM channel_folders WHERE user_id = $1 AND channel_id = $2',
      [userId, channelId],
    );
    const tagResult = await client.query(
      'SELECT tag_id FROM channel_tags WHERE user_id = $1 AND channel_id = $2',
      [userId, channelId],
    );
    const folderIds = (folderResult.rows as { folder_id: string }[]).map(r => r.folder_id);
    const tagIds = (tagResult.rows as { tag_id: string }[]).map(r => r.tag_id);
    return { ...row, folder_ids: folderIds, tag_ids: tagIds };
  } finally {
    client.release();
  }
}

/**
 * Batch upsert channels in a single query using unnest().
 * Replaces the per-channel SELECT+INSERT/UPDATE loop that made ~400 sequential
 * DB round-trips for 200 subscriptions. Uses PostgreSQL's (xmax = 0) trick to
 * distinguish inserts from updates in the RETURNING clause.
 *
 * Preserves `hidden`, `notes`, and `created_at` on conflict (matching the
 * per-row upsertChannel behaviour): only metadata fields are overwritten.
 * TAV-68: conflicts on the user-scoped key (user_id, channel_id) — the same
 * YouTube channel can exist independently for many users.
 */
export async function upsertChannels(userId: string, inputs: ChannelRow[]): Promise<{ created: number; updated: number }> {
  if (inputs.length === 0) return { created: 0, updated: 0 };
  const client = await getDb();
  try {
    const N = inputs.length;
    const cols = {
      user_id:          new Array(N).fill(userId) as string[],
      channel_id:       inputs.map(r => r.channel_id),
      title:            inputs.map(r => r.title),
      handle:           inputs.map(r => r.handle),
      description:      inputs.map(r => r.description),
      thumbnail_url:    inputs.map(r => r.thumbnail_url),
      subscriber_count: inputs.map(r => r.subscriber_count),
      video_count:      inputs.map(r => r.video_count),
      country:          inputs.map(r => r.country),
      custom_url:       inputs.map(r => r.custom_url),
      music_flag:       inputs.map(r => r.music_flag),
      music_score:      inputs.map(r => r.music_score),
      hidden:           new Array(N).fill(0) as (0 | 1)[],
      notes:            new Array(N).fill(null) as (string | null)[],
      subscribed_at:    inputs.map(r => r.subscribed_at),
      synced_at:        inputs.map(r => r.synced_at),
      created_at:       inputs.map(r => r.created_at),
      updated_at:       inputs.map(r => r.updated_at),
      topic_categories:  inputs.map(r => r.topic_categories),
      banner_image_url:  inputs.map(r => r.banner_image_url),
      branding_keywords: inputs.map(r => r.branding_keywords),
    };

    const { rows } = await client.query<{ inserted: boolean }>(
      `INSERT INTO channels (
         user_id, channel_id, title, handle, description, thumbnail_url,
         subscriber_count, video_count, country, custom_url,
         music_flag, music_score, hidden, notes,
         subscribed_at, synced_at, created_at, updated_at,
         topic_categories, banner_image_url, branding_keywords
       )
       SELECT
         user_id, channel_id, title, handle, description, thumbnail_url,
         subscriber_count, video_count, country, custom_url,
         music_flag, music_score, hidden, notes,
         subscribed_at, synced_at, created_at, updated_at,
         topic_categories, banner_image_url, branding_keywords
       FROM unnest(
         $1::text[],  $2::text[],  $3::text[],  $4::text[],  $5::text[],  $6::text[],
         $7::integer[], $8::integer[], $9::text[], $10::text[],
         $11::integer[], $12::real[],
         $13::integer[], $14::text[],
         $15::integer[], $16::integer[], $17::integer[], $18::integer[],
         $19::text[], $20::text[], $21::text[]
       ) AS t(
         user_id, channel_id, title, handle, description, thumbnail_url,
         subscriber_count, video_count, country, custom_url,
         music_flag, music_score, hidden, notes,
         subscribed_at, synced_at, created_at, updated_at,
         topic_categories, banner_image_url, branding_keywords
       )
       ON CONFLICT (user_id, channel_id) DO UPDATE SET
         title=EXCLUDED.title, handle=EXCLUDED.handle, description=EXCLUDED.description,
         thumbnail_url=EXCLUDED.thumbnail_url, subscriber_count=EXCLUDED.subscriber_count,
         video_count=EXCLUDED.video_count, country=EXCLUDED.country, custom_url=EXCLUDED.custom_url,
         music_flag=EXCLUDED.music_flag, music_score=EXCLUDED.music_score,
         subscribed_at=EXCLUDED.subscribed_at, synced_at=EXCLUDED.synced_at, updated_at=EXCLUDED.updated_at,
         topic_categories=EXCLUDED.topic_categories,
         banner_image_url=EXCLUDED.banner_image_url,
         branding_keywords=EXCLUDED.branding_keywords
       RETURNING (xmax = 0) AS inserted`,
      [
        cols.user_id,
        cols.channel_id, cols.title, cols.handle, cols.description, cols.thumbnail_url,
        cols.subscriber_count, cols.video_count, cols.country, cols.custom_url,
        cols.music_flag, cols.music_score,
        cols.hidden, cols.notes,
        cols.subscribed_at, cols.synced_at, cols.created_at, cols.updated_at,
        cols.topic_categories, cols.banner_image_url, cols.branding_keywords,
      ],
    );

    const created = rows.filter(r => r.inserted).length;
    return { created, updated: rows.length - created };
  } finally {
    client.release();
  }
}

/**
 * Return the set of channel_ids that were synced within the last
 * `thresholdSeconds`. Used by the sync orchestrator to skip fetching
 * channel details for recently-synced channels — saves API quota and
 * reduces the payload on repeat syncs.
 */
export async function listRecentlySyncedChannelIds(userId: string, thresholdSeconds: number): Promise<Set<string>> {
  const client = await getDb();
  try {
    const cutoff = Math.floor(Date.now() / 1000) - thresholdSeconds;
    const { rows } = await client.query<{ channel_id: string }>(
      'SELECT channel_id FROM channels WHERE user_id = $1 AND synced_at > $2',
      [userId, cutoff],
    );
    return new Set(rows.map(r => r.channel_id));
  } finally {
    client.release();
  }
}

export async function upsertChannel(userId: string, input: ChannelRow): Promise<{ created: boolean }> {
  const client = await getDb();
  try {
    const { rows } = await client.query(
      'SELECT channel_id FROM channels WHERE user_id = $1 AND channel_id = $2',
      [userId, input.channel_id],
    );
    if (rows.length > 0) {
      await client.query(
        `UPDATE channels SET
          title=$3, handle=$4, description=$5,
          thumbnail_url=$6, subscriber_count=$7, video_count=$8,
          country=$9, custom_url=$10,
          music_flag=$11, music_score=$12,
          subscribed_at=$13, synced_at=$14, updated_at=$15,
          topic_categories=$16,
          banner_image_url=$17,
          branding_keywords=$18
        WHERE user_id=$1 AND channel_id=$2`,
        [
          userId, input.channel_id, input.title, input.handle, input.description,
          input.thumbnail_url, input.subscriber_count, input.video_count,
          input.country, input.custom_url,
          input.music_flag, input.music_score,
          input.subscribed_at, input.synced_at, input.updated_at,
          input.topic_categories,
          input.banner_image_url,
          input.branding_keywords,
        ],
      );
      return { created: false };
    }
    await client.query(
      `INSERT INTO channels (
        user_id, channel_id, title, handle, description, thumbnail_url,
        subscriber_count, video_count, country, custom_url,
        music_flag, music_score, hidden, notes,
        subscribed_at, synced_at, created_at, updated_at,
        topic_categories, banner_image_url, branding_keywords
      ) VALUES (
        $1, $2, $3, $4, $5,
        $6, $7, $8, $9,
        $10, $11, $12, 0, NULL,
        $13, $14, $15, $16,
        $17, $18, $19
      )`,
      [
        userId, input.channel_id, input.title, input.handle, input.description,
        input.thumbnail_url, input.subscriber_count, input.video_count,
        input.country, input.custom_url,
        input.music_flag, input.music_score,
        input.subscribed_at, input.synced_at, input.created_at, input.updated_at,
        input.topic_categories,
        input.banner_image_url,
        input.branding_keywords,
      ],
    );
    return { created: true };
  } finally {
    client.release();
  }
}

export async function setChannelHidden(userId: string, channelId: string, hidden: boolean): Promise<void> {
  const client = await getDb();
  try {
    await client.query(
      'UPDATE channels SET hidden = $1, updated_at = $2 WHERE user_id = $3 AND channel_id = $4',
      [hidden ? 1 : 0, Math.floor(Date.now() / 1000), userId, channelId],
    );
  } finally {
    client.release();
  }
}

export async function setChannelNotes(userId: string, channelId: string, notes: string): Promise<void> {
  const client = await getDb();
  try {
    await client.query(
      'UPDATE channels SET notes = $1, updated_at = $2 WHERE user_id = $3 AND channel_id = $4',
      [notes, Math.floor(Date.now() / 1000), userId, channelId],
    );
  } finally {
    client.release();
  }
}

export async function setChannelMusicFlag(userId: string, channelId: string, flag: MusicFlag): Promise<void> {
  const client = await getDb();
  try {
    await client.query(
      'UPDATE channels SET music_flag = $1, music_score = $2, updated_at = $3 WHERE user_id = $4 AND channel_id = $5',
      [flag, flag === 1 ? 1 : flag === 2 ? 1 : 0, Math.floor(Date.now() / 1000), userId, channelId],
    );
  } finally {
    client.release();
  }
}

/** Delete a channel; composite FKs cascade its videos, summaries, chats, ... */
export async function deleteChannel(userId: string, channelId: string): Promise<void> {
  const client = await getDb();
  try {
    await client.query('DELETE FROM channels WHERE user_id = $1 AND channel_id = $2', [userId, channelId]);
  } finally {
    client.release();
  }
}

// ----- folders --------------------------------------------------------------

export async function listFolders(userId: string): Promise<FolderRow[]> {
  const client = await getDb();
  try {
    const { rows } = await client.query<FolderRow>(
      'SELECT * FROM folders WHERE user_id = $1 ORDER BY position, name',
      [userId],
    );
    return rows;
  } finally {
    client.release();
  }
}

export async function createFolder(userId: string, name: string, color?: string): Promise<FolderRow> {
  const client = await getDb();
  try {
    const trimmed = name.trim();
    if (!trimmed) throw new Error('Folder name required');
    const { rows } = await client.query<FolderRow>(
      'SELECT * FROM folders WHERE user_id = $1 AND name = $2',
      [userId, trimmed],
    );
    if (rows[0]) return rows[0];
    const { rows: posRows } = await client.query(
      'SELECT COALESCE(MAX(position), -1) as p FROM folders WHERE user_id = $1',
      [userId],
    );
    const row: FolderRow = {
      id: newId(),
      name: trimmed,
      color: color ?? '#5b9eff',
      position: Number(posRows[0].p) + 1,
      created_at: Math.floor(Date.now() / 1000),
    };
    await client.query(
      `INSERT INTO folders (id, user_id, name, color, position, created_at)
       VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (user_id, name) DO NOTHING`,
      [row.id, userId, row.name, row.color, row.position, row.created_at],
    );
    return row;
  } finally {
    client.release();
  }
}

export async function renameFolder(userId: string, id: string, name: string): Promise<void> {
  const client = await getDb();
  try {
    await client.query(
      'UPDATE folders SET name = $1 WHERE user_id = $2 AND id = $3',
      [name.trim(), userId, id],
    );
  } finally {
    client.release();
  }
}

export async function deleteFolder(userId: string, id: string): Promise<void> {
  const client = await getDb();
  try {
    await client.query('DELETE FROM folders WHERE user_id = $1 AND id = $2', [userId, id]);
  } finally {
    client.release();
  }
}

export async function setChannelFolders(userId: string, channelId: string, folderIds: string[]): Promise<void> {
  const client = await getDb();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM channel_folders WHERE user_id = $1 AND channel_id = $2', [userId, channelId]);
    for (const fid of folderIds) {
      await client.query(
        'INSERT INTO channel_folders (user_id, channel_id, folder_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
        [userId, channelId, fid],
      );
    }
    await client.query(
      'UPDATE channels SET updated_at = $1 WHERE user_id = $2 AND channel_id = $3',
      [Math.floor(Date.now() / 1000), userId, channelId],
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// ----- tags -----------------------------------------------------------------

export async function listTags(userId: string): Promise<TagRow[]> {
  const client = await getDb();
  try {
    const { rows } = await client.query<TagRow>('SELECT * FROM tags WHERE user_id = $1 ORDER BY name', [userId]);
    return rows;
  } finally {
    client.release();
  }
}

export async function createTag(userId: string, name: string, color?: string): Promise<TagRow> {
  const client = await getDb();
  try {
    const trimmed = name.trim();
    if (!trimmed) throw new Error('Tag name required');
    const { rows } = await client.query<TagRow>(
      'SELECT * FROM tags WHERE user_id = $1 AND name = $2',
      [userId, trimmed],
    );
    if (rows[0]) return rows[0];
    const row: TagRow = {
      id: newId(),
      name: trimmed,
      color: color ?? null,
      created_at: Math.floor(Date.now() / 1000),
    };
    await client.query(
      `INSERT INTO tags (id, user_id, name, color, created_at)
       VALUES ($1, $2, $3, $4, $5) ON CONFLICT (user_id, name) DO NOTHING`,
      [row.id, userId, row.name, row.color, row.created_at],
    );
    return row;
  } finally {
    client.release();
  }
}

export async function renameTag(userId: string, id: string, name: string): Promise<void> {
  const client = await getDb();
  try {
    await client.query('UPDATE tags SET name = $1 WHERE user_id = $2 AND id = $3', [name.trim(), userId, id]);
  } finally {
    client.release();
  }
}

export async function deleteTag(userId: string, id: string): Promise<void> {
  const client = await getDb();
  try {
    await client.query('DELETE FROM tags WHERE user_id = $1 AND id = $2', [userId, id]);
  } finally {
    client.release();
  }
}

export async function setChannelTags(userId: string, channelId: string, tagIds: string[]): Promise<void> {
  const client = await getDb();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM channel_tags WHERE user_id = $1 AND channel_id = $2', [userId, channelId]);
    for (const tid of tagIds) {
      await client.query(
        'INSERT INTO channel_tags (user_id, channel_id, tag_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
        [userId, channelId, tid],
      );
    }
    await client.query(
      'UPDATE channels SET updated_at = $1 WHERE user_id = $2 AND channel_id = $3',
      [Math.floor(Date.now() / 1000), userId, channelId],
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// ----- sync log -------------------------------------------------------------

export async function recordSyncStart(userId: string): Promise<string> {
  const id = newId();
  const client = await getDb();
  try {
    await client.query(
      `INSERT INTO sync_runs (id, user_id, started_at, status) VALUES ($1, $2, $3, 'running')`,
      [id, userId, Math.floor(Date.now() / 1000)],
    );
    return id;
  } finally {
    client.release();
  }
}

export async function recordSyncFinish(id: string, fields: { status: 'success' | 'error'; seen: number; new: number; updated: number; error?: string }): Promise<void> {
  const client = await getDb();
  try {
    await client.query(
      `UPDATE sync_runs
       SET finished_at = $1, status = $2, channels_seen = $3, channels_new = $4, channels_updated = $5, error = $6
     WHERE id = $7`,
      [Math.floor(Date.now() / 1000), fields.status, fields.seen, fields.new, fields.updated, fields.error ?? null, id],
    );
  } finally {
    client.release();
  }
}

export async function latestSyncRun(userId: string): Promise<{ started_at: number; status: string; channels_seen: number; channels_new: number; channels_updated: number; error: string | null } | null> {
  const client = await getDb();
  try {
    const { rows } = await client.query(
      `SELECT started_at, status, channels_seen, channels_new, channels_updated, error
       FROM sync_runs WHERE user_id = $1 ORDER BY started_at DESC LIMIT 1`,
      [userId],
    );
    return (rows[0] as any) ?? null;
  } finally {
    client.release();
  }
}
