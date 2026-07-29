/**
 * Programmatic sync endpoint — POST /api/sync
 *
 * Returns the same SyncResult the server action returns. The UI uses the
 * server action (revalidatePath), but this endpoint is useful for cron /
 * CLI usage.
 */
import { NextResponse } from 'next/server';
import { syncSubscriptions } from '@/lib/sync';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST() {
  try {
    const result = await syncSubscriptions();
    return NextResponse.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}