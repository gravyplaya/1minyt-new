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
  alpha:      'title COLLATE NOCASE',
  recent:     'COALESCE(subscribed_at, 0)',
  subscribers:'COALESCE(subscriber_count, 0)',
  videos:     'COALESCE(video_count, 0)',
  updated:    'updated_at',
};

const DEFAULT_DIR: Record<ChannelSort, 'asc' | 'desc'> = {
  alpha: 'asc',
  recent: 'desc',
  subscribers: 'desc',
  videos: 'desc',
  updated: 'desc',
};

export function listChannels(query: ChannelQuery = {}): ChannelWithRelations[] {
  const db = getDb();
  const where: string[] = [];
  const params: Record<string, unknown> = {};

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
    where.push('(c.title LIKE @needle OR c.handle LIKE @needle OR c.description LIKE @needle)');
    params.needle = `%${query.search.trim()}%`;
  }

  // folder / tag filtering handled with EXISTS subqueries so the OUTER select stays flat.
  if (query.folderId === 'none') {
    where.push('NOT EXISTS (SELECT 1 FROM channel_folders cf WHERE cf.channel_id = c.channel_id)');
  } else if (query.folderId) {
    where.push('EXISTS (SELECT 1 FROM channel_folders cf WHERE cf.channel_id = c.channel_id AND cf.folder_id = @folderId)');
    params.folderId = query.folderId;
  }
  if (query.tagId === 'none') {
    where.push('NOT EXISTS (SELECT 1 FROM channel_tags ct WHERE ct.channel_id = c.channel_id)');
  } else if (query.tagId) {
    where.push('EXISTS (SELECT 1 FROM channel_tags ct WHERE ct.channel_id = c.channel_id AND ct.tag_id = @tagId)');
    params.tagId = query.tagId;
  }

  const sort: ChannelSort = query.sort ?? 'alpha';
  const dir: 'asc' | 'desc' = query.dir ?? DEFAULT_DIR[sort];
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const orderSql = `ORDER BY ${SORT_SQL[sort]} ${dir.toUpperCase()}`;

  const sql = `
    SELECT c.* FROM channels c
    ${whereSql}
    ${orderSql}
  `;
  const rows = db.prepare(sql).all(params) as ChannelRow[];

  if (rows.length === 0) return [];

  // Hydrate folder_ids and tag_ids in one batch each.
  const ids = rows.map(r => r.channel_id);
  const placeholders = ids.map(() => '?').join(',');
  const folderRows = db
    .prepare(`SELECT channel_id, folder_id FROM channel_folders WHERE channel_id IN (${placeholders})`)
    .all(...ids) as { channel_id: string; folder_id: string }[];
  const tagRows = db
    .prepare(`SELECT channel_id, tag_id FROM channel_tags WHERE channel_id IN (${placeholders})`)
    .all(...ids) as { channel_id: string; tag_id: string }[];

  const folderMap = new Map<string, string[]>();
  for (const f of folderRows) {
    const list = folderMap.get(f.channel_id) ?? [];
    list.push(f.folder_id);
    folderMap.set(f.channel_id, list);
  }
  const tagMap = new Map<string, string[]>();
  for (const t of tagRows) {
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

export function getChannel(channelId: string): ChannelWithRelations | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM channels WHERE channel_id = ?').get(channelId) as ChannelRow | undefined;
  if (!row) return null;
  const folderIds = (db.prepare('SELECT folder_id FROM channel_folders WHERE channel_id = ?').all(channelId) as { folder_id: string }[])
    .map(r => r.folder_id);
  const tagIds = (db.prepare('SELECT tag_id FROM channel_tags WHERE channel_id = ?').all(channelId) as { tag_id: string }[])
    .map(r => r.tag_id);
  return { ...row, folder_ids: folderIds, tag_ids: tagIds };
}

export function upsertChannel(input: ChannelRow): { created: boolean } {
  const db = getDb();
  const existing = db.prepare('SELECT channel_id FROM channels WHERE channel_id = ?').get(input.channel_id) as { channel_id: string } | undefined;
  if (existing) {
    db.prepare(`
      UPDATE channels SET
        title=@title, handle=@handle, description=@description,
        thumbnail_url=@thumbnail_url, subscriber_count=@subscriber_count, video_count=@video_count,
        country=@country, custom_url=@custom_url,
        music_flag=@music_flag, music_score=@music_score,
        subscribed_at=@subscribed_at, synced_at=@synced_at, updated_at=@updated_at
      WHERE channel_id=@channel_id
    `).run(input);
    return { created: false };
  }
  db.prepare(`
    INSERT INTO channels (
      channel_id, title, handle, description, thumbnail_url,
      subscriber_count, video_count, country, custom_url,
      music_flag, music_score, hidden, notes,
      subscribed_at, synced_at, created_at, updated_at
    ) VALUES (
      @channel_id, @title, @handle, @description, @thumbnail_url,
      @subscriber_count, @video_count, @country, @custom_url,
      @music_flag, @music_score, 0, NULL,
      @subscribed_at, @synced_at, @created_at, @updated_at
    )
  `).run(input);
  return { created: true };
}

export function setChannelHidden(channelId: string, hidden: boolean): void {
  getDb().prepare('UPDATE channels SET hidden = ?, updated_at = ? WHERE channel_id = ?')
    .run(hidden ? 1 : 0, Math.floor(Date.now() / 1000), channelId);
}

export function setChannelNotes(channelId: string, notes: string): void {
  getDb().prepare('UPDATE channels SET notes = ?, updated_at = ? WHERE channel_id = ?')
    .run(notes, Math.floor(Date.now() / 1000), channelId);
}

export function setChannelMusicFlag(channelId: string, flag: MusicFlag): void {
  getDb().prepare('UPDATE channels SET music_flag = ?, music_score = ?, updated_at = ? WHERE channel_id = ?')
    .run(flag, flag === 1 ? 1 : flag === 2 ? 1 : 0, Math.floor(Date.now() / 1000), channelId);
}

export function deleteChannel(channelId: string): void {
  getDb().prepare('DELETE FROM channels WHERE channel_id = ?').run(channelId);
}

// ----- folders --------------------------------------------------------------

export function listFolders(): FolderRow[] {
  return getDb().prepare('SELECT * FROM folders ORDER BY position, name COLLATE NOCASE').all() as FolderRow[];
}

export function createFolder(name: string, color?: string): FolderRow {
  const db = getDb();
  const trimmed = name.trim();
  if (!trimmed) throw new Error('Folder name required');
  const existing = db.prepare('SELECT * FROM folders WHERE name = ? COLLATE NOCASE').get(trimmed) as FolderRow | undefined;
  if (existing) return existing;
  const row: FolderRow = {
    id: newId(),
    name: trimmed,
    color: color ?? '#5b9eff',
    position: ((db.prepare('SELECT COALESCE(MAX(position), -1) as p FROM folders').get() as { p: number }).p) + 1,
    created_at: Math.floor(Date.now() / 1000),
  };
  db.prepare('INSERT INTO folders (id, name, color, position, created_at) VALUES (?, ?, ?, ?, ?)').run(
    row.id, row.name, row.color, row.position, row.created_at,
  );
  return row;
}

export function renameFolder(id: string, name: string): void {
  getDb().prepare('UPDATE folders SET name = ? WHERE id = ?').run(name.trim(), id);
}

export function deleteFolder(id: string): void {
  getDb().prepare('DELETE FROM folders WHERE id = ?').run(id);
}

export function setChannelFolders(channelId: string, folderIds: string[]): void {
  const db = getDb();
  const tx = db.transaction((ids: string[]) => {
    db.prepare('DELETE FROM channel_folders WHERE channel_id = ?').run(channelId);
    const insert = db.prepare('INSERT OR IGNORE INTO channel_folders (channel_id, folder_id) VALUES (?, ?)');
    for (const fid of ids) insert.run(channelId, fid);
    db.prepare('UPDATE channels SET updated_at = ? WHERE channel_id = ?').run(Math.floor(Date.now() / 1000), channelId);
  });
  tx(folderIds);
}

// ----- tags -----------------------------------------------------------------

export function listTags(): TagRow[] {
  return getDb().prepare('SELECT * FROM tags ORDER BY name COLLATE NOCASE').all() as TagRow[];
}

export function createTag(name: string, color?: string): TagRow {
  const db = getDb();
  const trimmed = name.trim();
  if (!trimmed) throw new Error('Tag name required');
  const existing = db.prepare('SELECT * FROM tags WHERE name = ? COLLATE NOCASE').get(trimmed) as TagRow | undefined;
  if (existing) return existing;
  const row: TagRow = {
    id: newId(),
    name: trimmed,
    color: color ?? null,
    created_at: Math.floor(Date.now() / 1000),
  };
  db.prepare('INSERT INTO tags (id, name, color, created_at) VALUES (?, ?, ?, ?)').run(
    row.id, row.name, row.color, row.created_at,
  );
  return row;
}

export function deleteTag(id: string): void {
  getDb().prepare('DELETE FROM tags WHERE id = ?').run(id);
}

export function setChannelTags(channelId: string, tagIds: string[]): void {
  const db = getDb();
  const tx = db.transaction((ids: string[]) => {
    db.prepare('DELETE FROM channel_tags WHERE channel_id = ?').run(channelId);
    const insert = db.prepare('INSERT OR IGNORE INTO channel_tags (channel_id, tag_id) VALUES (?, ?)');
    for (const tid of ids) insert.run(channelId, tid);
    db.prepare('UPDATE channels SET updated_at = ? WHERE channel_id = ?').run(Math.floor(Date.now() / 1000), channelId);
  });
  tx(tagIds);
}

// ----- sync log -------------------------------------------------------------

export function recordSyncStart(): string {
  const id = newId();
  getDb().prepare(`INSERT INTO sync_runs (id, started_at, status) VALUES (?, ?, 'running')`)
    .run(id, Math.floor(Date.now() / 1000));
  return id;
}

export function recordSyncFinish(id: string, fields: { status: 'success' | 'error'; seen: number; new: number; updated: number; error?: string }): void {
  getDb().prepare(`
    UPDATE sync_runs
       SET finished_at = ?, status = ?, channels_seen = ?, channels_new = ?, channels_updated = ?, error = ?
     WHERE id = ?
  `).run(Math.floor(Date.now() / 1000), fields.status, fields.seen, fields.new, fields.updated, fields.error ?? null, id);
}

export function latestSyncRun(): { started_at: number; status: string; channels_seen: number; channels_new: number; channels_updated: number; error: string | null } | null {
  return getDb().prepare(`
    SELECT started_at, status, channels_seen, channels_new, channels_updated, error
      FROM sync_runs
     ORDER BY started_at DESC
     LIMIT 1
  `).get() as any;
}