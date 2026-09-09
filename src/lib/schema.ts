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

// ----- TAV-68: multi-user migration statement builders -------------------------
//
// The multi-user block below needs three kinds of guarded DDL that plain
// `ALTER ... IF EXISTS` can't express (PK swaps, FK re-points, unique-constraint
// drops). Each builder emits a self-contained, idempotent statement — safe to
// re-run on every cold start. See the TAV-68 block comment in
// SCHEMA_STATEMENTS for the overall flow.

/**
 * Add a `user_id` column to a table, backfill any pre-multiuser rows to the
 * legacy owner ('me'), then tighten the column to NOT NULL. The backfill is a
 * no-op once every row is claimed, and SET NOT NULL is a no-op when already
 * set — so the trio is safely re-runnable.
 */
function scopedColumnStatements(table: string): string[] {
  return [
    `ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS user_id TEXT`,
    `UPDATE ${table} SET user_id = 'me' WHERE user_id IS NULL`,
    `ALTER TABLE ${table} ALTER COLUMN user_id SET NOT NULL`,
  ];
}

/**
 * Swap a table's primary key to a user-scoped composite. Dropping the old PK
 * CASCADE-drops every child FK that depended on it; the composite replacements
 * are added right after by {@link scopedForeignKey}. No-op (no drop, no
 * re-add) once the PK already includes user_id — so post-migration cold starts
 * stay cheap.
 */
function scopedPrimaryKey(table: string, cols: string[]): string {
  return `DO $$
DECLARE pk_name text;
BEGIN
  SELECT conname INTO pk_name FROM pg_constraint
   WHERE conrelid = '${table}'::regclass AND contype = 'p';
  IF pk_name IS NOT NULL AND NOT EXISTS (
    SELECT 1
      FROM pg_constraint c
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
     WHERE c.conrelid = '${table}'::regclass
       AND c.contype = 'p'
       AND a.attname = 'user_id'
  ) THEN
    EXECUTE format('ALTER TABLE %I DROP CONSTRAINT %I CASCADE', '${table}', pk_name);
    EXECUTE format('ALTER TABLE %I ADD PRIMARY KEY (${cols.join(', ')})', '${table}');
  END IF;
END $$;`;
}

/**
 * Re-point a child table's FK at the user-scoped parent key. First drops any
 * remaining legacy FK from the child to the parent (the parent's PK-swap
 * CASCADE usually already did), then adds the named composite FK with the
 * original ON DELETE CASCADE behaviour. No-op once the named constraint exists.
 * Must run AFTER the parent's {@link scopedPrimaryKey} — the composite FK needs
 * the parent's composite PK in place.
 */
function scopedForeignKey(
  table: string,
  name: string,
  cols: string[],
  parent: string,
  parentCols: string[],
): string {
  return `DO $$
DECLARE r record;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = '${name}' AND conrelid = '${table}'::regclass
  ) THEN
    FOR r IN
      SELECT conname FROM pg_constraint
       WHERE conrelid = '${table}'::regclass
         AND confrelid = '${parent}'::regclass
         AND contype = 'f'
    LOOP
      EXECUTE format('ALTER TABLE ${table} DROP CONSTRAINT %I', r.conname);
    END LOOP;
    ALTER TABLE ${table} ADD CONSTRAINT ${name}
      FOREIGN KEY (${cols.join(', ')})
      REFERENCES ${parent} (${parentCols.join(', ')})
      ON DELETE CASCADE;
  END IF;
END $$;`;
}

/**
 * Replace a pre-multiuser index with its user-scoped equivalent (same name,
 * new column list). Re-running drops nothing and skips the create because the
 * IF NOT EXISTS check sees the new definition already in place.
 */
function scopedIndex(table: string, name: string, cols: string): string[] {
  return [
    `DROP INDEX IF EXISTS ${name}`,
    `CREATE INDEX IF NOT EXISTS ${name} ON ${table}(${cols})`,
  ];
}

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

  // TAV-41: additive columns on video_play_history. The table predates these
  // columns, and CREATE TABLE IF NOT EXISTS won't add them to an existing table,
  // so ALTER is required for already-provisioned databases.
  `ALTER TABLE video_play_history ADD COLUMN IF NOT EXISTS last_progress_seconds INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE video_play_history ADD COLUMN IF NOT EXISTS completed INTEGER NOT NULL DEFAULT 0`,

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

  // ----- TAV-63: Library-wide chat (E) + scoped chat (F) ---------------------
  //
  // Conversation history for the /chat surface, keyed by a scope string rather
  // than a video id: 'all' (whole library), 'channel:<id>', 'folder:<id>' or
  // 'tag:<id>'. Each scope keeps its own thread so switching scopes doesn't
  // leak context across collections.
  `CREATE TABLE IF NOT EXISTS library_chat_messages (
    id         TEXT PRIMARY KEY,
    scope      TEXT NOT NULL,
    role       TEXT NOT NULL,
    content    TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )`,

  `CREATE INDEX IF NOT EXISTS idx_library_chat_scope ON library_chat_messages(scope, created_at)`,

  // ----- TAV-64: Channel dossier — per-channel "memory" layer (G) ------------
  //
  // One row per channel holding an LLM-distilled dossier: what the channel
  // covers, its perspective, recurring formats, and signature themes. Built
  // map-reduce style from the channel's cached per-video summaries and injected
  // into the library-chat system prompt when the chat is scoped to that
  // channel. Re-generating upserts by channel_id.
  `CREATE TABLE IF NOT EXISTS channel_dossiers (
    channel_id  TEXT PRIMARY KEY REFERENCES channels(channel_id) ON DELETE CASCADE,
    model       TEXT NOT NULL,
    dossier     TEXT NOT NULL,
    themes      TEXT NOT NULL DEFAULT '[]',
    video_count INTEGER NOT NULL DEFAULT 0,
    token_count INTEGER,
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL
  )`,

  // ----- TAV-65: Agentic library chat trace (H) -------------------------------
  //
  // When Deep Research mode runs, we persist which tools the agent called so
  // the UI can show the retrieval trace next to the answer.
  `ALTER TABLE library_chat_messages ADD COLUMN IF NOT EXISTS tool_trace TEXT`,

  // ----- TAV-62: Per-track music video presentation -----------------------------
  //
  // The /music page heuristically decides whether a track shows the full 16:9
  // video player or the minimized audio-only bar (see
  // `computeMusicVideoPresentation` in music-video-pref.ts). This column is the
  // user's manual override: NULL = trust the heuristic; 'video' / 'audio' = pin
  // the presentation regardless of what the heuristic guesses. Additive ALTER
  // because CREATE TABLE IF NOT EXISTS won't add columns to an existing table.
  `ALTER TABLE videos ADD COLUMN IF NOT EXISTS video_pref TEXT`,

  // ----- TAV-68: int4 overflow on viral view counts ------------------------------
  //
  // videos.view_count was born INTEGER (max 2,147,483,647). Mega-viral videos
  // exceed that (Gangnam Style ≈ 6B) and blew up the extension's queue-by-URL
  // ingest with `value out of range for type integer`. Widen to BIGINT — a
  // re-run of the same TYPE change is a no-op, so it's safe on every boot.
  // Found by the TAV-68 extension smoke test (SMOKE_VIDEO_ID=9bZkp7q19f0).
  `ALTER TABLE videos ALTER COLUMN view_count TYPE BIGINT`,
  // ----- TAV-68: Multi-user — users, sessions, per-user data scoping -----------
  //
  // The app was born single-user: one shared pool of channels / videos /
  // summaries / chats keyed only by YouTube ids, and one hardcoded 'me' OAuth
  // token row (see lib/tokens.ts). Any second person who connected overwrote
  // the token and merged their subscriptions into the same pool — every page
  // showed the union of both users' data.
  //
  // This block installs the multi-user substrate, in order:
  //  1. `users` + `sessions` (opaque session-id auth — see lib/auth.ts).
  //  2. A legacy owner row ('me') when pre-multiuser data exists. The first
  //     Google login after this migration claims that row (lib/auth.ts), so
  //     the original owner keeps their library — deploy, then have the owner
  //     log in BEFORE inviting anyone else.
  //  3. A `user_id` column on every data table, backfilled to 'me' and NOT
  //     NULL. Fresh databases get the columns via these same ALTERs (the
  //     CREATE TABLE blocks above stay untouched per repo convention).
  //  4. PK / unique surgery: keys that were bare YouTube ids become
  //     user-scoped composites — (user_id, channel_id), (user_id, video_id),
  //     etc. — so two users can hold the same channel/video independently.
  //     Tables whose PK is an app-generated random id (summaries, chat rows,
  //     ...) keep that PK and rely on query scoping + user-prefixed indexes.
  //  5. FK re-points: composite FKs keep ON DELETE CASCADE working (deleting
  //     a channel still deletes its videos, summaries, chats, ...).
  //  6. User-prefixed replacements for the hot-path indexes.
  //
  // `user_id` columns deliberately carry NO FK to `users`: the '__anon'
  // sentinel bucket (anonymous paste-a-URL, TAV-67) has no users row, and
  // isolation is enforced by a user_id predicate in every query rather than
  // by referential integrity.
  //
  // All surgery lives in guarded DO blocks (see the builders above) that
  // no-op once applied, so SCHEMA_STATEMENTS stays safely re-runnable on every
  // cold start. db.ts runs the whole array inside one transaction under an
  // advisory lock — a mid-migration failure rolls back atomically and
  // concurrent serverless cold starts can't race each other.

  // -- 1. identity + sessions ---------------------------------------------------
  `CREATE TABLE IF NOT EXISTS users (
    id                TEXT PRIMARY KEY,
    -- Stable identity: the YouTube channel id of the connected Google account
    -- (channels.list?mine=true). NULL only for the unclaimed legacy owner.
    google_channel_id TEXT UNIQUE,
    display_name      TEXT,
    avatar_url        TEXT,
    created_at        INTEGER NOT NULL,
    updated_at        INTEGER NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS sessions (
    id          TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL,
    created_at  INTEGER NOT NULL,
    expires_at  INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at)`,

  // -- 2. legacy owner row --------------------------------------------------------
  //
  // Created only when pre-multiuser data exists. The google_channel_id stays
  // NULL until the first Google login claims it (findOrCreateUser in
  // lib/auth.ts) — that login gets this row and, with it, all backfilled data.
  `DO $$
DECLARE now_sec integer := EXTRACT(EPOCH FROM NOW())::int;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM users WHERE id = 'me') THEN
    IF EXISTS (SELECT 1 FROM oauth_tokens WHERE user_id = 'me') THEN
      INSERT INTO users (id, google_channel_id, display_name, avatar_url, created_at, updated_at)
      SELECT 'me', NULL, display_name, avatar_url, updated_at, updated_at
        FROM oauth_tokens WHERE user_id = 'me';
    ELSIF EXISTS (SELECT 1 FROM channels) THEN
      -- Data predates multi-user but was never OAuth-connected.
      INSERT INTO users (id, google_channel_id, created_at, updated_at)
      VALUES ('me', NULL, now_sec, now_sec);
    END IF;
  END IF;
END $$;`,

  // -- 3. user_id columns (add → backfill → NOT NULL) -----------------------------
  ...scopedColumnStatements('channels'),
  ...scopedColumnStatements('folders'),
  ...scopedColumnStatements('tags'),
  ...scopedColumnStatements('channel_folders'),
  ...scopedColumnStatements('channel_tags'),
  ...scopedColumnStatements('sync_runs'),
  ...scopedColumnStatements('videos'),
  ...scopedColumnStatements('summaries'),
  ...scopedColumnStatements('transcript_segments'),
  ...scopedColumnStatements('transcript_chunks'),
  ...scopedColumnStatements('chat_messages'),
  ...scopedColumnStatements('video_chapters'),
  ...scopedColumnStatements('digests'),
  ...scopedColumnStatements('video_comments'),
  ...scopedColumnStatements('video_states'),
  ...scopedColumnStatements('summarize_queue'),
  ...scopedColumnStatements('channel_playlists'),
  ...scopedColumnStatements('playlist_videos'),
  ...scopedColumnStatements('playlist_summaries'),
  ...scopedColumnStatements('video_references'),
  ...scopedColumnStatements('integration_settings'),
  ...scopedColumnStatements('video_likes'),
  ...scopedColumnStatements('video_play_history'),
  ...scopedColumnStatements('queue_pins'),
  ...scopedColumnStatements('library_chat_messages'),
  ...scopedColumnStatements('channel_dossiers'),

  // -- 4. PK surgery (parents before children; FKs restored in step 5) -----------
  scopedPrimaryKey('channels', ['user_id', 'channel_id']),
  scopedPrimaryKey('channel_folders', ['user_id', 'channel_id', 'folder_id']),
  scopedPrimaryKey('channel_tags', ['user_id', 'channel_id', 'tag_id']),
  scopedPrimaryKey('videos', ['user_id', 'video_id']),
  scopedPrimaryKey('transcript_segments', ['user_id', 'video_id', 'seg_index']),
  scopedPrimaryKey('video_chapters', ['user_id', 'video_id']),
  scopedPrimaryKey('video_comments', ['user_id', 'video_id']),
  scopedPrimaryKey('video_states', ['user_id', 'video_id']),
  scopedPrimaryKey('video_likes', ['user_id', 'video_id']),
  scopedPrimaryKey('video_play_history', ['user_id', 'video_id']),
  scopedPrimaryKey('queue_pins', ['user_id', 'queue', 'video_id']),
  scopedPrimaryKey('channel_playlists', ['user_id', 'playlist_id']),
  scopedPrimaryKey('playlist_videos', ['user_id', 'playlist_id', 'video_id']),
  scopedPrimaryKey('channel_dossiers', ['user_id', 'channel_id']),
  scopedPrimaryKey('integration_settings', ['user_id', 'key']),

  // -- 5. composite FKs (children of channels) ------------------------------------
  scopedForeignKey('videos', 'videos_channel_fk', ['user_id', 'channel_id'], 'channels', ['user_id', 'channel_id']),
  scopedForeignKey('channel_folders', 'channel_folders_channel_fk', ['user_id', 'channel_id'], 'channels', ['user_id', 'channel_id']),
  scopedForeignKey('channel_tags', 'channel_tags_channel_fk', ['user_id', 'channel_id'], 'channels', ['user_id', 'channel_id']),
  scopedForeignKey('channel_playlists', 'channel_playlists_channel_fk', ['user_id', 'channel_id'], 'channels', ['user_id', 'channel_id']),
  scopedForeignKey('channel_dossiers', 'channel_dossiers_channel_fk', ['user_id', 'channel_id'], 'channels', ['user_id', 'channel_id']),

  // -- 5b. composite FKs (children of videos) -------------------------------------
  scopedForeignKey('summaries', 'summaries_video_fk', ['user_id', 'video_id'], 'videos', ['user_id', 'video_id']),
  scopedForeignKey('transcript_segments', 'transcript_segments_video_fk', ['user_id', 'video_id'], 'videos', ['user_id', 'video_id']),
  scopedForeignKey('transcript_chunks', 'transcript_chunks_video_fk', ['user_id', 'video_id'], 'videos', ['user_id', 'video_id']),
  scopedForeignKey('chat_messages', 'chat_messages_video_fk', ['user_id', 'video_id'], 'videos', ['user_id', 'video_id']),
  scopedForeignKey('video_chapters', 'video_chapters_video_fk', ['user_id', 'video_id'], 'videos', ['user_id', 'video_id']),
  scopedForeignKey('video_comments', 'video_comments_video_fk', ['user_id', 'video_id'], 'videos', ['user_id', 'video_id']),
  scopedForeignKey('video_states', 'video_states_video_fk', ['user_id', 'video_id'], 'videos', ['user_id', 'video_id']),
  scopedForeignKey('video_likes', 'video_likes_video_fk', ['user_id', 'video_id'], 'videos', ['user_id', 'video_id']),
  scopedForeignKey('video_play_history', 'video_play_history_video_fk', ['user_id', 'video_id'], 'videos', ['user_id', 'video_id']),
  scopedForeignKey('queue_pins', 'queue_pins_video_fk', ['user_id', 'video_id'], 'videos', ['user_id', 'video_id']),
  scopedForeignKey('summarize_queue', 'summarize_queue_video_fk', ['user_id', 'video_id'], 'videos', ['user_id', 'video_id']),
  scopedForeignKey('video_references', 'video_references_video_fk', ['user_id', 'source_video_id'], 'videos', ['user_id', 'video_id']),

  // -- 5c. composite FKs (children of channel_playlists) ---------------------------
  scopedForeignKey('playlist_videos', 'playlist_videos_playlist_fk', ['user_id', 'playlist_id'], 'channel_playlists', ['user_id', 'playlist_id']),
  scopedForeignKey('playlist_summaries', 'playlist_summaries_playlist_fk', ['user_id', 'playlist_id'], 'channel_playlists', ['user_id', 'playlist_id']),
  // NOTE: channel_folders.folder_id → folders(id) and channel_tags.tag_id →
  // tags(id) stay single-column — folders/tags keep their app-generated id PK.
  // Ownership of the linked folder/tag is enforced at the query layer.

  // -- 6a. per-user uniqueness (folders / tags names, caches) ----------------------
  `ALTER TABLE folders DROP CONSTRAINT IF EXISTS folders_name_key`,
  `CREATE UNIQUE INDEX IF NOT EXISTS uq_folders_user_name ON folders(user_id, name)`,
  `ALTER TABLE tags DROP CONSTRAINT IF EXISTS tags_name_key`,
  `CREATE UNIQUE INDEX IF NOT EXISTS uq_tags_user_name ON tags(user_id, name)`,
  // summaries: one row per (user, video, model) — replaces uq_video_model.
  `DROP INDEX IF EXISTS uq_video_model`,
  `CREATE UNIQUE INDEX IF NOT EXISTS uq_summaries_user_video_model ON summaries(user_id, video_id, model)`,
  // summarize_queue: one active entry per (user, video).
  `DROP INDEX IF EXISTS uq_summarize_queue_video`,
  `CREATE UNIQUE INDEX IF NOT EXISTS uq_summarize_queue_user_video ON summarize_queue(user_id, video_id)`,
  // playlist_summaries: one row per (user, playlist).
  `DROP INDEX IF EXISTS uq_playlist_summary`,
  `CREATE UNIQUE INDEX IF NOT EXISTS uq_playlist_summary_user ON playlist_summaries(user_id, playlist_id)`,

  // -- 6b. user-prefixed hot-path indexes -------------------------------------------
  ...scopedIndex('channels', 'idx_channels_title', 'user_id, title'),
  ...scopedIndex('channels', 'idx_channels_handle', 'user_id, handle'),
  ...scopedIndex('channels', 'idx_channels_music_flag', 'user_id, music_flag'),
  ...scopedIndex('channels', 'idx_channels_subscriber', 'user_id, COALESCE(subscriber_count, 0)'),
  ...scopedIndex('videos', 'idx_videos_channel', 'user_id, channel_id, published_at DESC'),
  ...scopedIndex('videos', 'idx_videos_status', 'user_id, transcript_status'),
  ...scopedIndex('summaries', 'idx_summaries_video', 'user_id, video_id, created_at DESC'),
  ...scopedIndex('summaries', 'idx_summaries_bookmarked', 'user_id, bookmarked, created_at DESC'),
  ...scopedIndex('chat_messages', 'idx_chat_video', 'user_id, video_id, created_at'),
  ...scopedIndex('transcript_chunks', 'idx_chunks_video', 'user_id, video_id, chunk_index'),
  ...scopedIndex('transcript_chunks', 'idx_chunks_video_type', 'user_id, video_id, chunk_type'),
  ...scopedIndex('library_chat_messages', 'idx_library_chat_scope', 'user_id, scope, created_at'),
  ...scopedIndex('queue_pins', 'idx_queue_pins_queue_pos', 'user_id, queue, position ASC, pinned_at DESC'),
  ...scopedIndex('summarize_queue', 'idx_summarize_queue_state', 'user_id, state, queued_at DESC'),
  ...scopedIndex('video_states', 'idx_video_states_state', 'user_id, state, updated_at DESC'),
  ...scopedIndex('video_likes', 'idx_video_likes_liked_at', 'user_id, liked_at DESC'),
  ...scopedIndex('video_play_history', 'idx_video_history_last_played', 'user_id, last_played_at DESC'),
  ...scopedIndex('sync_runs', 'idx_sync_runs_started', 'user_id, started_at DESC'),
  ...scopedIndex('digests', 'idx_digests_created', 'user_id, created_at DESC'),
  ...scopedIndex('channel_playlists', 'idx_channel_playlists_channel', 'user_id, channel_id, title'),
  ...scopedIndex('playlist_videos', 'idx_playlist_videos_position', 'user_id, playlist_id, position'),
  ...scopedIndex('video_references', 'idx_video_refs_source', 'user_id, source_video_id'),
  ...scopedIndex('video_references', 'idx_video_refs_target_video', 'user_id, target_video_id'),
  ...scopedIndex('video_references', 'idx_video_refs_target_channel', 'user_id, target_channel_id'),
  ...scopedIndex('video_comments', 'idx_video_comments_updated', 'user_id, updated_at DESC'),
  ...scopedIndex('video_chapters', 'idx_video_chapters_created', 'user_id, created_at DESC'),
  ...scopedIndex('folders', 'idx_folders_position', 'user_id, position, name'),
  ...scopedIndex('channel_folders', 'idx_channel_folders_folder', 'user_id, folder_id'),
  ...scopedIndex('channel_tags', 'idx_channel_tags_tag', 'user_id, tag_id'),
  // transcript_segments: the composite PK (user_id, video_id, seg_index)
  // fully covers the old idx_tsegs_video — just drop it.
  `DROP INDEX IF EXISTS idx_tsegs_video`,
];

export const SEED_FOLDERS = ['Watch Later', 'Reference', 'Music'] as const;