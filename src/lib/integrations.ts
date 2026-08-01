/**
 * TAV-27: Read-later integrations — one-tap send to Readwise / Notion / Obsidian.
 *
 * This module owns:
 *   - The integration settings repo (per-integration token + options, stored in
 *     the `integration_settings` table).
 *   - The Readwise Reader API client (`sendToReadwise`).
 *   - A shared `ExportPayload` builder (`buildExportPayload`) that turns a
 *     bookmarked summary + video + channel into a structured note any
 *     integration can consume: title, channel, TL;DR, key points, follow-ups,
 *     topics, and the source YouTube URL.
 *
 * Readwise is implemented first (simplest API: one POST to /api/v3/save/).
 * Notion and Obsidian are stubbed with typed slugs so the settings UI can list
 * them, but their clients are not yet wired — the action returns a clear
 * "not implemented" error for those until a follow-up adds them.
 */

import { getDb } from './db';
import type { BookmarkedSummary } from './video-repo';

// ----- integration slugs -----------------------------------------------------

export type IntegrationKey = 'readwise' | 'notion' | 'obsidian';

export const INTEGRATIONS: { key: IntegrationKey; label: string; tokenLabel: string; tokenHelp: string; implemented: boolean }[] = [
  {
    key: 'readwise',
    label: 'Readwise Reader',
    tokenLabel: 'Readwise access token',
    tokenHelp: 'Get yours at readwise.io/access_token',
    implemented: true,
  },
  {
    key: 'notion',
    label: 'Notion',
    tokenLabel: 'Notion integration token',
    tokenHelp: 'Create an internal integration at notion.so/my-integrations',
    implemented: false,
  },
  {
    key: 'obsidian',
    label: 'Obsidian',
    tokenLabel: 'Obsidian Sync token',
    tokenHelp: 'Local-file writes are not yet wired',
    implemented: false,
  },
];

// ----- settings repo ---------------------------------------------------------

export interface IntegrationSettings {
  key: IntegrationKey;
  token: string;
  /** JSON-encoded options object (e.g. { databaseId } for Notion). */
  options: Record<string, string>;
  updated_at: number;
}

/** Load the settings for a single integration. Returns null when not configured. */
export async function getIntegrationSettings(key: IntegrationKey): Promise<IntegrationSettings | null> {
  const client = await getDb();
  try {
    const { rows } = await client.query<{ key: string; token: string; options: string; updated_at: number }>(
      'SELECT key, token, options, updated_at FROM integration_settings WHERE key = $1',
      [key],
    );
    if (rows.length === 0) return null;
    let options: Record<string, string> = {};
    try { options = JSON.parse(rows[0].options) as Record<string, string>; } catch { /* keep default */ }
    return { key: rows[0].key as IntegrationKey, token: rows[0].token, options, updated_at: rows[0].updated_at };
  } finally {
    client.release();
  }
}

/** Load settings for all integrations at once (for the settings page). */
export async function listIntegrationSettings(): Promise<Map<IntegrationKey, IntegrationSettings>> {
  const client = await getDb();
  try {
    const { rows } = await client.query<{ key: string; token: string; options: string; updated_at: number }>(
      'SELECT key, token, options, updated_at FROM integration_settings',
    );
    const out = new Map<IntegrationKey, IntegrationSettings>();
    for (const r of rows) {
      let options: Record<string, string> = {};
      try { options = JSON.parse(r.options) as Record<string, string>; } catch { /* keep default */ }
      out.set(r.key as IntegrationKey, { key: r.key as IntegrationKey, token: r.token, options, updated_at: r.updated_at });
    }
    return out;
  } finally {
    client.release();
  }
}

/** Upsert a token + options for an integration. An empty token deletes the row. */
export async function saveIntegrationSettings(key: IntegrationKey, token: string, options?: Record<string, string>): Promise<void> {
  const trimmed = token.trim();
  const client = await getDb();
  try {
    if (!trimmed) {
      await client.query('DELETE FROM integration_settings WHERE key = $1', [key]);
      return;
    }
    const now = Math.floor(Date.now() / 1000);
    await client.query(
      `INSERT INTO integration_settings (key, token, options, updated_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (key) DO UPDATE SET token = excluded.token, options = excluded.options, updated_at = excluded.updated_at`,
      [key, trimmed, JSON.stringify(options ?? {}), now],
    );
  } finally {
    client.release();
  }
}

// ----- export payload --------------------------------------------------------

/**
 * The structured note we send to any PKM integration. Built once from a
 * bookmarked summary so every integration gets the same content.
 */
export interface ExportPayload {
  title: string;
  channel: string;
  /** The YouTube watch URL — the canonical source link. */
  url: string;
  tldr: string;
  keyPoints: string[];
  followUps: { title: string; reason: string }[];
  topics: string[];
  /** ISO timestamp of when the summary was generated. */
  summarizedAt: string;
  /** A Markdown rendering of the full payload, for integrations that take a body. */
  markdown: string;
}

function youtubeVideoUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${videoId}`;
}

/**
 * Build the shared export payload from a bookmarked summary. The markdown body
 * is rendered here so each integration client doesn't have to duplicate the
 * formatting logic.
 */
export function buildExportPayload(item: BookmarkedSummary): ExportPayload {
  const { summary, video, channelTitle } = item;
  const url = youtubeVideoUrl(video.video_id);
  const summarizedAt = new Date(summary.created_at * 1000).toISOString();

  const lines: string[] = [];
  lines.push(`# ${video.title}`);
  lines.push('');
  lines.push(`**Channel:** ${channelTitle}`);
  lines.push(`**Source:** ${url}`);
  lines.push(`**Summarized:** ${summarizedAt}`);
  lines.push('');
  lines.push('## TL;DR');
  lines.push(summary.tldr);
  lines.push('');

  if (summary.key_points.length > 0) {
    lines.push('## Key Points');
    for (const p of summary.key_points) lines.push(`- ${p}`);
    lines.push('');
  }
  if (summary.follow_ups.length > 0) {
    lines.push('## Follow-ups');
    for (const fu of summary.follow_ups) lines.push(`- ${fu.title} — ${fu.reason}`);
    lines.push('');
  }
  if (summary.topics.length > 0) {
    lines.push('## Topics');
    lines.push(summary.topics.map(t => `\`${t}\``).join(' '));
    lines.push('');
  }

  return {
    title: video.title,
    channel: channelTitle,
    url,
    tldr: summary.tldr,
    keyPoints: summary.key_points,
    followUps: summary.follow_ups,
    topics: summary.topics,
    summarizedAt,
    markdown: lines.join('\n'),
  };
}

// ----- Readwise Reader client ------------------------------------------------

const READWISE_SAVE_URL = 'https://readwise.io/api/v3/save/';

export interface SendToIntegrationResult {
  ok: boolean;
  integration: IntegrationKey;
  /** The URL of the created document in the target system, when available. */
  documentUrl?: string;
  error?: string;
}

/**
 * Send a bookmarked summary to Readwise Reader via the /api/v3/save/ endpoint.
 * The summary becomes a permanent article note in the user's Reader library,
 * with the YouTube URL as the canonical source and the Markdown body as the
 * document content.
 */
export async function sendToReadwise(payload: ExportPayload, token: string): Promise<SendToIntegrationResult> {
  try {
    const res = await fetch(READWISE_SAVE_URL, {
      method: 'POST',
      headers: {
        Authorization: `Token ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        url: payload.url,
        title: payload.title,
        author: payload.channel,
        summary: payload.tldr,
        html: `<h1>${escapeHtml(payload.title)}</h1>\n<p><strong>Channel:</strong> ${escapeHtml(payload.channel)}</p>\n<p><strong>Source:</strong> <a href="${escapeHtml(payload.url)}">${escapeHtml(payload.url)}</a></p>\n<h2>TL;DR</h2>\n<p>${escapeHtml(payload.tldr)}</p>\n${payload.keyPoints.length > 0 ? `<h2>Key Points</h2><ul>${payload.keyPoints.map(p => `<li>${escapeHtml(p)}</li>`).join('')}</ul>` : ''}${payload.followUps.length > 0 ? `<h2>Follow-ups</h2><ul>${payload.followUps.map(f => `<li>${escapeHtml(f.title)} — ${escapeHtml(f.reason)}</li>`).join('')}</ul>` : ''}${payload.topics.length > 0 ? `<p><em>Topics:</em> ${payload.topics.map(t => escapeHtml(t)).join(', ')}</p>` : ''}`,
        category: 'article',
        saved_using: '1minyt',
        tags: ['1minyt', ...payload.topics.slice(0, 3)],
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return { ok: false, integration: 'readwise', error: `Readwise API returned ${res.status}: ${body.slice(0, 200)}` };
    }

    const data = await res.json().catch(() => ({})) as { url?: string };
    return { ok: true, integration: 'readwise', documentUrl: data.url };
  } catch (err) {
    return { ok: false, integration: 'readwise', error: err instanceof Error ? err.message : String(err) };
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
