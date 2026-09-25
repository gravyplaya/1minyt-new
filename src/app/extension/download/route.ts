/**
 * TAV-68 (self-host): GET /extension/download — serve this deployment's
 * browser-extension bundle as a zip.
 *
 * Self-hosters shouldn't need Node tooling to put the extension on their
 * machine: the Docker image builds the extension alongside the Next app and
 * ships the zip inside `public/extension/`, so "download it from your own
 * deployment" is a plain link. The route reads the file at request time
 * (public/ is static, but resolving at request time keeps dev/prod uniform
 * and lets us 404 cleanly when the bundle wasn't built) and streams it with
 * `Content-Disposition: attachment` so it lands as a file, not a page.
 *
 * No auth: the bundle contains no secrets — the user's server URL and API
 * key are entered in the extension's options page after install.
 */
import { NextResponse } from 'next/server';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

export const dynamic = 'force-dynamic';

const CANDIDATES = [
  // Production (Docker): the image builds the bundle into public/extension/.
  path.join(process.cwd(), 'public', 'extension', 'oneminyt-extension-chrome.zip'),
  // Dev fallback: the locally built WXT output.
  path.join(process.cwd(), 'extension', 'dist', 'oneminyt-extension-0.1.0-chrome.zip'),
];

export async function GET() {
  for (const file of CANDIDATES) {
    try {
      await stat(file);
      const data = await readFile(file);
      return new NextResponse(new Uint8Array(data), {
        headers: {
          'Content-Type': 'application/zip',
          'Content-Length': String(data.byteLength),
          'Content-Disposition': 'attachment; filename="oneminyt-extension-chrome.zip"',
          'Cache-Control': 'no-store',
        },
      });
    } catch {
      // Try the next candidate.
    }
  }

  return NextResponse.json(
    {
      error:
        'Extension bundle not found on this deployment. Self-hosters: run `pnpm -C extension zip` and copy extension/dist/*.zip to public/extension/ (the Docker image does this automatically).',
    },
    { status: 404 },
  );
}
