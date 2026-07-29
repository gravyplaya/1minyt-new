'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { createFolderAction, createTagAction } from '@/app/actions';

export function AddFolderForm() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [color, setColor] = useState('#5b9eff');
  const router = useRouter();

  if (!open) {
    return (
      <button className="btn btn-ghost" style={{ fontSize: 11, padding: '4px 8px', width: '100%', justifyContent: 'flex-start' }} onClick={() => setOpen(true)}>
        + New folder
      </button>
    );
  }

  return (
    <form
      style={{ display: 'flex', gap: 4, marginTop: 4 }}
      onSubmit={async (e) => {
        e.preventDefault();
        if (!name.trim()) return;
        await createFolderAction(name.trim(), color);
        setName('');
        setOpen(false);
        router.refresh();
      }}
    >
      <input
        autoFocus
        className="input"
        placeholder="Folder name"
        value={name}
        onChange={e => setName(e.target.value)}
        style={{ padding: '4px 8px', fontSize: 12 }}
      />
      <button className="btn" type="submit" style={{ padding: '4px 10px', fontSize: 11 }}>Add</button>
    </form>
  );
}

export function AddTagForm() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const router = useRouter();

  if (!open) {
    return (
      <button className="btn btn-ghost" style={{ fontSize: 11, padding: '4px 8px', width: '100%', justifyContent: 'flex-start' }} onClick={() => setOpen(true)}>
        + New tag
      </button>
    );
  }

  return (
    <form
      style={{ display: 'flex', gap: 4, marginTop: 4 }}
      onSubmit={async (e) => {
        e.preventDefault();
        if (!name.trim()) return;
        await createTagAction(name.trim());
        setName('');
        setOpen(false);
        router.refresh();
      }}
    >
      <input
        autoFocus
        className="input"
        placeholder="tag-name"
        value={name}
        onChange={e => setName(e.target.value)}
        style={{ padding: '4px 8px', fontSize: 12 }}
      />
      <button className="btn" type="submit" style={{ padding: '4px 10px', fontSize: 11 }}>Add</button>
    </form>
  );
}