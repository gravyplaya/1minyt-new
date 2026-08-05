'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { deleteFolderAction, renameFolderAction } from '@/app/actions';

/**
 * Inline rename + delete controls shown when viewing a specific folder.
 * Appears next to the folder chip in the channel summary bar.
 */
export function FolderActions({
  folderId,
  folderName,
}: {
  folderId: string;
  folderName: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(folderName);

  const submitRename = () => {
    const trimmed = name.trim();
    if (!trimmed || trimmed === folderName) {
      setEditing(false);
      setName(folderName);
      return;
    }
    start(async () => {
      await renameFolderAction(folderId, trimmed);
      setEditing(false);
      router.refresh();
    });
  };

  const handleDelete = () => {
    if (!confirm(`Delete folder "${folderName}"? Channels will remain, just unfiled from this folder.`)) return;
    start(async () => {
      await deleteFolderAction(folderId);
      // Navigate back to All channels — the folder param is now invalid.
      router.push('/');
    });
  };

  if (editing) {
    return (
      <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
        <input
          autoFocus
          className="input"
          value={name}
          onChange={e => setName(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') submitRename();
            if (e.key === 'Escape') {
              setEditing(false);
              setName(folderName);
            }
          }}
          style={{ padding: '2px 8px', fontSize: 12, width: 140 }}
        />
        <button
          type="button"
          className="btn"
          onClick={submitRename}
          disabled={pending}
          style={{ padding: '2px 8px', fontSize: 11 }}
        >
          {pending ? '…' : 'Save'}
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => { setEditing(false); setName(folderName); }}
          style={{ padding: '2px 8px', fontSize: 11 }}
        >
          Cancel
        </button>
      </span>
    );
  }

  return (
    <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
      <button
        type="button"
        className="btn btn-ghost"
        onClick={() => setEditing(true)}
        disabled={pending}
        title="Rename folder"
        style={{ padding: '2px 8px', fontSize: 11 }}
      >
        ✏ Rename
      </button>
      <button
        type="button"
        className="btn btn-ghost"
        onClick={handleDelete}
        disabled={pending}
        title="Delete folder"
        style={{ padding: '2px 8px', fontSize: 11, color: '#ff6363' }}
      >
        🗑 Delete
      </button>
    </span>
  );
}
