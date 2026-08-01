'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import {
  createFolder,
  createTag,
  deleteChannel,
  deleteFolder,
  deleteTag,
  renameFolder,
  setChannelFolders,
  setChannelHidden,
  setChannelMusicFlag,
  setChannelNotes,
  setChannelTags,
} from '@/lib/repo';
import { syncSubscriptions } from '@/lib/sync';
import { clearTokens } from '@/lib/tokens';
import { syncChannelVideos } from '@/lib/video-sync';
import { getVideo, listRecentUploadIds, listVideosByChannel, saveSummary, setTranscript, setTranscriptStatus, saveChatMessage, listChatMessages, toggleBookmark, saveChapters, upsertVideoComments, setCommentSummary, getCommunityPulse, upsertVideo, persistVideoReferences, getOutgoingReferences, getIncomingReferences, getMostReferencedVideos } from '@/lib/video-repo';
import { fetchTranscript } from '@/lib/transcript';
import { isWhisperEnabled } from '@/lib/whisper';
import { summarizeVideo, summarizeComments } from '@/lib/summarize';
import { fetchTopComments, searchChannelVideos, fetchChannelPlaylists, fetchPlaylistVideos } from '@/lib/youtube';
import { getValidAccessToken } from '@/lib/tokens';
import { detectChapters } from '@/lib/chapters';
import { indexVideo, isIndexed, chunkCount, searchAcross, getSegments } from '@/lib/vector-store';
import { chatWithVideo } from '@/lib/chat';
import type { Chapter, ChatCitation, ChatMessage, ChannelCatalogHit, CommunityPulse, MostReferencedVideo, PlaylistRow, PlaylistSummary, PlaylistVideoRow, SummaryRow, TranscriptSegment, TranscriptSource, VideoWithSummary, TranscriptSearchResult, VideoReferenceWithTarget } from '@/lib/types';

export async function triggerSyncAction() {
  const result = await syncSubscriptions();
  revalidatePath('/');
  revalidatePath('/music');
  revalidatePath('/unfiled');
  return result;
}

export async function disconnectAction() {
  await clearTokens('me');
  revalidatePath('/');
  redirect('/');
}

export async function toggleHiddenAction(channelId: string, hidden: boolean) {
  await setChannelHidden(channelId, hidden);
  revalidatePath(`/c/${channelId}`);
  revalidatePath('/');
}

export async function setMusicFlagAction(channelId: string, flag: 0 | 1 | 2) {
  await setChannelMusicFlag(channelId, flag);
  revalidatePath(`/c/${channelId}`);
  revalidatePath('/');
}

export async function setNotesAction(channelId: string, notes: string) {
  await setChannelNotes(channelId, notes);
  revalidatePath(`/c/${channelId}`);
}

export async function deleteChannelAction(channelId: string) {
  await deleteChannel(channelId);
  revalidatePath('/');
  redirect('/');
}

export async function createFolderAction(name: string, color?: string) {
  const f = await createFolder(name, color);
  revalidatePath('/');
  return f;
}

export async function renameFolderAction(id: string, name: string) {
  await renameFolder(id, name);
  revalidatePath('/');
}

export async function deleteFolderAction(id: string) {
  await deleteFolder(id);
  revalidatePath('/');
}

export async function createTagAction(name: string, color?: string) {
  const t = await createTag(name, color);
  revalidatePath('/');
  return t;
}

export async function deleteTagAction(id: string) {
  await deleteTag(id);
  revalidatePath('/');
}

export async function setChannelFoldersAction(channelId: string, folderIds: string[]) {
  await setChannelFolders(channelId, folderIds);
  revalidatePath(`/c/${channelId}`);
  revalidatePath('/');
}

export async function setChannelTagsAction(channelId: string, tagIds: string[]) {
  await setChannelTags(channelId, tagIds);
  revalidatePath(`/c/${channelId}`);
  revalidatePath('/');
}

// ----- TAV-4: 1-Click Instant Summaries -------------------------------------

export async function refreshChannelVideosAction(channelId: string, max = 30): Promise<VideoWithSummary[]> {
  const result = await syncChannelVideos(channelId, max);
  if (result.errors.length > 0) {
    throw new Error(result.errors.join('; '));
  }
  const { listVideosByChannel } = await import('@/lib/video-repo');
  return listVideosByChannel(channelId, max);
}

export interface TranscriptOutcome {
  ok: boolean;
  videoId: string;
  transcript?: string;
  /** The fetch method used this run: timedtext / yt-dlp (YouTube captions) or whisper. */
  source?: 'timedtext' | 'yt-dlp' | 'whisper' | 'cached';
  /** TAV-19: persisted origin of the transcript — 'youtube' or 'whisper'. Null when uncaptioned/unavailable. */
  transcriptSource?: TranscriptSource | null;
  /** TAV-19: whether a Whisper fallback was attempted but produced nothing. */
  whisperAttempted?: boolean;
  error?: string;
}

export async function fetchTranscriptAction(videoId: string): Promise<TranscriptOutcome> {
  try {
    const video = await getVideo(videoId);
    if (!video) return { ok: false, videoId, error: 'Video not found. Refresh videos first.' };

    // Return cached transcript if we already have one.
    if (video.transcript && video.transcript_status === 'fetched') {
      return { ok: true, videoId, transcript: video.transcript, source: 'cached', transcriptSource: video.transcript_source };
    }

    const fetched = await fetchTranscript(videoId);
    if (!fetched) {
      await setTranscriptStatus(videoId, 'unavailable');
      const whisperAttempted = isWhisperEnabled();
      return {
        ok: false,
        videoId,
        whisperAttempted,
        transcriptSource: null,
        error: whisperAttempted
          ? 'No captions available and Whisper transcription produced no text.'
          : 'No captions available for this video.',
      };
    }
    // Map the fetch source to the persisted transcript source:
    // timedtext + yt-dlp → 'youtube'; whisper → 'whisper'.
    const source: TranscriptSource = fetched.source === 'whisper' ? 'whisper' : 'youtube';
    await setTranscript(videoId, fetched.text, source);
    return { ok: true, videoId, transcript: fetched.text, source: fetched.source, transcriptSource: source };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, videoId, error: msg };
  }
}

export interface SummarizeOutcome {
  ok: boolean;
  videoId: string;
  summary?: SummaryRow;
  /** TAV-13: chapters detected alongside the summary (null if detection was skipped). */
  chapters?: Chapter[];
  /** TAV-20: Community Pulse — top comments + summary, or null if unavailable. */
  communityPulse?: CommunityPulse | null;
  error?: string;
}

export async function summarizeVideoAction(videoId: string): Promise<SummarizeOutcome> {
  try {
    const video = await getVideo(videoId);
    if (!video) return { ok: false, videoId, error: 'Video not found. Refresh videos first.' };

    const transcript = video.transcript;
    if (!transcript || video.transcript_status !== 'fetched') {
      return { ok: false, videoId, error: 'Transcript not fetched yet. Fetch transcript first.' };
    }

    const { getChannel } = await import('@/lib/repo');
    const channel = await getChannel(video.channel_id);
    const uploads = (await listRecentUploadIds(video.channel_id, 12)).filter(u => u.video_id !== videoId);

    const summary = await summarizeVideo({
      videoId,
      videoTitle: video.title,
      channelTitle: channel?.title ?? video.channel_id,
      transcript,
      recentUploads: uploads,
    });

    const saved = await saveSummary({
      video_id: videoId,
      model: summary.model,
      tldr: summary.tldr,
      key_points: summary.keyPoints,
      follow_ups: summary.followUps,
      topics: summary.topics,
      prompt: summary.prompt,
      token_count: summary.tokenCount,
    });

    // TAV-29: persist the summary's follow-ups as reference-graph edges so we
    // can build a cross-video citation graph over time. Non-fatal — a failure
    // here must not invalidate the summary.
    try {
      await persistVideoReferences(videoId, summary.followUps);
    } catch (err) {
      console.error('Video reference persistence failed (non-fatal):', err instanceof Error ? err.message : err);
    }

    // TAV-13: auto-detect chapters alongside the summary. Failures here must
    // not invalidate the summary — chapters are a best-effort enhancement.
    let chapters: Chapter[] | undefined;
    try {
      const segments = await getSegments(videoId);
      if (segments.length === 0) {
        // Re-fetch transcript segments if they haven't been persisted yet.
        const fetched = await fetchTranscript(videoId);
        if (fetched?.segments && fetched.segments.length > 0) {
          const { saveSegments } = await import('@/lib/vector-store');
          await saveSegments(videoId, fetched.segments);
          chapters = await runChapterDetection(videoId, video.title, fetched.segments);
        }
      } else {
        chapters = await runChapterDetection(videoId, video.title, segments);
      }
    } catch (err) {
      console.error('Chapter detection failed (non-fatal):', err instanceof Error ? err.message : err);
    }

    // TAV-20: Community Pulse — fetch top comments and summarize them alongside
    // the transcript. Failures are non-fatal: no OAuth token, comments disabled,
    // or LLM error all degrade to "no community pulse" rather than failing the run.
    const communityPulse = await runCommunityPulse(videoId, video.title, saved.tldr);

    revalidatePath(`/c/${video.channel_id}`);

    return { ok: true, videoId, summary: saved, chapters, communityPulse };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, videoId, error: msg };
  }
}

/**
 * TAV-20: Fetch top comments via `commentThreads.list`, persist them, then
 * generate an LLM "Community Pulse" summary and persist that. Returns the full
 * community pulse row, or null when comments are unavailable/disabled.
 */
async function runCommunityPulse(
  videoId: string,
  videoTitle: string,
  transcriptTldr: string,
): Promise<CommunityPulse | null> {
  try {
    const accessToken = await getValidAccessToken();
    const comments = await fetchTopComments(accessToken, videoId, 20);
    if (comments.length === 0) return null;
    await upsertVideoComments(videoId, comments);

    try {
      const { summary, model } = await summarizeComments({
        videoId,
        videoTitle,
        transcriptTldr,
        comments: comments.map(c => ({ author: c.author, text: c.text, like_count: c.like_count })),
      });
      await setCommentSummary(videoId, summary, model);
    } catch (err) {
      // Comments were fetched and stored; the summary failed. Return what we have.
      console.error('Community Pulse summary failed (non-fatal):', err instanceof Error ? err.message : err);
    }
    return getCommunityPulse(videoId);
  } catch (err) {
    console.error('Community Pulse fetch failed (non-fatal):', err instanceof Error ? err.message : err);
    return null;
  }
}

/** Shared helper: call the LLM chapter detector and persist the result. */
async function runChapterDetection(
  videoId: string,
  videoTitle: string,
  segments: TranscriptSegment[],
): Promise<Chapter[] | undefined> {
  const result = await detectChapters({ videoId, videoTitle, segments });
  if (result.chapters.length > 0) {
    await saveChapters({
      video_id: videoId,
      chapters: result.chapters,
      model: result.model,
      token_count: result.tokenCount,
    });
    return result.chapters;
  }
  return undefined;
}

// ----- TAV-13: Standalone chapter detection -----------------------------------

export interface ChaptersOutcome {
  ok: boolean;
  videoId: string;
  chapters?: Chapter[];
  error?: string;
}

/** Detect chapters for a video that already has a transcript. Standalone entry
 *  point for a future "Detect chapters" button or for re-running detection. */
export async function detectChaptersAction(videoId: string): Promise<ChaptersOutcome> {
  try {
    const video = await getVideo(videoId);
    if (!video) return { ok: false, videoId, error: 'Video not found. Refresh videos first.' };

    let segments = await getSegments(videoId);
    if (segments.length === 0) {
      const fetched = await fetchTranscript(videoId);
      if (!fetched || !fetched.segments || fetched.segments.length === 0) {
        return { ok: false, videoId, error: 'No transcript segments available for this video.' };
      }
      const { saveSegments } = await import('@/lib/vector-store');
      await saveSegments(videoId, fetched.segments);
      segments = fetched.segments;
    }

    const result = await detectChapters({ videoId, videoTitle: video.title, segments });
    await saveChapters({
      video_id: videoId,
      chapters: result.chapters,
      model: result.model,
      token_count: result.tokenCount,
    });

    revalidatePath(`/c/${video.channel_id}`);

    return { ok: true, videoId, chapters: result.chapters };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, videoId, error: msg };
  }
}

// ----- TAV-9: Batch summarize ------------------------------------------------

export async function getUnsummarizedVideosAction(channelId: string): Promise<VideoWithSummary[]> {
  const all = await listVideosByChannel(channelId, 30);
  // Skip videos that already have a summary or whose transcripts are unavailable.
  return all.filter(v => !v.summary && v.transcript_status !== 'unavailable');
}

// ----- TAV-12: Saved / bookmarked summaries ----------------------------------

export interface BookmarkOutcome {
  ok: boolean;
  videoId: string;
  /** New bookmark state: 1 = bookmarked, 0 = not. null when there is no summary. */
  bookmarked: 0 | 1 | null;
  error?: string;
}

export async function toggleBookmarkAction(videoId: string): Promise<BookmarkOutcome> {
  try {
    const next = await toggleBookmark(videoId);
    if (next === null) {
      return { ok: false, videoId, bookmarked: null, error: 'No summary to bookmark yet.' };
    }
    // Revalidate the saved page and the channel page so both reflect the change.
    revalidatePath('/saved');
    revalidatePath(`/c/${(await getVideo(videoId))?.channel_id ?? ''}`);
    return { ok: true, videoId, bookmarked: next };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, videoId, bookmarked: null, error: msg };
  }
}

// ----- TAV-5: Chat with Video (RAG over transcripts) -------------------------

export interface IndexOutcome {
  ok: boolean;
  videoId: string;
  chunkCount: number;
  embedModel: string;
  error?: string;
}

export async function indexVideoAction(videoId: string): Promise<IndexOutcome> {
  try {
    const video = await getVideo(videoId);
    if (!video) return { ok: false, videoId, chunkCount: 0, embedModel: '', error: 'Video not found. Refresh videos first.' };
    const result = await indexVideo(videoId);
    return result;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, videoId, chunkCount: 0, embedModel: '', error: msg };
  }
}

export interface ChatStatusOutcome {
  indexed: boolean;
  chunkCount: number;
}

export async function chatStatusAction(videoId: string): Promise<ChatStatusOutcome> {
  const [indexed, count] = await Promise.all([
    isIndexed(videoId),
    chunkCount(videoId),
  ]);
  return { indexed, chunkCount: count };
}

export interface ChatWithVideoOutcome {
  ok: boolean;
  videoId: string;
  answer?: string;
  citations?: ChatCitation[];
  model?: string;
  messages?: ChatMessage[];
  error?: string;
}

export async function chatWithVideoAction(videoId: string, question: string): Promise<ChatWithVideoOutcome> {
  try {
    const video = await getVideo(videoId);
    if (!video) return { ok: false, videoId, error: 'Video not found. Refresh videos first.' };

    // Auto-index if not already done.
    if (!(await isIndexed(videoId))) {
      const idx = await indexVideo(videoId);
      if (!idx.ok) return { ok: false, videoId, error: idx.error ?? 'Failed to index video for chat.' };
    }

    // Load prior conversation history so follow-ups have context.
    const history = await listChatMessages(videoId, 20);

    // Save the user's question first so it appears in history immediately.
    await saveChatMessage({ video_id: videoId, role: 'user', content: question });

    const result = await chatWithVideo({
      videoId,
      videoTitle: video.title,
      question,
      history,
    });

    // Persist the assistant's answer.
    await saveChatMessage({ video_id: videoId, role: 'assistant', content: result.answer });

    // Return the full updated message list for the UI.
    const messages = await listChatMessages(videoId, 50);

    return {
      ok: true,
      videoId,
      answer: result.answer,
      citations: result.citations,
      model: result.model,
      messages,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, videoId, error: msg };
  }
}

export async function loadChatHistoryAction(videoId: string): Promise<ChatMessage[]> {
  return listChatMessages(videoId, 50);
}

// ----- TAV-21: Transcript segments for embedded player -----------------------

export async function getSegmentsAction(videoId: string): Promise<TranscriptSegment[]> {
  try {
    const segments = await getSegments(videoId);
    if (segments.length > 0) return segments;
    // Segments not persisted yet — fetch transcript (caches segments as a side effect).
    const fetched = await fetchTranscript(videoId);
    if (fetched?.segments && fetched.segments.length > 0) {
      const { saveSegments } = await import('@/lib/vector-store');
      await saveSegments(videoId, fetched.segments);
      return fetched.segments;
    }
    return [];
  } catch {
    return [];
  }
}

// ----- TAV-10: Cross-video transcript search ---------------------------------

export async function searchTranscriptsAction(query: string): Promise<TranscriptSearchResult[]> {
  const q = query.trim();
  if (!q) return [];
  return searchAcross(q, 20);
}

// ----- TAV-25: Channel back-catalog search ------------------------------------

export interface ChannelCatalogSearchOutcome {
  ok: boolean;
  channelId: string;
  /** Back-catalog hits from YouTube `search.list`. */
  catalog: ChannelCatalogHit[];
  /** Transcript-segment matches from the local index, filtered to this channel. */
  transcripts: TranscriptSearchResult[];
  error?: string;
}

/**
 * Search a single channel's entire upload history via YouTube `search.list`,
 * combined with the local transcript index (TAV-10) filtered to that channel.
 * The catalog hits reach videos we never cached locally; the transcript matches
 * cover the subset we've indexed. Returning both lets the UI present
 * "what this channel has published" alongside "what they actually said."
 *
 * `publishedAfter` is an ISO-8601 string (e.g. `2023-01-01T00:00:00Z`) used to
 * narrow the catalog search. Pass null/undefined to search the full history.
 */
export async function searchChannelCatalogAction(
  channelId: string,
  query: string,
  publishedAfter?: string | null,
): Promise<ChannelCatalogSearchOutcome> {
  const q = query.trim();
  if (!q) return { ok: true, channelId, catalog: [], transcripts: [] };
  try {
    const accessToken = await getValidAccessToken();

    // Catalog: full back-catalog search via the YouTube Data API.
    const raw = await searchChannelVideos(accessToken, channelId, q, 25, publishedAfter ?? null);
    const catalog: ChannelCatalogHit[] = raw.map(h => ({
      videoId: h.videoId,
      title: h.title,
      description: h.description,
      thumbnailUrl: h.thumbnailUrl,
      publishedAt: h.publishedAt,
      channelId: h.channelId,
    }));

    // Transcripts: reuse the existing cross-video index, scoped to this channel
    // so the cosine scoring only runs over this channel's chunks (not every
    // channel's), then keep the top 20.
    const transcripts = await searchAcross(q, 20, channelId);

    return { ok: true, channelId, catalog, transcripts };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, channelId, catalog: [], transcripts: [], error: msg };
  }
}

/**
 * Summarize a video discovered via back-catalog search. The video may not be
 * cached locally yet, so we first upsert a baseline `videos` row from the
 * search hit (so `fetchTranscriptAction` can find it), then run the standard
 * 2-stage fetch-transcript + summarize pipeline.
 */
export async function summarizeFromCatalogHitAction(
  hit: ChannelCatalogHit,
): Promise<SummarizeOutcome> {
  try {
    // Ensure the video row exists before the transcript fetch looks it up.
    await upsertVideo({
      video_id: hit.videoId,
      channel_id: hit.channelId,
      title: hit.title || '(untitled)',
      description: hit.description,
      thumbnail_url: hit.thumbnailUrl,
      duration_seconds: null,
      published_at: hit.publishedAt,
      view_count: null,
      like_count: null,
      comment_count: null,
      favorite_count: null,
      tags: null,
      category_id: null,
      is_live: 0,
      live_streaming_details: null,
    });

    const t = await fetchTranscriptAction(hit.videoId);
    if (!t.ok) {
      return { ok: false, videoId: hit.videoId, error: t.error ?? 'Failed to fetch transcript.' };
    }
    const s = await summarizeVideoAction(hit.videoId);
    revalidatePath(`/c/${hit.channelId}`);
    return s;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, videoId: hit.videoId, error: msg };
  }
}

// ----- TAV-11: Export summaries (Markdown / JSON) ----------------------------

export interface ExportOutcome {
  ok: boolean;
  content: string;
  ext: string;
  mimeType: string;
  filenameBase: string;
  error?: string;
}

export async function exportSummariesAction(
  channelId: string,
  format: 'markdown' | 'json',
): Promise<ExportOutcome> {
  try {
    const { exportChannelSummaries } = await import('@/lib/export');
    const result = await exportChannelSummaries(channelId, format);
    return { ok: true, ...result };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, content: '', ext: '', mimeType: '', filenameBase: '', error: msg };
  }
}

export async function exportAllSummariesAction(
  format: 'markdown' | 'json',
): Promise<ExportOutcome> {
  try {
    const { exportAllSummaries } = await import('@/lib/export');
    const result = await exportAllSummaries(format);
    return { ok: true, ...result };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, content: '', ext: '', mimeType: '', filenameBase: '', error: msg };
  }
}

// ----- TAV-14: New-video digests ----------------------------------------------

export interface DigestOutcome {
  ok: boolean;
  digestId?: string;
  videoCount?: number;
  channelCount?: number;
  errors?: string[];
  error?: string;
}

export async function generateDigestAction(): Promise<DigestOutcome> {
  try {
    const { generateDigest } = await import('@/lib/digest');
    const { digest, errors } = await generateDigest();
    revalidatePath('/digests');
    return {
      ok: true,
      digestId: digest.id,
      videoCount: digest.video_count,
      channelCount: digest.channel_count,
      errors,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg };
  }
}

// ----- TAV-22: Unified inbox / triage view -----------------------------------

export interface InboxTriageOutcome {
  ok: boolean;
  videoId: string;
  state: 'seen' | 'saved' | null;
  error?: string;
}

/** Mark a video as seen (dismissed from the inbox feed). */
export async function dismissVideoAction(videoId: string): Promise<InboxTriageOutcome> {
  try {
    const { setVideoState } = await import('@/lib/inbox');
    await setVideoState(videoId, 'seen');
    revalidatePath('/inbox');
    return { ok: true, videoId, state: 'seen' };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, videoId, state: null, error: msg };
  }
}

/** Bookmark a video from the inbox (save for later). */
export async function saveVideoAction(videoId: string): Promise<InboxTriageOutcome> {
  try {
    const { setVideoState } = await import('@/lib/inbox');
    await setVideoState(videoId, 'saved');
    revalidatePath('/inbox');
    return { ok: true, videoId, state: 'saved' };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, videoId, state: null, error: msg };
  }
}

/** Remove a video's triage state (return it to the 'new' feed). */
export async function untriageVideoAction(videoId: string): Promise<InboxTriageOutcome> {
  try {
    const { setVideoState } = await import('@/lib/inbox');
    await setVideoState(videoId, null);
    revalidatePath('/inbox');
    return { ok: true, videoId, state: null };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, videoId, state: null, error: msg };
  }
}

/**
 * Summarize a video directly from the inbox. Delegates to the existing
 * fetchTranscript + summarize pipeline so the result lands in the same
 * `summaries` table the rest of the app reads from.
 */
export async function inboxSummarizeAction(videoId: string): Promise<SummarizeOutcome> {
  // Stage 1: ensure the transcript is fetched.
  const t = await fetchTranscriptAction(videoId);
  if (!t.ok) {
    return { ok: false, videoId, error: t.error ?? 'Failed to fetch transcript.' };
  }
  // Stage 2: summarize (also detects chapters + community pulse).
  return summarizeVideoAction(videoId);
}

// ----- TAV-23: Summarize Later queue ------------------------------------------

export interface QueueOutcome {
  ok: boolean;
  videoId: string;
  /** Whether the video is now in the queue (true) or was removed (false). */
  queued: boolean;
  error?: string;
}

/**
 * Add a video to the Summarize Later queue. Idempotent: re-adding a video
 * that's already queued (even if 'summarized') resets it to 'queued'.
 */
export async function addToQueueAction(videoId: string): Promise<QueueOutcome> {
  try {
    const { enqueueForSummary } = await import('@/lib/summarize-queue');
    await enqueueForSummary(videoId);
    revalidatePath('/summarize-later');
    return { ok: true, videoId, queued: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, videoId, queued: false, error: msg };
  }
}

/**
 * Remove a video from the Summarize Later queue entirely.
 */
export async function removeFromQueueAction(videoId: string): Promise<QueueOutcome> {
  try {
    const { removeFromQueue } = await import('@/lib/summarize-queue');
    await removeFromQueue(videoId);
    revalidatePath('/summarize-later');
    return { ok: true, videoId, queued: false };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, videoId, queued: true, error: msg };
  }
}

export interface BatchQueueSummarizeOutcome {
  ok: boolean;
  /** How many videos were successfully summarized. */
  completed: number;
  /** How many were in the queue when the batch started. */
  total: number;
  /** Per-video errors (videoId → message). Non-fatal failures. */
  errors: { videoId: string; title: string; error: string }[];
  error?: string;
}

/**
 * Batch-summarize all queued videos. Runs the 2-stage fetch+summarize
 * pipeline for each video sequentially, marking each as 'summarized' on
 * success. Individual failures are collected and do not abort the batch —
 * the batch continues to the next video. Returns a summary of what happened.
 */
export async function batchSummarizeQueueAction(): Promise<BatchQueueSummarizeOutcome> {
  try {
    const { listQueuedVideoIds, markQueueItemSummarized } = await import('@/lib/summarize-queue');
    const { getVideo } = await import('@/lib/video-repo');
    const videoIds = await listQueuedVideoIds();
    if (videoIds.length === 0) {
      return { ok: true, completed: 0, total: 0, errors: [] };
    }

    let completed = 0;
    const errors: { videoId: string; title: string; error: string }[] = [];

    for (const videoId of videoIds) {
      try {
        // Stage 1: fetch transcript (skips if cached).
        const t = await fetchTranscriptAction(videoId);
        if (!t.ok) {
          const v = await getVideo(videoId);
          errors.push({ videoId, title: v?.title ?? videoId, error: t.error ?? 'Transcript fetch failed.' });
          continue;
        }
        // Stage 2: summarize.
        const s = await summarizeVideoAction(videoId);
        if (!s.ok) {
          const v = await getVideo(videoId);
          errors.push({ videoId, title: v?.title ?? videoId, error: s.error ?? 'Summarization failed.' });
          continue;
        }
        await markQueueItemSummarized(videoId);
        completed += 1;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const v = await getVideo(videoId);
        errors.push({ videoId, title: v?.title ?? videoId, error: msg });
      }
    }

    revalidatePath('/summarize-later');
    return { ok: true, completed, total: videoIds.length, errors };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, completed: 0, total: 0, errors: [], error: msg };
  }
}

/**
 * Fetch the current Summarize Later queue items, optionally filtered by
 * state. Server component pages call this directly; this action wrapper is
 * for any client component that needs to refresh the list after an action.
 */
export async function listQueueAction(
  state?: 'queued' | 'summarized',
): Promise<import('@/lib/types').SummarizeQueueItem[]> {
  const { listQueueItems } = await import('@/lib/summarize-queue');
  return listQueueItems(state);
}

// ----- TAV-29: Video reference graph — cross-video citations ------------------

/** Outgoing + incoming references for a video, for the video detail UI. */
export interface VideoReferencesResult {
  ok: boolean;
  videoId: string;
  /** Videos this video's summary cites (outgoing edges). */
  outgoing: VideoReferenceWithTarget[];
  /** Videos whose summaries cite this video (incoming edges). */
  incoming: VideoReferenceWithTarget[];
  error?: string;
}

export async function getVideoReferencesAction(videoId: string): Promise<VideoReferencesResult> {
  try {
    const [outgoing, incoming] = await Promise.all([
      getOutgoingReferences(videoId),
      getIncomingReferences(videoId),
    ]);
    return { ok: true, videoId, outgoing, incoming };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, videoId, outgoing: [], incoming: [], error: msg };
  }
}

export async function getMostReferencedVideosAction(limit = 10): Promise<MostReferencedVideo[]> {
  try {
    return await getMostReferencedVideos(limit);
  } catch (err) {
    console.error('getMostReferencedVideos failed (non-fatal):', err instanceof Error ? err.message : err);
    return [];
  }
}


// ----- TAV-26: Curated channel playlists ---------------------------------------

export interface FetchPlaylistsOutcome {
  ok: boolean;
  channelId: string;
  playlists: PlaylistRow[];
  error?: string;
}

/**
 * Fetch a channel's public curated playlists via `playlists.list`, persist them,
 * and return the cached rows for display. Replaces the whole cached set so
 * playlists deleted on YouTube don't linger.
 */
export async function fetchChannelPlaylistsAction(channelId: string): Promise<FetchPlaylistsOutcome> {
  try {
    const accessToken = await getValidAccessToken();
    const raw = await fetchChannelPlaylists(accessToken, channelId, 50);
    const { upsertChannelPlaylists, listChannelPlaylists } = await import('@/lib/playlist-repo');
    await upsertChannelPlaylists(channelId, raw);
    const playlists = await listChannelPlaylists(channelId);
    revalidatePath(`/c/${channelId}`);
    return { ok: true, channelId, playlists };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, channelId, playlists: [], error: msg };
  }
}

/**
 * Fetch the videos in a single playlist via `playlistItems.list`, persist them,
 * and return the hydrated rows for display. Also upserts baseline `videos` rows
 * so the summarize pipeline can find each video.
 */
export async function fetchPlaylistVideosAction(playlistId: string): Promise<{
  ok: boolean;
  playlistId: string;
  videos: PlaylistVideoRow[];
  error?: string;
}> {
  try {
    const accessToken = await getValidAccessToken();
    const raw = await fetchPlaylistVideos(accessToken, playlistId, 100);
    const { upsertPlaylistVideos, listPlaylistVideos } = await import('@/lib/playlist-repo');
    await upsertPlaylistVideos(playlistId, raw);

    // Upsert baseline `videos` rows so the summarize pipeline can find each
    // video (matches the catalog-hit upsert pattern in summarizeFromCatalogHit).
    const { getPlaylist } = await import('@/lib/playlist-repo');
    const playlist = await getPlaylist(playlistId);
    const channelId = playlist?.channel_id ?? '';
    for (const v of raw) {
      await upsertVideo({
        video_id: v.video_id,
        channel_id: channelId,
        title: v.title || '(untitled)',
        description: v.description,
        thumbnail_url: v.thumbnail_url,
        duration_seconds: null,
        published_at: v.published_at,
        view_count: null,
        like_count: null,
        comment_count: null,
        favorite_count: null,
        tags: null,
        category_id: null,
        is_live: 0,
        live_streaming_details: null,
      });
    }

    const videos = await listPlaylistVideos(playlistId);
    revalidatePath(`/c/${channelId}/playlists/${playlistId}`);
    return { ok: true, playlistId, videos };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, playlistId, videos: [], error: msg };
  }
}

export interface SummarizePlaylistOutcome {
  ok: boolean;
  playlistId: string;
  summary?: PlaylistSummary;
  /** How many of the playlist's videos had a cached summary to synthesize from. */
  summarizedVideoCount?: number;
  error?: string;
}

/**
 * Summarize an entire curated playlist. Gathers the per-video summaries already
 * cached locally and synthesizes them into a single overview. Videos without a
 * cached summary are skipped; if fewer than 2 have summaries, we refuse rather
 * than produce a thin synthesis — the user should summarize individual videos
 * first (or use the batch pipeline).
 */
export async function summarizePlaylistAction(playlistId: string): Promise<SummarizePlaylistOutcome> {
  try {
    const { getPlaylist, listPlaylistVideos, savePlaylistSummary } = await import('@/lib/playlist-repo');
    const playlist = await getPlaylist(playlistId);
    if (!playlist) {
      return { ok: false, playlistId, error: 'Playlist not found. Fetch playlists from the channel page first.' };
    }

    const videos = await listPlaylistVideos(playlistId);
    if (videos.length === 0) {
      return { ok: false, playlistId, error: 'Playlist has no cached videos. Fetch the playlist first.' };
    }

    const { latestSummariesByVideoIds } = await import('@/lib/video-repo');
    const summaryMap = await latestSummariesByVideoIds(videos.map(v => v.video_id));

    // Build the per-video summary inputs, skipping videos without a cached summary.
    const inputs = videos
      .map(v => {
        const s = summaryMap.get(v.video_id);
        if (!s) return null;
        return { video_id: v.video_id, title: v.title, tldr: s.tldr, key_points: s.key_points };
      })
      .filter((x): x is { video_id: string; title: string; tldr: string; key_points: string[] } => x !== null);

    if (inputs.length < 2) {
      return {
        ok: false,
        playlistId,
        summarizedVideoCount: inputs.length,
        error: 'Not enough cached summaries to synthesize. Summarize at least 2 videos in this playlist first.',
      };
    }

    const { summarizePlaylist } = await import('@/lib/summarize');
    const result = await summarizePlaylist({
      playlistTitle: playlist.title,
      channelTitle: playlist.channel_title,
      videoSummaries: inputs,
    });

    const saved = await savePlaylistSummary({
      playlist_id: playlistId,
      model: result.model,
      synthesis: result.synthesis,
      themes: result.themes,
      start_here: result.start_here,
      token_count: result.tokenCount,
    });

    revalidatePath(`/c/${playlist.channel_id}/playlists/${playlistId}`);
    return { ok: true, playlistId, summary: saved, summarizedVideoCount: inputs.length };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, playlistId, error: msg };
  }
}

// ----- TAV-27: Read-later integrations (Readwise / Notion / Obsidian) --------

export interface IntegrationSettingsOutcome {
  ok: boolean;
  key: string;
  /** Whether a token is currently saved for this integration. */
  configured: boolean;
  error?: string;
}

/** Save (or clear, when the token is empty) the settings for one integration. */
export async function saveIntegrationSettingsAction(
  key: 'readwise' | 'notion' | 'obsidian',
  token: string,
  options?: Record<string, string>,
): Promise<IntegrationSettingsOutcome> {
  try {
    const { saveIntegrationSettings } = await import('@/lib/integrations');
    await saveIntegrationSettings(key, token, options);
    revalidatePath('/settings');
    return { ok: true, key, configured: token.trim().length > 0 };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, key, configured: false, error: msg };
  }
}

export interface SendToIntegrationOutcome {
  ok: boolean;
  integration: string;
  videoId: string;
  /** URL of the created document in the target system, when the integration returns one. */
  documentUrl?: string;
  error?: string;
}

/**
 * Send a single bookmarked summary to a read-later integration. Currently only
 * Readwise is implemented; Notion and Obsidian return a clear "not implemented"
 * error so the UI can guide the user toward Readwise.
 */
export async function sendToIntegrationAction(
  integration: 'readwise' | 'notion' | 'obsidian',
  videoId: string,
): Promise<SendToIntegrationOutcome> {
  try {
    const { getIntegrationSettings, buildExportPayload, sendToReadwise, INTEGRATIONS } = await import('@/lib/integrations');
    const { getBookmarkedSummary } = await import('@/lib/video-repo');

    const meta = INTEGRATIONS.find(i => i.key === integration);
    if (!meta || !meta.implemented) {
      return { ok: false, integration, videoId, error: meta ? `${meta.label} integration is not implemented yet.` : 'Unknown integration.' };
    }

    const settings = await getIntegrationSettings(integration);
    if (!settings || !settings.token) {
      return { ok: false, integration, videoId, error: `No ${meta.label} token configured. Add one in Settings.` };
    }

    const item = await getBookmarkedSummary(videoId);
    if (!item) {
      return { ok: false, integration, videoId, error: 'This summary is not bookmarked. Bookmark it first.' };
    }

    const payload = buildExportPayload(item);
    if (integration === 'readwise') {
      const result = await sendToReadwise(payload, settings.token);
      return { ...result, videoId };
    }
    // Unreachable — implemented check above gates this, but TS needs the return.
    return { ok: false, integration, videoId, error: 'Not implemented.' };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, integration, videoId: videoId, error: msg };
  }
}

