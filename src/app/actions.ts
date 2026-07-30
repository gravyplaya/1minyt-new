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
import { getVideo, listRecentUploadIds, saveSummary, setTranscript, setTranscriptStatus, saveChatMessage, listChatMessages } from '@/lib/video-repo';
import { fetchTranscript } from '@/lib/transcript';
import { summarizeVideo } from '@/lib/summarize';
import { indexVideo, isIndexed, chunkCount } from '@/lib/vector-store';
import { chatWithVideo } from '@/lib/chat';
import type { ChatCitation, ChatMessage, VideoWithSummary } from '@/lib/types';

export async function triggerSyncAction() {
  const result = await syncSubscriptions();
  revalidatePath('/');
  revalidatePath('/music');
  revalidatePath('/unfiled');
  return result;
}

export async function disconnectAction() {
  clearTokens('me');
  revalidatePath('/');
  redirect('/');
}

export async function toggleHiddenAction(channelId: string, hidden: boolean) {
  setChannelHidden(channelId, hidden);
  revalidatePath(`/c/${channelId}`);
  revalidatePath('/');
}

export async function setMusicFlagAction(channelId: string, flag: 0 | 1 | 2) {
  setChannelMusicFlag(channelId, flag);
  revalidatePath(`/c/${channelId}`);
  revalidatePath('/');
}

export async function setNotesAction(channelId: string, notes: string) {
  setChannelNotes(channelId, notes);
  revalidatePath(`/c/${channelId}`);
}

export async function deleteChannelAction(channelId: string) {
  deleteChannel(channelId);
  revalidatePath('/');
  redirect('/');
}

export async function createFolderAction(name: string, color?: string) {
  const f = createFolder(name, color);
  revalidatePath('/');
  return f;
}

export async function renameFolderAction(id: string, name: string) {
  renameFolder(id, name);
  revalidatePath('/');
}

export async function deleteFolderAction(id: string) {
  deleteFolder(id);
  revalidatePath('/');
}

export async function createTagAction(name: string, color?: string) {
  const t = createTag(name, color);
  revalidatePath('/');
  return t;
}

export async function deleteTagAction(id: string) {
  deleteTag(id);
  revalidatePath('/');
}

export async function setChannelFoldersAction(channelId: string, folderIds: string[]) {
  setChannelFolders(channelId, folderIds);
  revalidatePath(`/c/${channelId}`);
  revalidatePath('/');
}

export async function setChannelTagsAction(channelId: string, tagIds: string[]) {
  setChannelTags(channelId, tagIds);
  revalidatePath(`/c/${channelId}`);
  revalidatePath('/');
}

// ----- TAV-4: 1-Click Instant Summaries -------------------------------------

/**
 * Refresh the recent-uploads list for a channel from YouTube and return the
 * cached video rows (with their latest summaries hydrated). Called by the
 * channel page to populate the Videos panel.
 */
export async function refreshChannelVideosAction(channelId: string): Promise<VideoWithSummary[]> {
  const result = await syncChannelVideos(channelId, 30);
  if (result.errors.length > 0) {
    // Surface sync failures so the client can display them instead of
    // silently returning an empty list.
    throw new Error(result.errors.join('; '));
  }
  // We don't revalidatePath here — the client component owns the optimistic
  // update and calls router.refresh() after this resolves.
  // listVideosByChannel is imported below to avoid a circular import ordering issue.
  const { listVideosByChannel } = await import('@/lib/video-repo');
  return listVideosByChannel(channelId);
}

export interface TranscriptOutcome {
  ok: boolean;
  videoId: string;
  transcript?: string;
  source?: 'timedtext' | 'yt-dlp' | 'cached';
  error?: string;
}

/**
 * Fetch (or return cached) transcript for a video. Stage 1 of the 1-click
 * summarize flow — the UI calls this first so the user sees the transcript
 * immediately, then calls `summarizeVideoAction` separately.
 */
export async function fetchTranscriptAction(videoId: string): Promise<TranscriptOutcome> {
  try {
    const video = getVideo(videoId);
    if (!video) return { ok: false, videoId, error: 'Video not found. Refresh videos first.' };

    // Return cached transcript if we already have one.
    if (video.transcript && video.transcript_status === 'fetched') {
      return { ok: true, videoId, transcript: video.transcript, source: 'cached' };
    }

    const fetched = await fetchTranscript(videoId);
    if (!fetched) {
      setTranscriptStatus(videoId, 'unavailable');
      return { ok: false, videoId, error: 'No captions available for this video.' };
    }
    setTranscript(videoId, fetched.text);
    return { ok: true, videoId, transcript: fetched.text, source: fetched.source };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, videoId, error: msg };
  }
}

export interface SummarizeOutcome {
  ok: boolean;
  videoId: string;
  error?: string;
}

/**
 * Summarize a video using its cached transcript. Stage 2 of the 1-click flow.
 * Call `fetchTranscriptAction` first to ensure the transcript is available.
 * Re-clicking when a cached transcript+summary exist is effectively instant.
 */
export async function summarizeVideoAction(videoId: string): Promise<SummarizeOutcome> {
  try {
    const video = getVideo(videoId);
    if (!video) return { ok: false, videoId, error: 'Video not found. Refresh videos first.' };

    const transcript = video.transcript;
    if (!transcript || video.transcript_status !== 'fetched') {
      return { ok: false, videoId, error: 'Transcript not fetched yet. Fetch transcript first.' };
    }

    const { getChannel } = await import('@/lib/repo');
    const channel = getChannel(video.channel_id);
    const uploads = listRecentUploadIds(video.channel_id, 12).filter(u => u.video_id !== videoId);

    const summary = await summarizeVideo({
      videoId,
      videoTitle: video.title,
      channelTitle: channel?.title ?? video.channel_id,
      transcript,
      recentUploads: uploads,
    });

    saveSummary({
      video_id: videoId,
      model: summary.model,
      tldr: summary.tldr,
      key_points: summary.keyPoints,
      follow_ups: summary.followUps,
      prompt: summary.prompt,
      token_count: summary.tokenCount,
    });

    return { ok: true, videoId };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, videoId, error: msg };
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

/**
 * Index a video's transcript for vector search. Fetches the transcript (reusing
 * the same pipeline as the summarize feature), chunks it, embeds via Venice,
 * and persists to the local SQLite vector store. Re-indexing replaces prior
 * chunks. Called when the user first opens chat on a video.
 */
export async function indexVideoAction(videoId: string): Promise<IndexOutcome> {
  try {
    const video = getVideo(videoId);
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

/** Check whether a video has been indexed for chat. Cheap DB read. */
export async function chatStatusAction(videoId: string): Promise<ChatStatusOutcome> {
  return { indexed: isIndexed(videoId), chunkCount: chunkCount(videoId) };
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

/**
 * Ask a question about a video. Retrieves relevant transcript chunks via RAG,
 * generates an answer grounded in the transcript with timestamp citations,
 * and persists both the question and answer to the chat history.
 */
export async function chatWithVideoAction(videoId: string, question: string): Promise<ChatWithVideoOutcome> {
  try {
    const video = getVideo(videoId);
    if (!video) return { ok: false, videoId, error: 'Video not found. Refresh videos first.' };

    // Auto-index if not already done. The user shouldn't have to think about this.
    if (!isIndexed(videoId)) {
      const idx = await indexVideo(videoId);
      if (!idx.ok) return { ok: false, videoId, error: idx.error ?? 'Failed to index video for chat.' };
    }

    // Load prior conversation history so follow-ups have context.
    const history = listChatMessages(videoId, 20);

    // Save the user's question first so it appears in history immediately.
    saveChatMessage({ video_id: videoId, role: 'user', content: question });

    const result = await chatWithVideo({
      videoId,
      videoTitle: video.title,
      question,
      history,
    });

    // Persist the assistant's answer.
    saveChatMessage({ video_id: videoId, role: 'assistant', content: result.answer });

    // Return the full updated message list for the UI.
    const messages = listChatMessages(videoId, 50);

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

/** Load the chat history for a video (for initial render of the chat panel). */
export async function loadChatHistoryAction(videoId: string): Promise<ChatMessage[]> {
  return listChatMessages(videoId, 50);
}