/**
 * TAV-68: client for the app's /api/extension/* surface (TAV-68a) — used only
 * by the service worker (the single network client; see lib/messages.ts).
 *
 * Settings (server URL + shared-secret API key) live in browser.storage.sync
 * so they follow the user across machines. Responses use the app-wide
 * `{ ok, ...data }` / `{ ok: false, error }` shape; anything else is folded
 * into a friendly ApiError.
 */

import { browser } from 'wxt/browser';

export class ApiError extends Error {}

export interface Settings {
  /** Normalized: has protocol, no trailing slash. */
  serverUrl: string;
  apiKey: string;
}

const DEFAULT_KEYS: (keyof Settings)[] = ['serverUrl', 'apiKey'];

export async function getSettings(): Promise<Settings | null> {
  const stored = await browser.storage.sync.get(DEFAULT_KEYS);
  const serverUrl = stored.serverUrl as string | undefined;
  const apiKey = stored.apiKey as string | undefined;
  if (!serverUrl || !apiKey) return null;
  return { serverUrl: normalizeServerUrl(serverUrl), apiKey };
}

export async function saveSettings(settings: Settings): Promise<void> {
  await browser.storage.sync.set({
    serverUrl: normalizeServerUrl(settings.serverUrl),
    apiKey: settings.apiKey.trim(),
  });
}

/** "https://host[:port]" — adds a missing protocol, strips trailing slashes. */
export function normalizeServerUrl(url: string): string {
  let raw = url.trim();
  if (!raw) return '';
  if (!/^https?:\/\//.test(raw)) raw = `https://${raw}`;
  return raw.replace(/\/+$/, '');
}

/** Origin match-pattern for the optional host permission (options page). */
export function serverOriginPattern(url: string): string | null {
  try {
    const parsed = new URL(normalizeServerUrl(url));
    return `${parsed.origin}/*`;
  } catch {
    return null;
  }
}

async function requireSettings(): Promise<Settings> {
  const settings = await getSettings();
  if (!settings) {
    throw new ApiError('Not configured — open the extension options and set your server URL and API key.');
  }
  return settings;
}

/**
 * Fetch an /api/extension/* endpoint. Throws ApiError on network / auth /
 * server-side failures; resolves to the parsed `{ ok: true, ... }` body on
 * success. A route returning `ok: false` (e.g. 4xx with a friendly message)
 * also throws ApiError carrying that message.
 *
 * `credentials: 'include'` ships the app's session cookie (TAV-68 multi-user):
 * the API key authenticates the extension, the cookie picks *whose* library
 * the call touches. Signed-out browsers get a friendly 401 from the server.
 */
export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const { serverUrl, apiKey } = await requireSettings();

  let res: Response;
  try {
    res = await fetch(`${serverUrl}${path}`, {
      ...init,
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        ...init?.headers,
      },
    });
  } catch {
    throw new ApiError(`Could not reach ${serverUrl} — check the server URL and that the app is running.`);
  }

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new ApiError(`Unexpected response from the server (HTTP ${res.status}).`);
  }

  const b = body as { ok?: boolean; error?: string };
  if (!b || typeof b !== 'object' || b.ok !== true) {
    throw new ApiError(b?.error ?? `Request failed (HTTP ${res.status}).`);
  }
  return body as T;
}

// ----- endpoint wrappers ------------------------------------------------------

export async function fetchVideoState(videoId: string) {
  return apiFetch<import('./types').VideoStateResponse>(
    `/api/extension/video?id=${encodeURIComponent(videoId)}`,
  );
}

export async function saveVideo(videoId: string) {
  return apiFetch<import('./types').IngestResponse>('/api/extension/ingest', {
    method: 'POST',
    body: JSON.stringify({ videoId }),
  });
}

export async function summarizeVideo(videoId: string) {
  return apiFetch<import('./types').SummarizeResponse>('/api/extension/summarize', {
    method: 'POST',
    body: JSON.stringify({ videoId }),
  });
}

export async function queueVideo(videoId: string, action: 'add' | 'remove' = 'add') {
  return apiFetch<import('./types').QueueResponse>('/api/extension/queue', {
    method: 'POST',
    body: JSON.stringify({ videoId, action }),
  });
}

export async function searchLibrary(query: string) {
  return apiFetch<import('./types').SearchResponse>(
    `/api/extension/search?q=${encodeURIComponent(query)}`,
  );
}

export async function healthCheck() {
  return apiFetch<import('./types').HealthResponse>('/api/extension/health');
}
