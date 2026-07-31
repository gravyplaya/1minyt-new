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
import { getVideo, listRecentUploadIds, listVideosByChannel, saveSummary, setTranscript, setTranscriptStatus, saveChatMessage, listChatMessages, toggleBookmark, saveChapters } from '@/lib/video-repo';
import { fetchTranscript } from '@/lib/transcript';
import { summarizeVideo } from '@/lib/summarize';
import { detectChapters } from '@/lib/chapters';
import { indexVideo, isIndexed, chunkCount, searchAcross, getSegments } from '@/lib/vector-store';
import { chatWithVideo } from '@/lib/chat';
import type { Chapter, ChatCitation, ChatMessage, SummaryRow, TranscriptSegment, VideoWithSummary, TranscriptSearchResult } from '@/lib/types';

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
  source?: 'timedtext' | 'yt-dlp' | 'cached';
  error?: string;
}

export async function fetchTranscriptAction(videoId: string): Promise<TranscriptOutcome> {
  try {
    const video = await getVideo(videoId);
    if (!video) return { ok: false, videoId, error: 'Video not found. Refresh videos first.' };

    // Return cached transcript if we already have one.
    if (video.transcript && video.transcript_status === 'fetched') {
      return { ok: true, videoId, transcript: video.transcript, source: 'cached' };
    }

    const fetched = await fetchTranscript(videoId);
    if (!fetched) {
      await setTranscriptStatus(videoId, 'unavailable');
      return { ok: false, videoId, error: 'No captions available for this video.' };
    }
    await setTranscript(videoId, fetched.text);
    return { ok: true, videoId, transcript: fetched.text, source: fetched.source };
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

    revalidatePath(`/c/${video.channel_id}`);

    return { ok: true, videoId, summary: saved, chapters };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, videoId, error: msg };
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

// ----- TAV-10: Cross-video transcript search ---------------------------------

export async function searchTranscriptsAction(query: string): Promise<TranscriptSearchResult[]> {
  const q = query.trim();
  if (!q) return [];
  return searchAcross(q, 20);
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
