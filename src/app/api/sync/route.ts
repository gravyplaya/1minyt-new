/**
 * Programmatic sync endpoint — POST /api/sync
 *
 * TAV-68: multi-user — syncs every connected user, with per-user error
 * isolation. The response carries one SyncResult per user keyed by user id.
 *
 * Hardening: when CRON_SECRET is set in the environment, requests must carry a
 * matching `x-cron-secret` header (curl -H "x-cron-secret: $CRON_SECRET").
 * Without it the endpoint is open — anyone who finds the URL can trigger a
 * quota-burning sync for every user — so setting the env var on any public
 * deployment is strongly recommended.
 */
import { NextRequest, NextResponse } from 'next/server';
import { syncSubscriptions } from '@/lib/sync';
import { listConnectedUserIds } from '@/lib/tokens';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET?.trim();
  if (secret && req.headers.get('x-cron-secret') !== secret) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  try {
    const userIds = await listConnectedUserIds();
    if (userIds.length === 0) {
      return NextResponse.json({ users: 0, results: {} });
    }

    const results: Record<string, unknown> = {};
    let failures = 0;
    for (const userId of userIds) {
      try {
        results[userId] = await syncSubscriptions(userId);
      } catch (err) {
        failures += 1;
        results[userId] = { error: err instanceof Error ? err.message : String(err) };
      }
    }
    return NextResponse.json({ users: userIds.length, failures, results });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
