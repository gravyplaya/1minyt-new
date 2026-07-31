/**
 * TAV-11: Export summaries as Markdown or JSON.
 *
 * Joins `videos` + `summaries` + `channels` and formats the result for
 * download. Two output formats are supported:
 *   - `markdown` — a human-readable .md file with one section per video
 *   - `json`     — raw `{ video, channel, summary }` objects as a JSON string
 */

import { getDb } from './db';
import type { ChannelRow, FollowUp, SummaryRow, VideoRow, VideoWithSummary } from './types';

export type ExportFormat = 'markdown' | 'json';

export interface ExportEntry {
  video: Pick<VideoRow, 'video_id' | 'title' | 'channel_id' | 'published_at'> & {
    url: string;
  };
  channel: Pick<ChannelRow, 'channel_id' | 'title'> & {
    url: string;
  };
  summary: Pick<SummaryRow, 'tldr' | 'key_points' | 'follow_ups' | 'topics' | 'model' | 'created_at'> | null;
}

export interface ExportResult {
  /** The formatted file content (Markdown or JSON). */
  content: string;
  /** The file extension without the dot, e.g. `md` or `json`. */
  ext: string;
  /** MIME type for the Blob download. */
  mimeType: string;
  /** A sanitized base filename (no extension), e.g. `channel-name-summaries`. */
  filenameBase: string;
}

// ----- helpers ---------------------------------------------------------------

function youtubeVideoUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${videoId}`;
}

function youtubeChannelUrl(channelId: string): string {
  return `https://www.youtube.com/channel/${channelId}`;
}

/**
 * Sanitize a title for use in a filename. Strips characters that are illegal
 * or problematic in common filesystems, collapses runs of whitespace, and
 * truncates to a reasonable length.
 */
function sanitizeFilename(name: string): string {
  return name
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[.-]+|[.-]+$/g, '')
    .slice(0, 60) || 'export';
}

// ----- query -----------------------------------------------------------------

interface JoinedRow {
  video_id: string;
  video_title: string;
  channel_id: string;
  video_published_at: number | null;
  summary_id: string | null;
  tldr: string | null;
  key_points: string | null;
  follow_ups: string | null;
  topics: string | null;
  model: string | null;
  summary_created_at: number | null;
}

function hydrateEntry(row: JoinedRow): ExportEntry {
  let keyPoints: string[] = [];
  let followUps: FollowUp[] = [];
  let topics: string[] = [];
  if (row.key_points) {
    try { keyPoints = JSON.parse(row.key_points) as string[]; } catch { /* keep default */ }
  }
  if (row.follow_ups) {
    try { followUps = JSON.parse(row.follow_ups) as FollowUp[]; } catch { /* keep default */ }
  }
  if (row.topics) {
    try { topics = JSON.parse(row.topics) as string[]; } catch { /* keep default */ }
  }
  return {
    video: {
      video_id: row.video_id,
      title: row.video_title,
      channel_id: row.channel_id,
      published_at: row.video_published_at,
      url: youtubeVideoUrl(row.video_id),
    },
    channel: {
      channel_id: row.channel_id,
      // The channel title is filled in by the caller after joining.
      title: '',
      url: youtubeChannelUrl(row.channel_id),
    },
    summary: row.summary_id
      ? {
          tldr: row.tldr ?? '',
          key_points: keyPoints,
          follow_ups: followUps,
          topics,
          model: row.model ?? '',
          created_at: row.summary_created_at ?? 0,
        }
      : null,
  };
}

const JOIN_SQL = `
  SELECT
    v.video_id,
    v.title          AS video_title,
    v.channel_id,
    v.published_at   AS video_published_at,
    s.id            AS summary_id,
    s.tldr,
    s.key_points,
    s.follow_ups,
    s.topics,
    s.model,
    s.created_at    AS summary_created_at
  FROM videos v
  LEFT JOIN (
    SELECT DISTINCT ON (video_id) *
    FROM summaries
    ORDER BY video_id, created_at DESC
  ) s ON s.video_id = v.video_id
`;

// ----- single channel --------------------------------------------------------

export async function exportChannelSummaries(channelId: string, format: ExportFormat): Promise<ExportResult> {
  const client = await getDb();
  try {
    const channelRes = await client.query<Pick<ChannelRow, 'channel_id' | 'title'>>(
      'SELECT channel_id, title FROM channels WHERE channel_id = $1',
      [channelId],
    );
    const channel = channelRes.rows[0];
    const channelTitle = channel?.title ?? channelId;

    const { rows } = await client.query<JoinedRow>(
      `${JOIN_SQL} WHERE v.channel_id = $1 ORDER BY v.published_at DESC`,
      [channelId],
    );

    const entries = rows.map(r => {
      const entry = hydrateEntry(r);
      entry.channel.title = channelTitle;
      return entry;
    });

    const content = format === 'json'
      ? JSON.stringify({ channel: channelTitle, summaries: entries }, null, 2)
      : toMarkdown(entries, channelTitle);

    return {
      content,
      ext: format === 'json' ? 'json' : 'md',
      mimeType: format === 'json' ? 'application/json' : 'text/markdown',
      filenameBase: `${sanitizeFilename(channelTitle)}-summaries`,
    };
  } finally {
    client.release();
  }
}

// ----- all channels ----------------------------------------------------------

export async function exportAllSummaries(format: ExportFormat): Promise<ExportResult> {
  const client = await getDb();
  try {
    const channelRes = await client.query<Pick<ChannelRow, 'channel_id' | 'title'>>(
      'SELECT channel_id, title FROM channels ORDER BY title',
    );
    const channelTitles = new Map(channelRes.rows.map(r => [r.channel_id, r.title]));

    const { rows } = await client.query<JoinedRow>(
      `${JOIN_SQL} ORDER BY v.channel_id, v.published_at DESC`,
    );

    const entries = rows.map(r => {
      const entry = hydrateEntry(r);
      entry.channel.title = channelTitles.get(r.channel_id) ?? r.channel_id;
      return entry;
    });

    const content = format === 'json'
      ? JSON.stringify({ summaries: entries }, null, 2)
      : toMarkdown(entries);

    return {
      content,
      ext: format === 'json' ? 'json' : 'md',
      mimeType: format === 'json' ? 'application/json' : 'text/markdown',
      filenameBase: 'all-summaries',
    };
  } finally {
    client.release();
  }
}

// ----- formatting -------------------------------------------------------------

function toMarkdown(entries: ExportEntry[], headerTitle?: string): string {
  const lines: string[] = [];

  if (headerTitle) {
    lines.push(`# ${headerTitle} — Summaries`);
    lines.push('');
    lines.push(`_Exported ${new Date().toISOString()}_`);
    lines.push('');
    lines.push(`${entries.length} video${entries.length === 1 ? '' : 's'}`);
    lines.push('');
    lines.push('---');
    lines.push('');
  } else {
    lines.push('# All Summaries');
    lines.push('');
    lines.push(`_Exported ${new Date().toISOString()}_`);
    lines.push('');
    lines.push(`${entries.length} video${entries.length === 1 ? '' : 's'}`);
    lines.push('');
    lines.push('---');
    lines.push('');
  }

  for (const entry of entries) {
    lines.push(`## [${entry.video.title}](${entry.video.url})`);
    lines.push(`**Channel:** [${entry.channel.title}](${entry.channel.url})`);
    lines.push('');

    if (!entry.summary) {
      lines.push('_No summary yet._');
      lines.push('');
      lines.push('---');
      lines.push('');
      continue;
    }

    lines.push('### TL;DR');
    lines.push(entry.summary.tldr);
    lines.push('');

    if (entry.summary.key_points.length > 0) {
      lines.push('### Key Points');
      for (const point of entry.summary.key_points) {
        lines.push(`- ${point}`);
      }
      lines.push('');
    }

    if (entry.summary.follow_ups.length > 0) {
      lines.push('### Follow-ups');
      for (const fu of entry.summary.follow_ups) {
        lines.push(`- ${fu.title} — ${fu.reason}`);
      }
      lines.push('');
    }

    if (entry.summary.topics.length > 0) {
      lines.push('### Topics');
      lines.push(entry.summary.topics.map(t => `\`${t}\``).join(' '));
      lines.push('');
    }

    lines.push('---');
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Re-export `VideoWithSummary` for callers that want to inspect the raw data
 * before formatting (e.g. tests).
 */
export type { VideoWithSummary };
