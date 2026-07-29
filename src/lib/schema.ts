/**
 * SQLite schema for 1minyt subscriptions.
 *
 * Tables:
 *  - channels: one row per YouTube channel the user is subscribed to.
 *  - folders:  user-defined collections ("Tech", "Cooking", "Music", "Watch Later").
 *  - tags:     free-form labels for fine-grained filtering ("deep-dives", "tutorials").
 *  - channel_folders: many-to-many between channels and folders (a channel can be in many).
 *  - channel_tags:    many-to-many between channels and tags.
 *  - sync_runs:       log of every sync against the YouTube Data API.
 *
 * Conventions:
 *  - Timestamps are unix seconds.
 *  - "music_flag" is the system's best-effort classification (0=unknown, 1=music, 2=not-music).
 *  - All ids use ULID-ish 26-char strings to be URL-safe and sortable.
 */

export const SCHEMA_SQL = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA synchronous = NORMAL;

CREATE TABLE IF NOT EXISTS channels (
  channel_id      TEXT PRIMARY KEY,                 -- YouTube channel id (UCxxxxxx)
  title           TEXT NOT NULL,
  handle          TEXT,                              -- @handle (e.g. @mkbhd)
  description     TEXT,
  thumbnail_url   TEXT,
  subscriber_count INTEGER,
  video_count     INTEGER,
  country         TEXT,
  custom_url      TEXT,
  music_flag      INTEGER NOT NULL DEFAULT 0,        -- 0=unknown, 1=music, 2=not-music
  music_score     REAL NOT NULL DEFAULT 0,           -- 0..1 confidence
  hidden          INTEGER NOT NULL DEFAULT 0,        -- soft-hide without unsubscribing
  notes           TEXT,                              -- free-form user notes
  subscribed_at   INTEGER,                           -- unix seconds from YouTube
  synced_at       INTEGER NOT NULL,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_channels_title         ON channels(title COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_channels_handle        ON channels(handle);
CREATE INDEX IF NOT EXISTS idx_channels_music_flag    ON channels(music_flag);
CREATE INDEX IF NOT EXISTS idx_channels_subscriber    ON channels(subscriber_count);

CREATE TABLE IF NOT EXISTS folders (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE COLLATE NOCASE,
  color       TEXT,                                  -- hex like #5b9eff
  position    INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_folders_position ON folders(position, name COLLATE NOCASE);

CREATE TABLE IF NOT EXISTS tags (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE COLLATE NOCASE,
  color       TEXT,
  created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS channel_folders (
  channel_id TEXT NOT NULL REFERENCES channels(channel_id) ON DELETE CASCADE,
  folder_id  TEXT NOT NULL REFERENCES folders(id)       ON DELETE CASCADE,
  PRIMARY KEY (channel_id, folder_id)
);

CREATE INDEX IF NOT EXISTS idx_channel_folders_folder ON channel_folders(folder_id);

CREATE TABLE IF NOT EXISTS channel_tags (
  channel_id TEXT NOT NULL REFERENCES channels(channel_id) ON DELETE CASCADE,
  tag_id     TEXT NOT NULL REFERENCES tags(id)            ON DELETE CASCADE,
  PRIMARY KEY (channel_id, tag_id)
);

CREATE INDEX IF NOT EXISTS idx_channel_tags_tag ON channel_tags(tag_id);

CREATE TABLE IF NOT EXISTS sync_runs (
  id          TEXT PRIMARY KEY,
  started_at  INTEGER NOT NULL,
  finished_at INTEGER,
  status      TEXT NOT NULL,                         -- 'running' | 'success' | 'error'
  channels_seen INTEGER NOT NULL DEFAULT 0,
  channels_new  INTEGER NOT NULL DEFAULT 0,
  channels_updated INTEGER NOT NULL DEFAULT 0,
  error       TEXT
);

CREATE INDEX IF NOT EXISTS idx_sync_runs_started ON sync_runs(started_at DESC);

-- Single-user OAuth tokens. user_id is hardcoded to "me" in Phase 1.
CREATE TABLE IF NOT EXISTS oauth_tokens (
  user_id       TEXT PRIMARY KEY,
  access_token  TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  expiry_date   INTEGER,
  updated_at    INTEGER NOT NULL
);
`;

export const SEED_FOLDERS = ['Watch Later', 'Reference', 'Music'] as const;