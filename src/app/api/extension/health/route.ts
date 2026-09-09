/**
 * TAV-68a: Connection test — GET /api/extension/health
 * Auth: `Authorization: Bearer <EXTENSION_API_KEY>`.
 *
 * Cheapest authenticated route: no DB, no quota — just "the key works and the
 * server is up". The extension's options page uses it to validate the saved
 * server URL + API key pair before marking the extension as connected.
 */

import { extensionJson, extensionPreflight, guardExtensionRequest } from '@/lib/extension-api';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const denied = guardExtensionRequest(req);
  if (denied) return denied;

  return extensionJson(req, { ok: true, server: '1minyt' });
}

export async function OPTIONS(req: Request) {
  return extensionPreflight(req);
}
