/**
 * TAV-68: response types of the app's /api/extension/* surface (TAV-68a).
 *
 * Mirrors src/lib/extension-api.ts on the server — kept in sync by hand (the
 * extension is a separate package and can't import server code).
 */

export type TranscriptStatus = 'none' | 'fetching' | 'fetched' | 'unavailable';

/** GET /api/extension/video — library state for one video. */
export interface VideoStateResponse {
  ok: true;
  saved: boolean;
  video: {
    videoId: string;
    channelId: string;
    title: string;
    thumbnailUrl: string | null;
    durationSeconds: number | null;
    publishedAt: number | null;
    transcriptStatus: TranscriptStatus;
    transcriptSource: 'youtube' | 'whisper' | null;
    isLive: boolean;
  } | null;
  summary: ExtensionSummary | null;
  chapters: { title: string; startMs: number }[] | null;
}

/** POST /api/extension/ingest — same PastedVideoOutcome the paste flow returns. */
export interface IngestResponse {
  ok: boolean;
  videoId?: string;
  channelId?: string;
  alreadySummarized?: boolean;
  transcriptStatus?: TranscriptStatus;
  warning?: string;
  error?: string;
}

/** POST /api/extension/summarize. */
export interface SummarizeResponse {
  ok: boolean;
  videoId?: string;
  cached?: boolean;
  summary?: ExtensionSummary | null;
  chapters?: { title: string; startMs: number }[] | null;
  communityPulse?: { summary: string | null } | null;
  error?: string;
}

/** POST /api/extension/queue. */
export interface QueueResponse {
  ok: boolean;
  videoId?: string;
  queued?: boolean;
  error?: string;
}

/** GET /api/extension/search — TranscriptSearchResult rows from the TAV-10 index. */
export interface SearchResponse {
  ok: true;
  query: string;
  results: {
    videoId: string;
    videoTitle: string;
    channelId: string;
    channelTitle: string;
    chunkText: string;
    startMs: number;
    endMs: number | null;
    score: number;
    chunkType: 'transcript' | 'summary';
  }[];
}

/** GET /api/extension/health. */
export interface HealthResponse {
  ok: true;
  server: string;
}

/** Shared summary shape (camelCase — mapped server-side by extensionSummary). */
export interface ExtensionSummary {
  tldr: string;
  keyPoints: string[];
  topics: string[];
  followUps: { video_id: string; title: string; reason: string }[];
  createdAt: number;
  bookmarked: boolean;
}
