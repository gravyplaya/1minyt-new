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