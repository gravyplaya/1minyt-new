'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { deleteTagAction, renameTagAction } from '@/app/actions';

/**
 * Inline rename + delete controls shown when viewing a specific tag.
 * Appears next to the tag chip in the channel summary bar.
 */
export function TagActions({
  tagId,
  tagName,
}: {
  tagId: string;
  tagName: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(tagName);

  const submitRename = () => {
    const trimmed = name.trim();
    if (!trimmed || trimmed === tagName) {
      setEditing(false);
      setName(tagName);
      return;
    }
    start(async () => {
      await renameTagAction(tagId, trimmed);
      setEditing(false);
      router.refresh();
    });
  };

  const handleDelete = () => {
    if (!confirm(`Delete tag "#${tagName}"? It will be removed from all channels.`)) return;
    start(async () => {
      await deleteTagAction(tagId);
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
              setName(tagName);
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
          onClick={() => { setEditing(false); setName(tagName); }}
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
        title="Rename tag"
        style={{ padding: '2px 8px', fontSize: 11 }}
      >
        ✏ Rename
      </button>
      <button
        type="button"
        className="btn btn-ghost"
        onClick={handleDelete}
        disabled={pending}
        title="Delete tag"
        style={{ padding: '2px 8px', fontSize: 11, color: '#ff6363' }}
      >
        🗑 Delete
      </button>
    </span>
  );
}
