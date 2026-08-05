'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { ChannelWithRelations, FolderRow, TagRow } from '@/lib/types';
import {
  setChannelFoldersAction,
  setChannelTagsAction,
  setMusicFlagAction,
  setNotesAction,
  toggleHiddenAction,
} from '@/app/actions';

const MUSIC_OPTIONS: { value: 0 | 1 | 2; label: string }[] = [
  { value: 1, label: '🎵 Music — hide from main feed' },
  { value: 2, label: '📺 Not music — always show' },
  { value: 0, label: '❔ Unknown — let classifier decide' },
];

export function ChannelEditor({
  channel,
  folders,
  tags,
}: {
  channel: ChannelWithRelations;
  folders: FolderRow[];
  tags: TagRow[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [selectedFolders, setSelectedFolders] = useState<Set<string>>(new Set(channel.folder_ids));
  const [selectedTags, setSelectedTags] = useState<Set<string>>(new Set(channel.tag_ids));
  const [musicFlag, setMusicFlag] = useState<0 | 1 | 2>(channel.music_flag);
  const [hidden, setHidden] = useState(channel.hidden === 1);
  const [notes, setNotes] = useState(channel.notes ?? '');

  const toggleFolder = (id: string) => {
    const next = new Set(selectedFolders);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedFolders(next);
  };
  const toggleTag = (id: string) => {
    const next = new Set(selectedTags);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedTags(next);
  };

  const saveFolders = () => {
    start(async () => {
      await setChannelFoldersAction(channel.channel_id, [...selectedFolders]);
      router.refresh();
    });
  };
  const saveTags = () => {
    start(async () => {
      await setChannelTagsAction(channel.channel_id, [...selectedTags]);
      router.refresh();
    });
  };
  const saveMusic = (next: 0 | 1 | 2) => {
    setMusicFlag(next);
    start(async () => {
      await setMusicFlagAction(channel.channel_id, next);
      router.refresh();
    });
  };
  const saveHidden = (next: boolean) => {
    setHidden(next);
    start(async () => {
      await toggleHiddenAction(channel.channel_id, next);
      router.refresh();
    });
  };
  const saveNotes = () => {
    start(async () => {
      await setNotesAction(channel.channel_id, notes);
      router.refresh();
    });
  };

  const foldersDirty = !sameSet(selectedFolders, new Set(channel.folder_ids));
  const tagsDirty = !sameSet(selectedTags, new Set(channel.tag_ids));

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
      {/* ── Card 1: Folders + Tags ─────────────────────────────────── */}
      <section style={cardStyle}>
        <div style={cardHeaderStyle}>
          <h3 style={cardTitleStyle}>Folders &amp; Tags</h3>
        </div>

        {/* Folders */}
        <div style={{ marginBottom: 16 }}>
          <div style={subHeaderStyle}>
            <span>Folders</span>
            <button
              type="button"
              className="btn btn-primary"
              onClick={saveFolders}
              disabled={!foldersDirty || pending}
              style={saveBtnStyle}
            >
              {pending ? 'Saving…' : 'Save'}
            </button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {folders.length === 0 && <span style={emptyStyle}>No folders yet. Create one from the sidebar.</span>}
            {folders.map(f => (
              <label key={f.id} style={folderRowStyle(selectedFolders.has(f.id))}>
                <input type="checkbox" checked={selectedFolders.has(f.id)} onChange={() => toggleFolder(f.id)} />
                <span style={{ width: 10, height: 10, borderRadius: 5, background: f.color ?? '#5b9eff', flexShrink: 0 }} />
                <span style={{ fontSize: 13 }}>{f.name}</span>
              </label>
            ))}
          </div>
        </div>

        {/* Tags */}
        <div>
          <div style={subHeaderStyle}>
            <span>Tags</span>
            <button
              type="button"
              className="btn btn-primary"
              onClick={saveTags}
              disabled={!tagsDirty || pending}
              style={saveBtnStyle}
            >
              {pending ? 'Saving…' : 'Save'}
            </button>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {tags.length === 0 && <span style={emptyStyle}>No tags yet. Create some from the sidebar.</span>}
            {tags.map(t => {
              const active = selectedTags.has(t.id);
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => toggleTag(t.id)}
                  style={tagChipStyle(active)}
                >
                  #{t.name}
                </button>
              );
            })}
          </div>
        </div>
      </section>

      {/* ── Card 2: Music (dropdown) + Visibility ──────────────────── */}
      <section style={cardStyle}>
        <div style={cardHeaderStyle}>
          <h3 style={cardTitleStyle}>Classification &amp; Visibility</h3>
        </div>

        {/* Music classification — dropdown */}
        <div style={{ marginBottom: 16 }}>
          <label htmlFor="music-flag" style={subHeaderStyle}>Music classification</label>
          <select
            id="music-flag"
            value={musicFlag}
            onChange={e => saveMusic(Number(e.target.value) as 0 | 1 | 2)}
            style={selectStyle}
          >
            {MUSIC_OPTIONS.map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          {channel.music_score > 0 && (
            <div style={{ color: '#5a5a64', fontSize: 11, marginTop: 4 }}>
              Auto-classifier confidence: {(channel.music_score * 100).toFixed(0)}%
            </div>
          )}
        </div>

        {/* Visibility */}
        <div>
          <div style={subHeaderStyle}>Visibility</div>
          <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 13, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={hidden}
              onChange={e => saveHidden(e.target.checked)}
              style={{ marginTop: 3 }}
            />
            <span>
              Hide from default views (toggle the{' '}
              <span className="chip" style={{ margin: '0 4px' }}>Hidden</span>
              {' '}filter in the sidebar to see hidden channels)
            </span>
          </label>
        </div>
      </section>

      {/* ── Notes (full width) ─────────────────────────────────────── */}
      <Section title="Notes" dirty={notes !== (channel.notes ?? '')} onSave={saveNotes} pending={pending} fullWidth>
        <textarea
          className="input"
          rows={5}
          value={notes}
          onChange={e => setNotes(e.target.value)}
          placeholder="Why did you subscribe? What did you want to come back to?"
        />
      </Section>
    </div>
  );
}

// ── Inline styles (shared) ─────────────────────────────────────────
const cardStyle: React.CSSProperties = {
  background: '#15151a',
  border: '1px solid #2a2a33',
  borderRadius: 12,
  padding: 16,
};
const cardHeaderStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  marginBottom: 12,
};
const cardTitleStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  color: '#8b8b94',
};
const subHeaderStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  color: '#8b8b94',
  marginBottom: 6,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
};
const saveBtnStyle: React.CSSProperties = {
  padding: '4px 12px',
  fontSize: 12,
};
const emptyStyle: React.CSSProperties = {
  color: '#5a5a64',
  fontSize: 13,
};
const selectStyle: React.CSSProperties = {
  background: '#0e0e12',
  color: '#e7e7ea',
  border: '1px solid #2a2a33',
  borderRadius: 8,
  padding: '8px 10px',
  fontSize: 13,
  width: '100%',
  cursor: 'pointer',
};

function folderRowStyle(active: boolean): React.CSSProperties {
  return {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '6px 8px',
    borderRadius: 6,
    background: active ? '#1f1f26' : 'transparent',
    cursor: 'pointer',
  };
}

function tagChipStyle(active: boolean): React.CSSProperties {
  return {
    cursor: 'pointer',
    padding: '4px 10px',
    borderRadius: 999,
    fontSize: 12,
    border: '1px solid ' + (active ? '#5b9eff' : '#2a2a33'),
    background: active ? '#5b9eff' : '#1f1f26',
    color: active ? '#0a0a0c' : '#c2c2cb',
    fontWeight: 500,
  };
}

// ── Reusable Section (kept for Notes) ──────────────────────────────
function Section({
  title, children, dirty, onSave, pending, fullWidth,
}: {
  title: string;
  children: React.ReactNode;
  dirty: boolean;
  onSave: () => void;
  pending: boolean;
  fullWidth?: boolean;
}) {
  return (
    <section style={{ ...cardStyle, gridColumn: fullWidth ? '1 / -1' : undefined }}>
      <header style={cardHeaderStyle}>
        <h3 style={cardTitleStyle}>{title}</h3>
        <button className="btn btn-primary" type="button" onClick={onSave} disabled={!dirty || pending} style={saveBtnStyle}>
          {pending ? 'Saving…' : 'Save'}
        </button>
      </header>
      {children}
    </section>
  );
}

function sameSet<T>(a: Set<T>, b: Set<T>): boolean {
  if (a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
}
