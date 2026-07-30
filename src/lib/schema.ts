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

-- ----- TAV-4: 1-Click Instant Summaries -------------------------------------
-- Videos we've seen (recent uploads per channel). We cache transcript + summary
-- so a re-click is instant and so Chat-with-Video (TAV-3) can reuse the
-- transcript without re-fetching. A video belongs to exactly one channel.

CREATE TABLE IF NOT EXISTS videos (
  video_id      TEXT PRIMARY KEY,            -- YouTube video id (11 chars)
  channel_id    TEXT NOT NULL REFERENCES channels(channel_id) ON DELETE CASCADE,
  title         TEXT NOT NULL,
  description   TEXT,
  thumbnail_url TEXT,
  duration_seconds INTEGER,
  published_at  INTEGER,                       -- unix seconds
  transcript    TEXT,                          -- raw fetched transcript (nullable while pending/failed)
  transcript_status TEXT NOT NULL DEFAULT 'pending',  -- pending | fetched | unavailable | error
  transcript_fetched_at INTEGER,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_videos_channel ON videos(channel_id, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_videos_status  ON videos(transcript_status);

-- One summary per (video, model) so swapping models re-summarizes without
-- clobbering the prior result. The UI shows the most recent.

CREATE TABLE IF NOT EXISTS summaries (
  id          TEXT PRIMARY KEY,
  video_id    TEXT NOT NULL REFERENCES videos(video_id) ON DELETE CASCADE,
  model       TEXT NOT NULL,                  -- e.g. "zai-org-glm-5-1"
  tldr        TEXT NOT NULL,
  key_points  TEXT NOT NULL,                   -- JSON array of strings
  follow_ups  TEXT,                             -- JSON array of {video_id,title,reason} (may be empty)
  prompt      TEXT NOT NULL,
  token_count INTEGER,
  created_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_summaries_video ON summaries(video_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_video_model ON summaries(video_id, model);

-- ----- TAV-5: Chat with Video (RAG over transcripts) -------------------------
-- Timestamped transcript segments, one row per caption cue. Populated when a
-- video is indexed for chat. The plain-text videos.transcript column is kept
-- for the summarizer; this table adds the timing the chat needs to link answers
-- back to moments in the video.

CREATE TABLE IF NOT EXISTS transcript_segments (
  video_id   TEXT NOT NULL REFERENCES videos(video_id) ON DELETE CASCADE,
  seg_index INTEGER NOT NULL,              -- 0-based order within the video
  text       TEXT NOT NULL,
  start_ms   INTEGER NOT NULL,             -- cue start, milliseconds from video start
  end_ms     INTEGER,                      -- cue end (nullable for the last cue)
  PRIMARY KEY (video_id, seg_index)
);

CREATE INDEX IF NOT EXISTS idx_tsegs_video ON transcript_segments(video_id, seg_index);

-- Transcript chunks for vector search. Each chunk groups 1-N adjacent segments
-- into a ~300-500 char passage. The embedding is a Float32 BLOB of dimension
-- matching the embedding model (1024 for bge-m3). Cosine similarity is computed
-- in JS at query time — fine for the per-video scale (~50-200 chunks).

CREATE TABLE IF NOT EXISTS transcript_chunks (
  id          TEXT PRIMARY KEY,
  video_id    TEXT NOT NULL REFERENCES videos(video_id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL,             -- 0-based order within the video
  text        TEXT NOT NULL,
  start_ms    INTEGER NOT NULL,             -- first segment's start
  end_ms      INTEGER,                      -- last segment's end
  embedding   BLOB NOT NULL,                -- Float32Array buffer
  embed_model TEXT NOT NULL,                -- which model produced the vector
  created_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_chunks_video ON transcript_chunks(video_id, chunk_index);

-- Chat messages — the conversation history per video. The UI replays these to
-- keep context across turns without server-side session state.

CREATE TABLE IF NOT EXISTS chat_messages (
  id          TEXT PRIMARY KEY,
  video_id    TEXT NOT NULL REFERENCES videos(video_id) ON DELETE CASCADE,
  role        TEXT NOT NULL,               -- 'user' | 'assistant'
  content     TEXT NOT NULL,
  created_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_chat_video ON chat_messages(video_id, created_at);
`;

export const SEED_FOLDERS = ['Watch Later', 'Reference', 'Music'] as const;