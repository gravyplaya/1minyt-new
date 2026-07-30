/**
 * Domain types — these are the shapes the UI and server actions pass around.
 * Keep them flat (no nested objects from joined queries) so we can serialize
 * freely across server/client boundaries.
 */

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
}

// ----- TAV-4: videos + summaries ---------------------------------------------

export type TranscriptStatus = 'pending' | 'fetched' | 'unavailable' | 'error';

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
  created_at: number;
  updated_at: number;
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
  prompt: string;
  token_count: number | null;
  created_at: number;
}

/** What the summary client component receives (video joined with its latest summary). */
export interface VideoWithSummary extends VideoRow {
  summary: SummaryRow | null;
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