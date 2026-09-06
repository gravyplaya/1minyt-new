/**
 * Data access for the /chat surface (TAV-63/64/65):
 *  - library_chat_messages — per-scope conversation threads
 *  - channel_dossiers      — per-channel LLM "memory" (see dossier.ts)
 */

import { getDb } from './db';
import { newId } from './id';
import type { ChannelDossier, LibraryChatMessage } from './types';

// ----- library chat messages ---------------------------------------------------

export async function saveLibraryChatMessage(input: {
  scope: string;
  role: 'user' | 'assistant';
  content: string;
  toolTrace?: string | null;
}): Promise<LibraryChatMessage> {
  const client = await getDb();
  try {
    const now = Math.floor(Date.now() / 1000);
    const id = newId();
    await client.query(
      'INSERT INTO library_chat_messages (id, scope, role, content, tool_trace, created_at) VALUES ($1, $2, $3, $4, $5, $6)',
      [id, input.scope, input.role, input.content, input.toolTrace ?? null, now],
    );
    return {
      id,
      scope: input.scope,
      role: input.role,
      content: input.content,
      tool_trace: input.toolTrace ?? null,
      created_at: now,
    };
  } finally {
    client.release();
  }
}

export async function listLibraryChatMessages(scope: string, limit = 50): Promise<LibraryChatMessage[]> {
  const client = await getDb();
  try {
    const { rows } = await client.query(
      'SELECT * FROM library_chat_messages WHERE scope = $1 ORDER BY created_at ASC, id ASC LIMIT $2',
      [scope, limit],
    );
    return rows.map((r: { id: string; scope: string; role: string; content: string; tool_trace: string | null; created_at: number }) => ({
      id: r.id,
      scope: r.scope,
      role: r.role as 'user' | 'assistant',
      content: r.content,
      tool_trace: r.tool_trace,
      created_at: r.created_at,
    }));
  } finally {
    client.release();
  }
}

/** Clear one scope's thread (used by the "Clear chat" button). */
export async function clearLibraryChat(scope: string): Promise<void> {
  const client = await getDb();
  try {
    await client.query('DELETE FROM library_chat_messages WHERE scope = $1', [scope]);
  } finally {
    client.release();
  }
}

// ----- channel dossiers ---------------------------------------------------------

export async function saveDossier(input: {
  channel_id: string;
  model: string;
  dossier: string;
  themes: string[];
  video_count: number;
  token_count: number | null;
}): Promise<void> {
  const client = await getDb();
  try {
    const now = Math.floor(Date.now() / 1000);
    await client.query(
      `INSERT INTO channel_dossiers (channel_id, model, dossier, themes, video_count, token_count, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $7)
       ON CONFLICT (channel_id) DO UPDATE SET
         model = excluded.model,
         dossier = excluded.dossier,
         themes = excluded.themes,
         video_count = excluded.video_count,
         token_count = excluded.token_count,
         updated_at = excluded.updated_at`,
      [input.channel_id, input.model, input.dossier, JSON.stringify(input.themes), input.video_count, input.token_count, now],
    );
  } finally {
    client.release();
  }
}

export async function getDossier(channelId: string): Promise<ChannelDossier | null> {
  const client = await getDb();
  try {
    const { rows } = await client.query(
      'SELECT * FROM channel_dossiers WHERE channel_id = $1',
      [channelId],
    );
    if (rows.length === 0) return null;
    const r = rows[0] as { channel_id: string; model: string; dossier: string; themes: string; video_count: number; token_count: number | null; created_at: number; updated_at: number };
    let themes: string[] = [];
    try { themes = JSON.parse(r.themes) as string[]; } catch { themes = []; }
    return {
      channel_id: r.channel_id,
      model: r.model,
      dossier: r.dossier,
      themes,
      video_count: r.video_count,
      token_count: r.token_count,
      created_at: r.created_at,
      updated_at: r.updated_at,
    };
  } finally {
    client.release();
  }
}
