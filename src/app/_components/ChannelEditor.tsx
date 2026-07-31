'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { ChannelWithRelations, FolderRow, TagRow } from '@/lib/types';
import {
  deleteChannelAction,
  setChannelFoldersAction,
  setChannelTagsAction,
  setMusicFlagAction,
  setNotesAction,
  toggleHiddenAction,
} from '@/app/actions';

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

  return (
    <div className="editor-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
      <Section title="Folders" dirty={!sameSet(selectedFolders, new Set(channel.folder_ids))} onSave={saveFolders} pending={pending}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {folders.length === 0 && <span style={{ color: '#5a5a64', fontSize: 13 }}>No folders yet. Create one from the sidebar.</span>}
          {folders.map(f => (
            <label key={f.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', borderRadius: 6, background: selectedFolders.has(f.id) ? '#1f1f26' : 'transparent', cursor: 'pointer' }}>
              <input type="checkbox" checked={selectedFolders.has(f.id)} onChange={() => toggleFolder(f.id)} />
              <span style={{ width: 10, height: 10, borderRadius: 5, background: f.color ?? '#5b9eff' }} />
              <span style={{ fontSize: 13 }}>{f.name}</span>
            </label>
          ))}
        </div>
      </Section>

      <Section title="Tags" dirty={!sameSet(selectedTags, new Set(channel.tag_ids))} onSave={saveTags} pending={pending}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {tags.length === 0 && <span style={{ color: '#5a5a64', fontSize: 13 }}>No tags yet. Create some from the sidebar.</span>}
          {tags.map(t => {
            const active = selectedTags.has(t.id);
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => toggleTag(t.id)}
                style={{
                  cursor: 'pointer',
                  padding: '4px 10px',
                  borderRadius: 999,
                  fontSize: 12,
                  border: '1px solid ' + (active ? '#5b9eff' : '#2a2a33'),
                  background: active ? '#5b9eff' : '#1f1f26',
                  color: active ? '#0a0a0c' : '#c2c2cb',
                  fontWeight: 500,
                }}
              >
                #{t.name}
              </button>
            );
          })}
        </div>
      </Section>

      <Section title="Music classification" dirty={musicFlag !== channel.music_flag} onSave={() => {}} pending={pending} hideSave>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <RadioRow
            label="🎵  Music"
            desc="Hide from the main feed (use the Music filter to view)"
            active={musicFlag === 1}
            onClick={() => saveMusic(1)}
          />
          <RadioRow
            label="📺  Not music"
            desc="Always show in the main feed"
            active={musicFlag === 2}
            onClick={() => saveMusic(2)}
          />
          <RadioRow
            label="❔  Unknown / reset"
            desc="Let the classifier decide next sync"
            active={musicFlag === 0}
            onClick={() => saveMusic(0)}
          />
          {channel.music_score > 0 && (
            <div style={{ color: '#5a5a64', fontSize: 11, marginTop: 4 }}>
              Auto-classifier confidence: {(channel.music_score * 100).toFixed(0)}%
            </div>
          )}
        </div>
      </Section>

      <Section title="Visibility" dirty={hidden !== (channel.hidden === 1)} onSave={() => {}} pending={pending} hideSave>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={hidden}
            onChange={e => saveHidden(e.target.checked)}
          />
          Hide from default views (toggle the <span className="chip" style={{ margin: '0 4px' }}>Hidden</span> filter in the sidebar to see hidden channels)
        </label>
      </Section>

      <Section title="Notes" dirty={notes !== (channel.notes ?? '')} onSave={saveNotes} pending={pending} fullWidth>
        <textarea
          className="input"
          rows={5}
          value={notes}
          onChange={e => setNotes(e.target.value)}
          placeholder="Why did you subscribe? What did you want to come back to?"
        />
      </Section>

      <div style={{ gridColumn: '1 / -1', borderTop: '1px solid #2a2a33', paddingTop: 16, display: 'flex', justifyContent: 'flex-end' }}>
        <button
          className="btn btn-danger"
          type="button"
          onClick={() => {
            if (confirm(`Remove ${channel.title} from 1minyt? This does not unsubscribe on YouTube.`)) {
              start(async () => {
                await deleteChannelAction(channel.channel_id);
              });
            }
          }}
          disabled={pending}
        >
          Remove from 1minyt
        </button>
      </div>
    </div>
  );
}

function Section({
  title, children, dirty, onSave, pending, hideSave, fullWidth,
}: {
  title: string;
  children: React.ReactNode;
  dirty: boolean;
  onSave: () => void;
  pending: boolean;
  hideSave?: boolean;
  fullWidth?: boolean;
}) {
  return (
    <section style={{ background: '#15151a', border: '1px solid #2a2a33', borderRadius: 12, padding: 16, gridColumn: fullWidth ? '1 / -1' : undefined }}>
      <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <h3 style={{ fontSize: 13, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#8b8b94' }}>{title}</h3>
        {!hideSave && (
          <button className="btn btn-primary" type="button" onClick={onSave} disabled={!dirty || pending} style={{ padding: '4px 12px', fontSize: 12 }}>
            {pending ? 'Saving…' : 'Save'}
          </button>
        )}
      </header>
      {children}
    </section>
  );
}

function RadioRow({ label, desc, active, onClick }: { label: string; desc: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        textAlign: 'left',
        padding: '8px 10px',
        borderRadius: 8,
        border: '1px solid ' + (active ? '#5b9eff' : '#2a2a33'),
        background: active ? 'rgba(91, 158, 255, 0.08)' : '#0e0e12',
        color: '#e7e7ea',
        cursor: 'pointer',
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
      }}
    >
      <span style={{ fontWeight: 500, fontSize: 13 }}>{label}</span>
      <span style={{ color: '#8b8b94', fontSize: 11 }}>{desc}</span>
    </button>
  );
}

function sameSet<T>(a: Set<T>, b: Set<T>): boolean {
  if (a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
}