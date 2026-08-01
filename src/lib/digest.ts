/**
 * TAV-14: New-video digest generator.
 *
 * Syncs all channels, finds videos published since the last sync, writes a
 * `digests` row, and optionally POSTs a payload to a configured webhook URL
 * (Discord/Slack-compatible JSON).
 *
 * The "new" detection is a diff: before syncing each channel we record the set
 * of video_ids already cached for that channel; after syncing, any video_id in
 * the fresh fetch that wasn't in the prior set is "new" (i.e. just inserted by
 * this sync pass). This is robust against re-runs and doesn't rely on
 * `last_synced_at` timestamps which may be null.
 */

import { getDb } from './db';
import { newId } from './id';
import { listChannels } from './repo';
import { syncChannelVideos } from './video-sync';
import { listVideoIdsByChannel, listDigestVideos } from './video-repo';
import type { DigestRow, DigestWithVideos } from './types';

export interface GenerateDigestResult {
  digest: DigestRow;
  errors: string[];
}

/**
 * Sync every channel and collect the videos that are newly inserted by this
 * pass. Writes a `digests` row and returns it.
 *
 * If `DIGEST_WEBHOOK_URL` is set in the environment, the digest payload is also
 * POSTed to that URL (Discord/Slack-compatible). Webhook failures are recorded
 * in the digest's `errors` field but do not abort the run.
 */
export async function generateDigest(maxPerChannel = 30): Promise<GenerateDigestResult> {
  const channels = await listChannels({ hidden: false, includeMusic: true, limit: 500 });
  const errors: string[] = [];
  const newVideoIds: string[] = [];
  let channelsWithNew = 0;
  let periodStart: number | null = null;
  let periodEnd = Math.floor(Date.now() / 1000);

  for (const channel of channels) {
    try {
      // Snapshot the video ids we already have for this channel *before* syncing.
      const before = await listVideoIdsByChannel(channel.channel_id);
      const result = await syncChannelVideos(channel.channel_id, maxPerChannel);
      if (result.errors.length > 0) {
        errors.push(`${channel.title}: ${result.errors.join('; ')}`);
      }
      // Re-read after sync and diff.
      const after = await listVideoIdsByChannel(channel.channel_id);
      const newIds = [...after].filter(id => !before.has(id));
      if (newIds.length > 0) {
        channelsWithNew += 1;
        newVideoIds.push(...newIds);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`${channel.title}: ${msg}`);
    }
  }

  // Compute the period window from the new videos' published_at timestamps.
  if (newVideoIds.length > 0) {
    const videos = await listDigestVideos(newVideoIds);
    const publishedTs = videos
      .map(v => v.published_at)
      .filter((t): t is number => t != null);
    if (publishedTs.length > 0) {
      periodStart = Math.min(...publishedTs);
      periodEnd = Math.max(...publishedTs);
    }
  }

  const now = Math.floor(Date.now() / 1000);
  const digest: DigestRow = {
    id: newId(),
    period_start: periodStart,
    period_end: periodEnd,
    video_count: newVideoIds.length,
    new_video_ids: newVideoIds,
    channel_count: channelsWithNew,
    errors: errors.length > 0 ? errors.join('\n') : null,
    created_at: now,
  };

  // Persist the digest row.
  const client = await getDb();
  try {
    await client.query(
      `INSERT INTO digests (id, period_start, period_end, video_count, new_video_ids, channel_count, errors, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        digest.id,
        digest.period_start,
        digest.period_end,
        digest.video_count,
        JSON.stringify(digest.new_video_ids),
        digest.channel_count,
        digest.errors,
        digest.created_at,
      ],
    );
  } finally {
    client.release();
  }

  // Optional webhook delivery — best-effort, failures are recorded but non-fatal.
  const webhookUrl = process.env.DIGEST_WEBHOOK_URL?.trim();
  if (webhookUrl && newVideoIds.length > 0) {
    try {
      await postDigestWebhook(webhookUrl, digest);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Record the webhook failure on the stored row.
      const combined = [digest.errors, `webhook: ${msg}`].filter(Boolean).join('\n');
      const c = await getDb();
      try {
        await c.query('UPDATE digests SET errors = $1 WHERE id = $2', [combined, digest.id]);
      } finally {
        c.release();
      }
      errors.push(`webhook: ${msg}`);
    }
  }

  return { digest, errors };
}

/**
 * Hydrate a digest row with the full video + channel details for display.
 * Returns null if the digest id doesn't exist.
 */
export async function getDigestWithVideos(digestId: string): Promise<DigestWithVideos | null> {
  const client = await getDb();
  let row: DigestRow | null = null;
  try {
    const { rows } = await client.query<{
      id: string;
      period_start: number | null;
      period_end: number;
      video_count: number;
      new_video_ids: string;
      channel_count: number;
      errors: string | null;
      created_at: number;
    }>('SELECT * FROM digests WHERE id = $1', [digestId]);
    if (rows.length === 0) return null;
    const r = rows[0];
    let ids: string[] = [];
    try { ids = JSON.parse(r.new_video_ids) as string[]; } catch { /* keep default */ }
    row = {
      id: r.id,
      period_start: r.period_start,
      period_end: r.period_end,
      video_count: r.video_count,
      new_video_ids: ids,
      channel_count: r.channel_count,
      errors: r.errors,
      created_at: r.created_at,
    };
  } finally {
    client.release();
  }

  const videos = await listDigestVideos(row.new_video_ids);
  return { ...row, videos };
}

/**
 * Return the most recent digest (by created_at), hydrated with video details.
 * Returns null if no digests exist yet.
 */
export async function latestDigestWithVideos(): Promise<DigestWithVideos | null> {
  const client = await getDb();
  let id: string | null = null;
  try {
    const { rows } = await client.query<{ id: string }>(
      'SELECT id FROM digests ORDER BY created_at DESC LIMIT 1',
    );
    id = rows[0]?.id ?? null;
  } finally {
    client.release();
  }
  if (!id) return null;
  return getDigestWithVideos(id);
}

/**
 * List recent digest rows (newest first) without hydrating video details —
 * used for the digest history list on the /digests page.
 */
export async function listRecentDigests(limit = 10): Promise<DigestRow[]> {
  const client = await getDb();
  try {
    const { rows } = await client.query<{
      id: string;
      period_start: number | null;
      period_end: number;
      video_count: number;
      new_video_ids: string;
      channel_count: number;
      errors: string | null;
      created_at: number;
    }>(
      'SELECT * FROM digests ORDER BY created_at DESC LIMIT $1',
      [limit],
    );
    return rows.map(r => {
      let ids: string[] = [];
      try { ids = JSON.parse(r.new_video_ids) as string[]; } catch { /* keep default */ }
      return {
        id: r.id,
        period_start: r.period_start,
        period_end: r.period_end,
        video_count: r.video_count,
        new_video_ids: ids,
        channel_count: r.channel_count,
        errors: r.errors,
        created_at: r.created_at,
      };
    });
  } finally {
    client.release();
  }
}

// ----- webhook ---------------------------------------------------------------

/**
 * POST a digest payload to a webhook URL. The payload is compatible with both
 * Discord and Slack incoming webhooks (a simple `content` string + `embeds`
 * for Discord, or a `text` field for Slack — we send both so either works).
 */
async function postDigestWebhook(url: string, digest: DigestRow): Promise<void> {
  const videos = await listDigestVideos(digest.new_video_ids);
  const lines = videos.map(v =>
    `• [${v.title}](https://www.youtube.com/watch?v=${v.video_id}) — ${v.channel_title}`,
  );
  const content = `📹 New video digest — ${digest.video_count} new video${digest.video_count === 1 ? '' : 's'} from ${digest.channel_count} channel${digest.channel_count === 1 ? '' : 's'}.\n${lines.join('\n')}`;

  const payload = {
    // Slack-compatible
    text: content,
    // Discord-compatible
    content: content.length > 2000 ? content.slice(0, 1997) + '…' : content,
    embeds: [{
      title: 'New video digest',
      description: `${digest.video_count} new video${digest.video_count === 1 ? '' : 's'} from ${digest.channel_count} channel${digest.channel_count === 1 ? '' : 's'}`,
      color: 0x5b9eff,
      fields: videos.slice(0, 25).map(v => ({
        name: v.channel_title,
        value: `[${v.title}](https://www.youtube.com/watch?v=${v.video_id})`,
      })),
      footer: videos.length > 25 ? { text: `…and ${videos.length - 25} more` } : undefined,
    }],
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error(`webhook returned ${res.status} ${res.statusText}`);
  }
}
