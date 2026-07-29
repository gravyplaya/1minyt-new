/**
 * CLI: run `npm run sync` to pull subscriptions headlessly.
 * Useful for cron / launchd jobs that keep the library fresh without opening the UI.
 */
import { syncSubscriptions } from '../src/lib/sync';

async function main() {
  const result = await syncSubscriptions();
  console.log(JSON.stringify(result, null, 2));
  if (result.errors.length > 0) process.exit(1);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});