/**
 * CLI: run `pnpm run sync` to pull subscriptions headlessly.
 * Useful for cron / launchd jobs that keep the library fresh without opening the UI.
 *
 * TAV-68: multi-user — syncs EVERY connected user's subscriptions, each with
 * their own token, with per-user error isolation (one user's revoked token
 * doesn't abort the others).
 */
import { syncSubscriptions } from '../src/lib/sync';
import { listConnectedUserIds } from '../src/lib/tokens';
import { closePool } from '../src/lib/db';

async function main() {
  const userIds = await listConnectedUserIds();
  if (userIds.length === 0) {
    console.log('No connected users — nothing to sync.');
    return;
  }
  console.log(`Syncing subscriptions for ${userIds.length} user(s)...`);

  let failed = false;
  for (const userId of userIds) {
    try {
      const result = await syncSubscriptions(userId);
      console.log(`user ${userId}: ${JSON.stringify(result)}`);
      if (result.errors.length > 0) failed = true;
    } catch (err) {
      console.error(`user ${userId}: sync failed:`, err instanceof Error ? err.message : err);
      failed = true;
    }
  }
  if (failed) process.exit(1);
}

main()
  .catch(err => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => closePool());
