/**
 * PostgreSQL schema for 1minyt subscriptions.
 *
 * Each statement is a separate array element so we can execute them
 * individually (pg doesn't support multi-statement queries via query()).
 *
 * Migrated from SQLite. Key differences:
 *  - SERIAL/IDENTITY instead of AUTOINCREMENT (not used here — all PKs are app-generated)
 *  - TEXT instead of TEXT (same)
 *  - INTEGER for booleans → kept as INTEGER for zero migration friction
 *  - REAL → DOUBLE PRECISION
 *  - BLOB → BYTEA (for embeddings)
 *  - COLLATE NOCASE → removed (Postgres uses ILIKE for case-insensitive)
 *  - INSERT OR IGNORE → ON CONFLICT DO NOTHING
 *  - PRAGMA statements → removed (Postgres handles this differently)
 */

export const SCHEMA_STATEMENTS: string[] = [
  `CREATE TABLE IF NOT EXISTS channels (
    channel_id       TEXT PRIMARY KEY,
    title            TEXT NOT NULL,
    handle           TEXT,
    description      TEXT,
    thumbnail_url    TEXT,
    subscriber_count INTEGER,
    video_count      INTEGER,
    country          TEXT,
    custom_url       TEXT,
    music_flag       INTEGER NOT NULL DEFAULT 0,
    music_score      DOUBLE PRECISION NOT NULL DEFAULT 0,
    hidden           INTEGER NOT NULL DEFAULT 0,
    notes            TEXT,
    subscribed_at    INTEGER,
    synced_at        INTEGER NOT NULL,
    created_at       INTEGER NOT NULL,
    updated_at       INTEGER NOT NULL
  )`,

  `CREATE INDEX IF NOT EXISTS idx_channels_title      ON channels(title)`,
  `CREATE INDEX IF NOT EXISTS idx_channels_handle     ON channels(handle)`,
  `CREATE INDEX IF NOT EXISTS idx_channels_music_flag ON channels(music_flag)`,
  `CREATE INDEX IF NOT EXISTS idx_channels_subscriber ON channels(subscriber_count)`,

  `CREATE TABLE IF NOT EXISTS folders (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL UNIQUE,
    color      TEXT,
    position   INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  )`,

  `CREATE INDEX IF NOT EXISTS idx_folders_position ON folders(position, name)`,

  `CREATE TABLE IF NOT EXISTS tags (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL UNIQUE,
    color      TEXT,
    created_at INTEGER NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS channel_folders (
    channel_id TEXT NOT NULL REFERENCES channels(channel_id) ON DELETE CASCADE,
    folder_id  TEXT NOT NULL REFERENCES folders(id)       ON DELETE CASCADE,
    PRIMARY KEY (channel_id, folder_id)
  )`,

  `CREATE INDEX IF NOT EXISTS idx_channel_folders_folder ON channel_folders(folder_id)`,

  `CREATE TABLE IF NOT EXISTS channel_tags (
    channel_id TEXT NOT NULL REFERENCES channels(channel_id) ON DELETE CASCADE,
    tag_id     TEXT NOT NULL REFERENCES tags(id)            ON DELETE CASCADE,
    PRIMARY KEY (channel_id, tag_id)
  )`,

  `CREATE INDEX IF NOT EXISTS idx_channel_tags_tag ON channel_tags(tag_id)`,

  `CREATE TABLE IF NOT EXISTS sync_runs (
    id               TEXT PRIMARY KEY,
    started_at       INTEGER NOT NULL,
    finished_at      INTEGER,
    status           TEXT NOT NULL,
    channels_seen    INTEGER NOT NULL DEFAULT 0,
    channels_new     INTEGER NOT NULL DEFAULT 0,
    channels_updated INTEGER NOT NULL DEFAULT 0,
    error            TEXT
  )`,

  `CREATE INDEX IF NOT EXISTS idx_sync_runs_started ON sync_runs(started_at DESC)`,
  `CREATE TABLE IF NOT EXISTS oauth_tokens (
    user_id       TEXT PRIMARY KEY,
    access_token  TEXT NOT NULL,
    refresh_token TEXT NOT NULL,
    expiry_date   INTEGER,
    updated_at    INTEGER NOT NULL
  )`,

  // User profile columns — fetched once at connect via channels.list(mine=true).
  `ALTER TABLE oauth_tokens ADD COLUMN IF NOT EXISTS display_name TEXT`,
  `ALTER TABLE oauth_tokens ADD COLUMN IF NOT EXISTS avatar_url   TEXT`,

  // ----- TAV-4: videos + summaries -------------------------------------

  `CREATE TABLE IF NOT EXISTS videos (
    video_id            TEXT PRIMARY KEY,
    channel_id          TEXT NOT NULL REFERENCES channels(channel_id) ON DELETE CASCADE,
    title               TEXT NOT NULL,
    description         TEXT,
    thumbnail_url       TEXT,
    duration_seconds    INTEGER,
    published_at        INTEGER,
    transcript          TEXT,
    transcript_status   TEXT NOT NULL DEFAULT 'pending',
    transcript_fetched_at INTEGER,
    created_at          INTEGER NOT NULL,
    updated_at          INTEGER NOT NULL
  )`,

  `CREATE INDEX IF NOT EXISTS idx_videos_channel ON videos(channel_id, published_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_videos_status  ON videos(transcript_status)`,

  `CREATE TABLE IF NOT EXISTS summaries (
    id          TEXT PRIMARY KEY,
    video_id    TEXT NOT NULL REFERENCES videos(video_id) ON DELETE CASCADE,
    model       TEXT NOT NULL,
    tldr        TEXT NOT NULL,
    key_points  TEXT NOT NULL,
    follow_ups  TEXT,
    prompt      TEXT NOT NULL,
    token_count INTEGER,
    created_at  INTEGER NOT NULL
  )`,

  `CREATE INDEX IF NOT EXISTS idx_summaries_video ON summaries(video_id, created_at DESC)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS uq_video_model ON summaries(video_id, model)`,

  // TAV-8: auto-topic tagging — add a topics column to existing summaries.
  // Stores a JSON array string, e.g. '["ai","economics"]'. Nullable so old
  // rows (and rows written before this migration) keep working.
  `ALTER TABLE summaries ADD COLUMN IF NOT EXISTS topics TEXT`,

  // TAV-12: bookmark flag on summaries. 0 = not bookmarked, 1 = bookmarked.
  // Nullable so the migration is additive; treated as 0 (not bookmarked) when null.
  `ALTER TABLE summaries ADD COLUMN IF NOT EXISTS bookmarked INTEGER NOT NULL DEFAULT 0`,
  `CREATE INDEX IF NOT EXISTS idx_summaries_bookmarked ON summaries(bookmarked, created_at DESC)`,

  // ----- TAV-5: chat with video ----------------------------------------

  `CREATE TABLE IF NOT EXISTS transcript_segments (
    video_id   TEXT NOT NULL REFERENCES videos(video_id) ON DELETE CASCADE,
    seg_index  INTEGER NOT NULL,
    text       TEXT NOT NULL,
    start_ms   INTEGER NOT NULL,
    end_ms     INTEGER,
    PRIMARY KEY (video_id, seg_index)
  )`,

  `CREATE INDEX IF NOT EXISTS idx_tsegs_video ON transcript_segments(video_id, seg_index)`,

  `CREATE TABLE IF NOT EXISTS transcript_chunks (
    id          TEXT PRIMARY KEY,
    video_id    TEXT NOT NULL REFERENCES videos(video_id) ON DELETE CASCADE,
    chunk_index INTEGER NOT NULL,
    text        TEXT NOT NULL,
    start_ms    INTEGER NOT NULL,
    end_ms      INTEGER,
    embedding   BYTEA NOT NULL,
    embed_model TEXT NOT NULL,
    created_at  INTEGER NOT NULL
  )`,

  `CREATE INDEX IF NOT EXISTS idx_chunks_video ON transcript_chunks(video_id, chunk_index)`,

  `CREATE TABLE IF NOT EXISTS chat_messages (
    id         TEXT PRIMARY KEY,
    video_id   TEXT NOT NULL REFERENCES videos(video_id) ON DELETE CASCADE,
    role       TEXT NOT NULL,
    content    TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )`,

  `CREATE INDEX IF NOT EXISTS idx_chat_video ON chat_messages(video_id, created_at)`,

  // ----- TAV-13: AI chapter detection ---------------------------------

  // One row per video holding the AI-detected chapters (JSON array of
  // {title, startMs}). Re-detected chapters upsert by video_id.
  `CREATE TABLE IF NOT EXISTS video_chapters (
    video_id    TEXT PRIMARY KEY REFERENCES videos(video_id) ON DELETE CASCADE,
    chapters     TEXT NOT NULL,
    model        TEXT NOT NULL,
    token_count  INTEGER,
    created_at   INTEGER NOT NULL
  )`,

  `CREATE INDEX IF NOT EXISTS idx_video_chapters_created ON video_chapters(created_at DESC)`,
];

export const SEED_FOLDERS = ['Watch Later', 'Reference', 'Music'] as const;
