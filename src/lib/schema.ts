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

  // TAV-17: persist channel fields we already fetch but discard.
  // topic_categories — JSON array of Freebase/Wikipedia URLs from topicDetails.
  `ALTER TABLE channels ADD COLUMN IF NOT EXISTS topic_categories TEXT`,
  // brandingSettings.channel.bannerImageUrl + branding keywords.
  `ALTER TABLE channels ADD COLUMN IF NOT EXISTS banner_image_url   TEXT`,
  `ALTER TABLE channels ADD COLUMN IF NOT EXISTS branding_keywords  TEXT`,

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

  // TAV-19: track where a transcript came from — 'youtube' (Innertube/yt-dlp
  // captions) or 'whisper' (speech-to-text fallback). Nullable so the migration
  // is additive; null is treated as 'youtube' for rows written before this change.
  `ALTER TABLE videos ADD COLUMN IF NOT EXISTS transcript_source TEXT`,

  // TAV-17: persist video fields we already fetch but discard.
  // Engagement stats from `videos.list?part=statistics`.
  `ALTER TABLE videos ADD COLUMN IF NOT EXISTS view_count     INTEGER`,
  `ALTER TABLE videos ADD COLUMN IF NOT EXISTS like_count    INTEGER`,
  `ALTER TABLE videos ADD COLUMN IF NOT EXISTS comment_count INTEGER`,
  `ALTER TABLE videos ADD COLUMN IF NOT EXISTS favorite_count INTEGER`,
  // snippet.tags (JSON array) + snippet.categoryId.
  `ALTER TABLE videos ADD COLUMN IF NOT EXISTS tags         TEXT`,
  `ALTER TABLE videos ADD COLUMN IF NOT EXISTS category_id  INTEGER`,
  // liveStreamingDetails + liveBroadcastContent.
  `ALTER TABLE videos ADD COLUMN IF NOT EXISTS is_live              INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE videos ADD COLUMN IF NOT EXISTS live_streaming_details TEXT`,

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

  // TAV-30: summary indexing — distinguish summary chunks from transcript chunks
  // so both can coexist in one table and be searched via searchAcross. Backfilled
  // to 'transcript' for all pre-existing rows; new transcript chunks default to it.
  `ALTER TABLE transcript_chunks ADD COLUMN IF NOT EXISTS chunk_type TEXT NOT NULL DEFAULT 'transcript'`,
  `CREATE INDEX IF NOT EXISTS idx_chunks_video_type ON transcript_chunks(video_id, chunk_type)`,

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

  // ----- TAV-14: new-video digests --------------------------------------

  // One row per digest run. `new_video_ids` is a JSON array of video ids that
  // were first seen during this digest's sync pass. `period_start` / `period_end`
  // are unix seconds bounding the window of newly-published videos.
  `CREATE TABLE IF NOT EXISTS digests (
    id             TEXT PRIMARY KEY,
    period_start   INTEGER,
    period_end     INTEGER NOT NULL,
    video_count    INTEGER NOT NULL DEFAULT 0,
    new_video_ids  TEXT NOT NULL DEFAULT '[]',
    channel_count  INTEGER NOT NULL DEFAULT 0,
    errors         TEXT,
    created_at     INTEGER NOT NULL
  )`,

  `CREATE INDEX IF NOT EXISTS idx_digests_created ON digests(created_at DESC)`,

  // ----- TAV-20: Community Pulse — top comments + summary ----------------------
  //
  // One row per video holding the fetched top-level comments (JSON array of
  // VideoComment) and the LLM-generated community summary. Re-fetched comments
  // upsert by video_id; the summary is regenerated each summarize run.
  `CREATE TABLE IF NOT EXISTS video_comments (
    video_id    TEXT PRIMARY KEY REFERENCES videos(video_id) ON DELETE CASCADE,
    comments    TEXT NOT NULL DEFAULT '[]',
    fetched_at  INTEGER NOT NULL,
    summary     TEXT,
    summary_model TEXT,
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL
  )`,

  `CREATE INDEX IF NOT EXISTS idx_video_comments_updated ON video_comments(updated_at DESC)`,

  // ----- TAV-22: Unified inbox — per-video triage state -----------------------
  //
  // One row per video the user has acted on in the /inbox. `state` is the
  // triage bucket: 'seen' (dismissed) or 'saved' (bookmark for later).
  // A video with no row here has not been triaged yet and still appears in
  // the inbox. Re-triaging a video upserts the state and bumps updated_at.
  `CREATE TABLE IF NOT EXISTS video_states (
    video_id   TEXT PRIMARY KEY REFERENCES videos(video_id) ON DELETE CASCADE,
    state      TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  )`,

  `CREATE INDEX IF NOT EXISTS idx_video_states_state ON video_states(state, updated_at DESC)`,

  // ----- TAV-23: Summarize Later queue -----------------------------------------
  //
  // A Pocket-style queue of videos the user wants summarized later. One row
  // per queued video; `state` is 'queued' (waiting) or 'summarized' (the
  // batch summarize processed it). Re-queuing an already-summarized video
  // flips it back to 'queued'. Removing from the queue deletes the row.
  `CREATE TABLE IF NOT EXISTS summarize_queue (
    id           TEXT PRIMARY KEY,
    video_id     TEXT NOT NULL REFERENCES videos(video_id) ON DELETE CASCADE,
    state        TEXT NOT NULL DEFAULT 'queued',
    queued_at    INTEGER NOT NULL,
    summarized_at INTEGER,
    created_at   INTEGER NOT NULL
  )`,

  // One active queue entry per video — re-queuing upserts in place.
  `CREATE UNIQUE INDEX IF NOT EXISTS uq_summarize_queue_video ON summarize_queue(video_id)`,
  `CREATE INDEX IF NOT EXISTS idx_summarize_queue_state ON summarize_queue(state, queued_at DESC)`,

  // ----- TAV-26: Curated channel playlists -----------------------------------
  //
  // One row per public playlist a channel curates ("Start Here", "Best
  // Interviews", etc.). The playlist_id is YouTube's own id (the `PL...`
  // string). Re-fetching a channel's playlists upserts by playlist_id.
  `CREATE TABLE IF NOT EXISTS channel_playlists (
    playlist_id    TEXT PRIMARY KEY,
    channel_id     TEXT NOT NULL REFERENCES channels(channel_id) ON DELETE CASCADE,
    title          TEXT NOT NULL,
    description    TEXT,
    thumbnail_url  TEXT,
    item_count     INTEGER,
    published_at   INTEGER,
    synced_at      INTEGER NOT NULL
  )`,

  `CREATE INDEX IF NOT EXISTS idx_channel_playlists_channel ON channel_playlists(channel_id, title)`,

  // One row per video position in a curated playlist. The composite PK
  // (playlist_id, video_id) means a video can appear in many playlists but only
  // once per playlist. Re-fetching a playlist's videos upserts positions.
  `CREATE TABLE IF NOT EXISTS playlist_videos (
    playlist_id    TEXT NOT NULL REFERENCES channel_playlists(playlist_id) ON DELETE CASCADE,
    video_id       TEXT NOT NULL,
    title          TEXT NOT NULL,
    description    TEXT,
    thumbnail_url  TEXT,
    position       INTEGER NOT NULL,
    published_at   INTEGER,
    synced_at      INTEGER NOT NULL,
    PRIMARY KEY (playlist_id, video_id)
  )`,

  `CREATE INDEX IF NOT EXISTS idx_playlist_videos_position ON playlist_videos(playlist_id, position)`,

  // One row per playlist, holding the LLM-generated synthesis of the whole
  // collection. Re-summarizing upserts by playlist_id.
  `CREATE TABLE IF NOT EXISTS playlist_summaries (
    id             TEXT PRIMARY KEY,
    playlist_id    TEXT NOT NULL REFERENCES channel_playlists(playlist_id) ON DELETE CASCADE,
    model          TEXT NOT NULL,
    synthesis      TEXT NOT NULL,
    themes         TEXT NOT NULL DEFAULT '[]',
    start_here     TEXT NOT NULL DEFAULT '[]',
    token_count    INTEGER,
    created_at     INTEGER NOT NULL
  )`,

  `CREATE UNIQUE INDEX IF NOT EXISTS uq_playlist_summary ON playlist_summaries(playlist_id)`,

  // ----- TAV-29: Video reference graph — cross-video citations ----------------
  //
  // One row per directed edge: a source video's summary cited a target video
  // (or channel) as a follow-up. The edge carries the follow-up reason text so
  // the graph view can show *why* the connection exists. Re-summarizing a video
  // replaces its outgoing edges (delete-then-insert by source_video_id) so the
  // graph stays in sync with the latest summary.
  `CREATE TABLE IF NOT EXISTS video_references (
    id              TEXT PRIMARY KEY,
    source_video_id TEXT NOT NULL REFERENCES videos(video_id) ON DELETE CASCADE,
    target_video_id TEXT,
    target_channel_id TEXT,
    reference_type  TEXT NOT NULL,
    context         TEXT,
    created_at      INTEGER NOT NULL
  )`,

  `CREATE INDEX IF NOT EXISTS idx_video_refs_source ON video_references(source_video_id)`,
  `CREATE INDEX IF NOT EXISTS idx_video_refs_target_video ON video_references(target_video_id)`,
  `CREATE INDEX IF NOT EXISTS idx_video_refs_target_channel ON video_references(target_channel_id)`,

  // ----- TAV-27: Read-later integrations (Readwise / Notion / Obsidian) --------
  //
  // One row per integration, holding the user-supplied access token / API key
  // and any integration-specific options (e.g. a Notion database id). The key
  // is the integration slug ('readwise', 'notion', 'obsidian'). Re-saving a
  // token upserts by key. Tokens are stored as plaintext in the DB — this app
  // is a single-user local tool, not a multi-tenant SaaS.
  `CREATE TABLE IF NOT EXISTS integration_settings (
    key         TEXT PRIMARY KEY,
    token       TEXT NOT NULL,
    options     TEXT NOT NULL DEFAULT '{}',
    updated_at  INTEGER NOT NULL
  )`,
  // ----- TAV-41: Likes + play history ----------------------------------------
  `CREATE TABLE IF NOT EXISTS video_likes (
    video_id   TEXT PRIMARY KEY REFERENCES videos(video_id) ON DELETE CASCADE,
    liked_at   INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_video_likes_liked_at ON video_likes(liked_at DESC)`,
  `CREATE TABLE IF NOT EXISTS video_play_history (
    video_id       TEXT PRIMARY KEY REFERENCES videos(video_id) ON DELETE CASCADE,
    first_played_at INTEGER NOT NULL,
    last_played_at  INTEGER NOT NULL,
    play_count     INTEGER NOT NULL DEFAULT 1,
    -- TAV-41: the user's most recent playback position, in seconds. Updated
    -- unconditionally (NOT GREATEST) so a rewind + rewatch keeps Continue
    -- Watching accurate. The high-water mark is "completed" below.
    last_progress_seconds INTEGER NOT NULL DEFAULT 0,
    -- TAV-41: 1 once the user has ever crossed ~90 % of the video. Monotonic
    -- (latch-once) — re-watching an already-completed video does not reset it.
    completed      INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE INDEX IF NOT EXISTS idx_video_history_last_played ON video_play_history(last_played_at DESC)`,

  // ----- TAV-61: Pinned videos for the Watch/Music queue ----------------------
  //
  // One row per pinned video on a given queue surface. `queue` is 'watch' or
  // 'music' — the same video could be pinned to both independently. `position`
  // is the pin order within the queue (lower = closer to the top); the most
  // recently pinned video gets position 0 so it lands at the top. Re-pinning a
  // video that's already on a queue updates its pinned_at and bumps it to the
  // top. Deleting unpins. The composite (queue, video_id) unique constraint
  // means one active pin per video per queue.
  `CREATE TABLE IF NOT EXISTS queue_pins (
    queue       TEXT NOT NULL,
    video_id    TEXT NOT NULL REFERENCES videos(video_id) ON DELETE CASCADE,
    position    INTEGER NOT NULL DEFAULT 0,
    pinned_at   INTEGER NOT NULL,
    created_at  INTEGER NOT NULL,
    PRIMARY KEY (queue, video_id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_queue_pins_queue_pos ON queue_pins(queue, position ASC, pinned_at DESC)`,

];

export const SEED_FOLDERS = ['Watch Later', 'Reference', 'Music'] as const;