/**
 * Domain types — these are the shapes the UI and server actions pass around.
 * Keep them flat (no nested objects from joined queries) so we can serialize
 * freely across server/client boundaries.
 */

import type { VideoComment as VideoCommentType } from './youtube';

export type MusicFlag = 0 | 1 | 2; // unknown | music | not-music

export interface ChannelRow {
  channel_id: string;
  title: string;
  handle: string | null;
  description: string | null;
  thumbnail_url: string | null;
  subscriber_count: number | null;
  video_count: number | null;
  country: string | null;
  custom_url: string | null;
  music_flag: MusicFlag;
  music_score: number;
  hidden: 0 | 1;
  notes: string | null;
  subscribed_at: number | null;
  synced_at: number;
  created_at: number;
  updated_at: number;
  // TAV-17: persisted-but-previously-discarded API fields.
  /** JSON-encoded array of topicDetails.topicCategories URLs. */
  topic_categories: string | null;
  banner_image_url: string | null;
  /** JSON-encoded brandingSettings.channel.keywords string. */
  branding_keywords: string | null;
}

export interface FolderRow {
  id: string;
  name: string;
  color: string | null;
  position: number;
  created_at: number;
}

export interface TagRow {
  id: string;
  name: string;
  color: string | null;
  created_at: number;
}

export interface ChannelWithRelations extends ChannelRow {
  folder_ids: string[];
  tag_ids: string[];
}

export type ChannelSort =
  | 'recent'
  | 'alpha'
  | 'alpha-desc'
  | 'subscribers'
  | 'videos'
  | 'updated';

export interface ChannelQuery {
  search?: string;
  folderId?: string | null;       // null = all, 'none' = unfiled, otherwise folder id
  tagId?: string | null;           // similar semantics
  includeMusic?: boolean;          // default false — hide music
  onlyMusic?: boolean;             // toggle for the music view
  hidden?: boolean;                // default false — hide soft-hidden
  sort?: ChannelSort;              // default 'alpha'
  dir?: 'asc' | 'desc';            // default 'asc' for alpha, 'desc' for others
  limit?: number;                  // page size for pagination
  offset?: number;                 // row offset for pagination
}

/** Paginated channel result with total count for UI controls. */
export interface PaginatedChannels {
  channels: ChannelWithRelations[];
  total: number;
}

// ----- TAV-4: videos + summaries ---------------------------------------------

export type TranscriptStatus = 'pending' | 'fetched' | 'unavailable' | 'error';

/** TAV-19: origin of a transcript. 'youtube' = captions (Innertube/yt-dlp); 'whisper' = speech-to-text fallback. */
export type TranscriptSource = 'youtube' | 'whisper';

// ----- TAV-13: Chapter detection ---------------------------------------------

/** An AI-detected chapter boundary in a video transcript. */
export interface Chapter {
  title: string;
  startMs: number;
}

export interface VideoRow {
  video_id: string;
  channel_id: string;
  title: string;
  description: string | null;
  thumbnail_url: string | null;
  duration_seconds: number | null;
  published_at: number | null;
  transcript: string | null;
  transcript_status: TranscriptStatus;
  transcript_fetched_at: number | null;
  /** TAV-19: origin of the transcript — 'youtube' (captions) or 'whisper' (speech-to-text). null for pre-TAV-19 rows. */
  transcript_source: TranscriptSource | null;
  created_at: number;
  updated_at: number;
  // TAV-17: persisted-but-previously-discarded API fields.
  view_count: number | null;
  like_count: number | null;
  comment_count: number | null;
  favorite_count: number | null;
  /** JSON-encoded array of snippet.tags. */
  tags: string | null;
  category_id: number | null;
  /** 1 if liveBroadcastContent === 'live', 0 otherwise. */
  is_live: 0 | 1;
  /** JSON-encoded liveStreamingDetails object. */
  live_streaming_details: string | null;
  /**
   * TAV-62: User's per-track music video presentation override — 'video' /
   * 'audio' when set, NULL to trust the heuristic (see music-video-pref.ts).
   */
  video_pref: string | null;
}

export interface FollowUp {
  video_id: string;
  title: string;
  reason: string;
}

export interface SummaryRow {
  id: string;
  video_id: string;
  model: string;
  tldr: string;
  key_points: string[];          // parsed from JSON
  follow_ups: FollowUp[];          // parsed from JSON
  /** 2–5 topic tags; empty array for summaries written before TAV-8. */
  topics: string[];             // parsed from JSON
  prompt: string;
  token_count: number | null;
  created_at: number;
  /** TAV-12: 1 if the user bookmarked this summary, 0 otherwise. */
  bookmarked: 0 | 1;
}

/** What the summary client component receives (video joined with its latest summary). */
export interface VideoWithSummary extends VideoRow {
  summary: SummaryRow | null;
  /** TAV-13: AI-detected chapters, or null when not yet detected. */
  chapters: Chapter[] | null;
  /** TAV-20: Community Pulse — top comments + LLM summary, or null when not yet fetched. */
  community_pulse: CommunityPulse | null;
  /** TAV-41: true if this video is in the user's `video_likes` table. Hydrated
   * server-side by the list queries so the row doesn't need a per-mount
   * `getLikeStateAction` round-trip (was causing ~1 server call per row). */
  liked: boolean;
}

// ----- TAV-20: Community Pulse — top comments + summary ----------------------

export type VideoComment = VideoCommentType;

/** A video's community pulse: fetched top comments and their LLM summary. */
export interface CommunityPulse {
  video_id: string;
  /** Top-level comments by relevance, newest-relevant first. */
  comments: VideoComment[];
  /** LLM-generated summary of what commenters are saying. */
  summary: string | null;
  summary_model: string | null;
  fetched_at: number;
}

// ----- TAV-5: Chat with Video (RAG over transcripts) -------------------------

export interface TranscriptSegment {
  text: string;
  start_ms: number;
  end_ms: number | null;
  seg_index: number;
}

/** A transcript chunk groups adjacent segments for embedding/retrieval. */
export interface TranscriptChunk {
  id: string;
  video_id: string;
  chunk_index: number;
  text: string;
  start_ms: number;
  end_ms: number | null;
}

export type ChatRole = 'user' | 'assistant';

export interface ChatMessage {
  id: string;
  video_id: string;
  role: ChatRole;
  content: string;
  created_at: number;
}

/** A timestamp citation inside a chat answer, linking back to the video. */
export interface ChatCitation {
  start_ms: number;
  end_ms: number | null;
  /** The matching transcript chunk text, for context preview. */
  text: string;
}

export interface ChatAnswerResult {
  answer: string;
  citations: ChatCitation[];
  model: string;
  /** Whether the transcript has been indexed for RAG yet. */
  indexed: boolean;
}

// ----- TAV-10: Cross-video transcript search --------------------------------

/** A single transcript segment match across all indexed videos. */
export interface TranscriptSearchResult {
  videoId: string;
  videoTitle: string;
  channelId: string;
  channelTitle: string;
  chunkText: string;
  startMs: number;
  endMs: number | null;
  score: number;
  /** TAV-30: 'transcript' for a transcript-segment hit, 'summary' for a summary hit. */
  chunkType: 'transcript' | 'summary';
}

// ----- TAV-25: Channel back-catalog search ------------------------------------

/**
 * A unified search result for a single channel, merging the YouTube Data API
 * back-catalog search (`search.list`) with the local transcript index
 * (`searchAcross`, TAV-10). The catalog hits reach the channel's entire upload
 * history — including videos we never cached — while the transcript matches
 * cover the subset we've indexed. Showing both lets the user pick between
 * "search what this channel has ever published" and "search what they actually
 * said."
 */
export interface ChannelCatalogSearchResult {
  /** Back-catalog hits from YouTube `search.list`, relevance-ordered. */
  catalog: ChannelCatalogHit[];
  /** Transcript-segment matches from the local index, filtered to this channel. */
  transcripts: TranscriptSearchResult[];
}

export interface ChannelCatalogHit {
  videoId: string;
  title: string;
  description: string | null;
  thumbnailUrl: string | null;
  /** Unix seconds the video was published. */
  publishedAt: number | null;
  channelId: string;
}

// ----- TAV-14: New-video digests ----------------------------------------------

/** A digest row as stored in the `digests` table. */
export interface DigestRow {
  id: string;
  period_start: number | null;
  period_end: number;
  video_count: number;
  new_video_ids: string[];
  channel_count: number;
  errors: string | null;
  created_at: number;
}

/** A digest joined with the full video + channel details for display. */
export interface DigestWithVideos extends DigestRow {
  /** Hydrated new-video details, sorted by published_at desc. */
  videos: DigestVideoEntry[];
}

export interface DigestVideoEntry {
  video_id: string;
  title: string;
  thumbnail_url: string | null;
  duration_seconds: number | null;
  published_at: number | null;
  channel_id: string;
  channel_title: string;
  /** Whether this video already has at least one summary. */
  has_summary: boolean;
}

// ----- TAV-22: Unified inbox / triage view -----------------------------------

/** Triage state for a video in the inbox. */
export type VideoTriageState = 'seen' | 'saved';

/** Filter scope for the inbox feed. */
export type InboxScope = 'new' | 'saved';

/** A single video in the inbox feed, joined with channel + triage metadata. */
export interface InboxVideo {
  video_id: string;
  title: string;
  thumbnail_url: string | null;
  duration_seconds: number | null;
  published_at: number | null;
  channel_id: string;
  channel_title: string;
  channel_thumbnail_url: string | null;
  view_count: number | null;
  like_count: number | null;
  comment_count: number | null;
  category_id: number | null;
  transcript_status: TranscriptStatus;
  has_summary: boolean;
  /** Computed relevance score (0–1 normalised). Higher = more relevant. */
  relevance_score: number;
  /** Current triage state: null = not yet triaged. */
  triage_state: VideoTriageState | null;
}

/** Filter parameters for the inbox query. */
export interface InboxQuery {
  /** 'new' (default) = untriaged videos; 'saved' = bookmarked videos. */
  scope?: InboxScope;
  /** Filter to a specific channel id. */
  channelId?: string | null;
  /** Filter to a YouTube categoryId (Music=10, Tech=28, etc). */
  categoryId?: number | null;
  /** Only show videos without captions. */
  onlyUncaptioned?: boolean;
  /** Page size. */
  limit?: number;
  /** Row offset for pagination. */
  offset?: number;
}

// ----- TAV-54: Watch queue ---------------------------------------------------

/**
 * A single ranked candidate in the Watch queue (TAV-54). The queue blends
 * seven signals — never-watched, not-completed, topic match, channel affinity,
 * reference graph, freshness, engagement — into a single `score` (0–1
 * normalised against the page max). `reason` is a short human-readable string
 * explaining the top contributing signals, for display under the video title.
 */
export interface WatchQueueItem {
  video_id: string;
  title: string;
  channel_title: string;
  thumbnail_url: string | null;
  duration_seconds: number | null;
  published_at: number | null;
  /** Normalised relevance score (0–1). Higher = more relevant. */
  score: number;
  /** Short string explaining why the video is ranked, e.g. "Never watched · 2 topic matches". */
  reason: string;
  /**
   * TAV-59: Whether this item was explicitly pinned to the top via
   * `queue_pins`. Populated by the build functions which already join
   * `queue_pins`. The `reason` string is display-only and must not be used
   * as a pin-state flag — this boolean is the source of truth for the
   * pin/unpin toggle.
   */
  is_pinned: boolean;
}

// ----- TAV-55: Music queue ---------------------------------------------------

/**
 * A single ranked candidate in the Music queue (TAV-55). Same shape as
 * {@link WatchQueueItem} but without the `reason` field — music queue reasons
 * are simpler ("from channels you listen to often" / "new from this artist")
 * and are derived client-side from the score components. `score` is 0–1
 * normalised against the page max, matching the Watch queue.
 */
export interface MusicQueueItem {
  video_id: string;
  title: string;
  channel_title: string;
  thumbnail_url: string | null;
  duration_seconds: number | null;
  published_at: number | null;
  /** Normalised relevance score (0–1). Higher = more relevant. */
  score: number;
  /**
   * TAV-59: Whether this item was explicitly pinned to the top via
   * `queue_pins`. Populated by the build function which already joins
   * `queue_pins`. Source of truth for the pin/unpin toggle.
   */
  is_pinned: boolean;
  /**
   * TAV-62: How the track presents on /music — 'video' renders the full 16:9
   * player, 'audio' the minimized bar. Precomputed server-side via
   * `computeMusicVideoPresentation` (heuristic + `videos.video_pref` override)
   * so the client never re-implements the heuristic.
   */
  video_pref: MusicVideoPref;
  /** 'override' when the user set `videos.video_pref`, 'heuristic' otherwise. */
  video_pref_source: MusicVideoPrefSource;
}

/**
 * A single track in the browsable Music library (every video from
 * music-flagged channels, not just the ranked queue page). Self-contained —
 * the music view needs no summary/transcript hydration.
 */
export interface MusicLibraryTrack {
  video_id: string;
  title: string;
  channel_title: string;
  thumbnail_url: string | null;
  duration_seconds: number | null;
  published_at: number | null;
  /**
   * Whether the track is marked `seen` (skipped/deferred). The library shows
   * seen tracks — a catalogue, not an inbox — but the artist "Up Next" queue
   * built from a library pick filters them out so skip/defer stick.
   */
  is_seen: boolean;
}

/** Music library tracks grouped under one artist (channel). */
export interface MusicLibraryGroup {
  channel_title: string;
  tracks: MusicLibraryTrack[];
}

// ----- TAV-62: Music track video presentation ---------------------------------

/** How a music track presents on /music: full 16:9 video player or audio bar. */
export type MusicVideoPref = 'video' | 'audio';

/** Whether the presentation came from the user's per-track override or the heuristic. */
export type MusicVideoPrefSource = 'override' | 'heuristic';

// ----- TAV-26: Curated channel playlists -------------------------------------

/** A curated public playlist stored from `playlists.list` (channel detail page). */
export interface PlaylistRow {
  playlist_id: string;
  channel_id: string;
  title: string;
  description: string | null;
  thumbnail_url: string | null;
  item_count: number | null;
  published_at: number | null;
  synced_at: number;
}

/**
 * A single video inside a curated playlist, hydrated from `playlistItems.list`
 * joined with any locally-cached `videos` row (for duration + summary presence).
 */
export interface PlaylistVideoRow {
  video_id: string;
  playlist_id: string;
  title: string;
  description: string | null;
  thumbnail_url: string | null;
  position: number;
  published_at: number | null;
  /** Duration in seconds, from the cached `videos` row; null when not yet enriched. */
  duration_seconds: number | null;
  /** Whether this video has at least one summary cached locally. */
  has_summary: boolean;
}

/** LLM-generated synthesis of an entire curated playlist (TAV-26). */
export interface PlaylistSummary {
  id: string;
  playlist_id: string;
  model: string;
  /** 2-4 paragraph synthesis of what the playlist covers as a whole. */
  synthesis: string;
  /** 3-7 recurring themes across the playlist. */
  themes: string[];
  /** 2-5 recommended starting-point video ids from the playlist. */
  start_here: string[];
  token_count: number | null;
  created_at: number;
}

/** A playlist row joined with its channel, for the playlist detail page header. */
export interface PlaylistWithChannel extends PlaylistRow {
  channel_title: string;
  channel_thumbnail_url: string | null;
}

// ----- TAV-23: Summarize Later queue ------------------------------------------

/** State of a video in the Summarize Later queue. */
export type QueueState = 'queued' | 'summarized';

/** A single video in the Summarize Later queue, joined with video + channel details. */
export interface SummarizeQueueItem {
  id: string;
  video_id: string;
  state: QueueState;
  queued_at: number;
  summarized_at: number | null;
  created_at: number;
  // Hydrated from joins:
  title: string;
  thumbnail_url: string | null;
  duration_seconds: number | null;
  published_at: number | null;
  channel_id: string;
  channel_title: string;
  transcript_status: TranscriptStatus;
  has_summary: boolean;
}

// ----- TAV-29: Video reference graph — cross-video citations ------------------

/** Direction/type of a video reference edge. */
export type ReferenceType = 'video' | 'channel';

/**
 * A directed edge in the video reference graph (TAV-29). When a summary's
 * `follow_ups` cite another video, we persist an edge here so we can build a
 * knowledge graph of cross-video citations over time.
 */
export interface VideoReference {
  id: string;
  source_video_id: string;
  /** Target video id, set when reference_type === 'video'. */
  target_video_id: string | null;
  /** Target channel id, set when reference_type === 'channel'. */
  target_channel_id: string | null;
  reference_type: ReferenceType;
  /** The follow-up reason text from the source video's summary. */
  context: string | null;
  created_at: number;
}

/**
 * A video reference edge hydrated with enough target info to render in the UI
 * without a second round-trip: the target video's title + channel, or the
 * target channel's title.
 */
export interface VideoReferenceWithTarget extends VideoReference {
  /** Target video title (reference_type === 'video' only). */
  target_video_title: string | null;
  /** Target video thumbnail (reference_type === 'video' only). */
  target_video_thumbnail: string | null;
  /** Target channel id for the target video, or the channel reference itself. */
  target_channel_title: string | null;
}

/**
 * An incoming reference edge — another video's summary cited *this* video.
 * Hydrated with the *source* (citing) video's title + channel so the UI can
 * link to the citing video without a second round-trip. Uses `source_*` field
 * names (not `target_*`) so the direction is unambiguous.
 */
export interface IncomingReference extends VideoReference {
  /** Title of the citing (source) video. */
  source_video_title: string | null;
  /** Thumbnail of the citing (source) video. */
  source_video_thumbnail: string | null;
  /** Channel title of the citing (source) video. */
  source_channel_title: string | null;
}

/** A counted reference entry — used by the "most referenced" aggregation. */
export interface MostReferencedVideo {
  video_id: string;
  title: string;
  thumbnail_url: string | null;
  channel_id: string;
  channel_title: string;
  /** How many distinct source videos cite this video. */
  reference_count: number;
}
