/**
 * Smoke test: verify the /api/extension/* surface (TAV-68a) against a running
 * app. Checks auth (guard + 401 paths) and the read-only routes; the
 * write path (ingest → summarize → queue) only runs when SMOKE_VIDEO_ID is
 * set, since it hits YouTube and spends LLM tokens.
 *
 * Run: pnpm smoke:extension
 * Requires: app running (default http://localhost:3000, override BASE_URL)
 *           EXTENSION_API_KEY set to the same value as the server
 * Optional: SMOKE_VIDEO_ID=dQw4w9WgXcQ to exercise ingest/summarize/queue
 */
import process from 'node:process';

const BASE_URL = (process.env.BASE_URL ?? 'http://localhost:3000').replace(/\/+$/, '');
const API_KEY = process.env.EXTENSION_API_KEY ?? '';
const SMOKE_VIDEO_ID = process.env.SMOKE_VIDEO_ID ?? '';

let failures = 0;

function check(name: string, condition: boolean, detail?: unknown) {
  if (condition) {
    console.log(`  ✓ ${name}`);
  } else {
    failures++;
    console.error(`  ✗ ${name}`, detail ?? '');
  }
}

async function call(path: string, init?: RequestInit) {
  const res = await fetch(`${BASE_URL}${path}`, init);
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    // non-JSON body — leave null
  }
  return { status: res.status, body: body as { ok?: boolean; error?: string } | null };
}

async function main() {
  if (!API_KEY) {
    console.error('EXTENSION_API_KEY must be set (same value as the server).');
    process.exitCode = 1;
    return;
  }

  const auth = { Authorization: `Bearer ${API_KEY}`, 'Content-Type': 'application/json' };

  console.log(`Extension API smoke test → ${BASE_URL}\n`);

  console.log('Auth:');
  const noAuth = await call('/api/extension/health');
  check('no key → 401', noAuth.status === 401, noAuth);
  const badAuth = await call('/api/extension/health', { headers: { Authorization: 'Bearer wrong' } });
  check('wrong key → 401', badAuth.status === 401, badAuth);
  const health = await call('/api/extension/health', { headers: auth });
  check('health ok', health.status === 200 && health.body?.ok === true, health);

  console.log('Read-only:');
  const search = await call('/api/extension/search?q=hello', { headers: auth });
  check('search ok', search.status === 200 && search.body?.ok === true, search);
  const badId = await call('/api/extension/video?id=short', { headers: auth });
  check('invalid id → 400', badId.status === 400, badId);
  const badBody = await call('/api/extension/ingest', {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({ url: 'https://youtube.com/@handle' }),
  });
  check('channel url → 400 with reason', badBody.status === 400 && !!badBody.body?.error, badBody);

  if (!SMOKE_VIDEO_ID) {
    console.log('\nWrite path skipped (set SMOKE_VIDEO_ID=<youtube id> to run ingest/summarize/queue).');
  } else {
    console.log('Write path:');
    const ingest = await call('/api/extension/ingest', {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ videoId: SMOKE_VIDEO_ID }),
    });
    check('ingest ok', ingest.status === 200 && ingest.body?.ok === true, ingest);
    const state = await call(`/api/extension/video?id=${SMOKE_VIDEO_ID}`, { headers: auth });
    check('video state ok + saved', state.status === 200 && state.body?.ok === true, state);
    const queue = await call('/api/extension/queue', {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ videoId: SMOKE_VIDEO_ID, action: 'remove' }),
    });
    check('queue remove ok', queue.status === 200 && queue.body?.ok === true, queue);
    const summarize = await call('/api/extension/summarize', {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ videoId: SMOKE_VIDEO_ID }),
    });
    // ok:false with a friendly reason (e.g. no captions) is a valid outcome —
    // only a 5xx / non-JSON failure fails the smoke test.
    check('summarize responds', summarize.status >= 200 && summarize.status < 500 && !!summarize.body, summarize);
  }

  console.log(failures === 0 ? '\nAll checks passed ✓' : `\n${failures} check(s) failed ✗`);
  if (failures > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
