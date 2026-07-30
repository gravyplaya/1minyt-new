import { getDb } from './db';
import { newId } from './id';
import type {
  ChannelQuery,
  ChannelRow,
  ChannelSort,
  ChannelWithRelations,
  FolderRow,
  MusicFlag,
  TagRow,
} from './types';

const SORT_SQL: Record<ChannelSort, string> = {
  alpha:       'title',
  'alpha-desc':'title',
  recent:      'COALESCE(subscribed_at, 0)',
  subscribers:  'COALESCE(subscriber_count, 0)',
  videos:      'COALESCE(video_count, 0)',
  updated:     'updated_at',
};

const DEFAULT_DIR: Record<ChannelSort, 'asc' | 'desc'> = {
  alpha:       'asc',
  'alpha-desc':'desc',
  recent:      'desc',
  subscribers:  'desc',
  videos:      'desc',
  updated:     'desc',
};

export async function listChannels(query: ChannelQuery = {}): Promise<ChannelWithRelations[]> {
  const client = await getDb();
  try {
    const where: string[] = [];
    const params: unknown[] = [];
    let paramIdx = 1;

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
      where.push('NOT EXISTS (SELECT 1 FROM channel_folders cf WHERE cf.channel_id = c.channel_id)');
    } else if (query.folderId) {
      where.push(`EXISTS (SELECT 1 FROM channel_folders cf WHERE cf.channel_id = c.channel_id AND cf.folder_id = $${paramIdx})`);
      params.push(query.folderId);
      paramIdx++;
    }
    if (query.tagId === 'none') {
      where.push('NOT EXISTS (SELECT 1 FROM channel_tags ct WHERE ct.channel_id = c.channel_id)');
    } else if (query.tagId) {
      where.push(`EXISTS (SELECT 1 FROM channel_tags ct WHERE ct.channel_id = c.channel_id AND ct.tag_id = $${paramIdx})`);
      params.push(query.tagId);
      paramIdx++;
    }

    const sort: ChannelSort = query.sort ?? 'alpha';
    const dir: 'asc' | 'desc' = query.dir ?? DEFAULT_DIR[sort];
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const orderSql = `ORDER BY ${SORT_SQL[sort]} ${dir.toUpperCase()}`;

    const sql = `SELECT c.* FROM channels c ${whereSql} ${orderSql}`;
    const { rows } = await client.query<ChannelRow>(sql, params);

    if (rows.length === 0) return [];

    // Hydrate folder_ids and tag_ids in one batch each.
    const ids = rows.map(r => r.channel_id);
    const placeholders = ids.map((_, i) => `$${i + 1}`).join(',');

    const folderResult = await client.query(
      `SELECT channel_id, folder_id FROM channel_folders WHERE channel_id IN (${placeholders})`,
      ids,
    );
    const tagResult = await client.query(
      `SELECT channel_id, tag_id FROM channel_tags WHERE channel_id IN (${placeholders})`,
      ids,
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
  } finally {
    client.release();
  }
}

export async function getChannel(channelId: string): Promise<ChannelWithRelations | null> {
  const client = await getDb();
  try {
    const { rows } = await client.query<ChannelRow>('SELECT * FROM channels WHERE channel_id = $1', [channelId]);
    const row = rows[0];
    if (!row) return null;
    const folderResult = await client.query('SELECT folder_id FROM channel_folders WHERE channel_id = $1', [channelId]);
    const tagResult = await client.query('SELECT tag_id FROM channel_tags WHERE channel_id = $1', [channelId]);
    const folderIds = (folderResult.rows as { folder_id: string }[]).map(r => r.folder_id);
    const tagIds = (tagResult.rows as { tag_id: string }[]).map(r => r.tag_id);
    return { ...row, folder_ids: folderIds, tag_ids: tagIds };
  } finally {
    client.release();
  }
}

export async function upsertChannel(input: ChannelRow): Promise<{ created: boolean }> {
  const client = await getDb();
  try {
    const { rows } = await client.query('SELECT channel_id FROM channels WHERE channel_id = $1', [input.channel_id]);
    if (rows.length > 0) {
      await client.query(
        `UPDATE channels SET
          title=$2, handle=$3, description=$4,
          thumbnail_url=$5, subscriber_count=$6, video_count=$7,
          country=$8, custom_url=$9,
          music_flag=$10, music_score=$11,
          subscribed_at=$12, synced_at=$13, updated_at=$14
        WHERE channel_id=$1`,
        [
          input.channel_id, input.title, input.handle, input.description,
          input.thumbnail_url, input.subscriber_count, input.video_count,
          input.country, input.custom_url,
          input.music_flag, input.music_score,
          input.subscribed_at, input.synced_at, input.updated_at,
        ],
      );
      return { created: false };
    }
    await client.query(
      `INSERT INTO channels (
        channel_id, title, handle, description, thumbnail_url,
        subscriber_count, video_count, country, custom_url,
        music_flag, music_score, hidden, notes,
        subscribed_at, synced_at, created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5,
        $6, $7, $8, $9,
        $10, $11, 0, NULL,
        $12, $13, $14, $15
      )`,
      [
        input.channel_id, input.title, input.handle, input.description,
        input.thumbnail_url, input.subscriber_count, input.video_count,
        input.country, input.custom_url,
        input.music_flag, input.music_score,
        input.subscribed_at, input.synced_at, input.created_at, input.updated_at,
      ],
    );
    return { created: true };
  } finally {
    client.release();
  }
}

export async function setChannelHidden(channelId: string, hidden: boolean): Promise<void> {
  const client = await getDb();
  try {
    await client.query(
      'UPDATE channels SET hidden = $1, updated_at = $2 WHERE channel_id = $3',
      [hidden ? 1 : 0, Math.floor(Date.now() / 1000), channelId],
    );
  } finally {
    client.release();
  }
}

export async function setChannelNotes(channelId: string, notes: string): Promise<void> {
  const client = await getDb();
  try {
    await client.query(
      'UPDATE channels SET notes = $1, updated_at = $2 WHERE channel_id = $3',
      [notes, Math.floor(Date.now() / 1000), channelId],
    );
  } finally {
    client.release();
  }
}

export async function setChannelMusicFlag(channelId: string, flag: MusicFlag): Promise<void> {
  const client = await getDb();
  try {
    await client.query(
      'UPDATE channels SET music_flag = $1, music_score = $2, updated_at = $3 WHERE channel_id = $4',
      [flag, flag === 1 ? 1 : flag === 2 ? 1 : 0, Math.floor(Date.now() / 1000), channelId],
    );
  } finally {
    client.release();
  }
}

export async function deleteChannel(channelId: string): Promise<void> {
  const client = await getDb();
  try {
    await client.query('DELETE FROM channels WHERE channel_id = $1', [channelId]);
  } finally {
    client.release();
  }
}

// ----- folders --------------------------------------------------------------

export async function listFolders(): Promise<FolderRow[]> {
  const client = await getDb();
  try {
    const { rows } = await client.query<FolderRow>('SELECT * FROM folders ORDER BY position, name');
    return rows;
  } finally {
    client.release();
  }
}

export async function createFolder(name: string, color?: string): Promise<FolderRow> {
  const client = await getDb();
  try {
    const trimmed = name.trim();
    if (!trimmed) throw new Error('Folder name required');
    const { rows } = await client.query<FolderRow>('SELECT * FROM folders WHERE name = $1', [trimmed]);
    if (rows[0]) return rows[0];
    const { rows: posRows } = await client.query('SELECT COALESCE(MAX(position), -1) as p FROM folders');
    const row: FolderRow = {
      id: newId(),
      name: trimmed,
      color: color ?? '#5b9eff',
      position: Number(posRows[0].p) + 1,
      created_at: Math.floor(Date.now() / 1000),
    };
    await client.query(
      'INSERT INTO folders (id, name, color, position, created_at) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (name) DO NOTHING',
      [row.id, row.name, row.color, row.position, row.created_at],
    );
    return row;
  } finally {
    client.release();
  }
}

export async function renameFolder(id: string, name: string): Promise<void> {
  const client = await getDb();
  try {
    await client.query('UPDATE folders SET name = $1 WHERE id = $2', [name.trim(), id]);
  } finally {
    client.release();
  }
}

export async function deleteFolder(id: string): Promise<void> {
  const client = await getDb();
  try {
    await client.query('DELETE FROM folders WHERE id = $1', [id]);
  } finally {
    client.release();
  }
}

export async function setChannelFolders(channelId: string, folderIds: string[]): Promise<void> {
  const client = await getDb();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM channel_folders WHERE channel_id = $1', [channelId]);
    for (const fid of folderIds) {
      await client.query(
        'INSERT INTO channel_folders (channel_id, folder_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [channelId, fid],
      );
    }
    await client.query('UPDATE channels SET updated_at = $1 WHERE channel_id = $2', [Math.floor(Date.now() / 1000), channelId]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// ----- tags -----------------------------------------------------------------

export async function listTags(): Promise<TagRow[]> {
  const client = await getDb();
  try {
    const { rows } = await client.query<TagRow>('SELECT * FROM tags ORDER BY name');
    return rows;
  } finally {
    client.release();
  }
}

export async function createTag(name: string, color?: string): Promise<TagRow> {
  const client = await getDb();
  try {
    const trimmed = name.trim();
    if (!trimmed) throw new Error('Tag name required');
    const { rows } = await client.query<TagRow>('SELECT * FROM tags WHERE name = $1', [trimmed]);
    if (rows[0]) return rows[0];
    const row: TagRow = {
      id: newId(),
      name: trimmed,
      color: color ?? null,
      created_at: Math.floor(Date.now() / 1000),
    };
    await client.query(
      'INSERT INTO tags (id, name, color, created_at) VALUES ($1, $2, $3, $4) ON CONFLICT (name) DO NOTHING',
      [row.id, row.name, row.color, row.created_at],
    );
    return row;
  } finally {
    client.release();
  }
}

export async function deleteTag(id: string): Promise<void> {
  const client = await getDb();
  try {
    await client.query('DELETE FROM tags WHERE id = $1', [id]);
  } finally {
    client.release();
  }
}

export async function setChannelTags(channelId: string, tagIds: string[]): Promise<void> {
  const client = await getDb();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM channel_tags WHERE channel_id = $1', [channelId]);
    for (const tid of tagIds) {
      await client.query(
        'INSERT INTO channel_tags (channel_id, tag_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [channelId, tid],
      );
    }
    await client.query('UPDATE channels SET updated_at = $1 WHERE channel_id = $2', [Math.floor(Date.now() / 1000), channelId]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// ----- sync log -------------------------------------------------------------

export async function recordSyncStart(): Promise<string> {
  const id = newId();
  const client = await getDb();
  try {
    await client.query(
      `INSERT INTO sync_runs (id, started_at, status) VALUES ($1, $2, 'running')`,
      [id, Math.floor(Date.now() / 1000)],
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

export async function latestSyncRun(): Promise<{ started_at: number; status: string; channels_seen: number; channels_new: number; channels_updated: number; error: string | null } | null> {
  const client = await getDb();
  try {
    const { rows } = await client.query(
      `SELECT started_at, status, channels_seen, channels_new, channels_updated, error
       FROM sync_runs ORDER BY started_at DESC LIMIT 1`,
    );
    return (rows[0] as any) ?? null;
  } finally {
    client.release();
  }
}
