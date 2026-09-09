/**
 * TAV-68: the message protocol between the extension surfaces and the
 * service worker.
 *
 * The service worker is the app's ONLY network client (single auth point,
 * consistent error handling). The content script must go through it — content
 * scripts share youtube.com's origin and can't carry the API key. The popup
 * and options pages also route through it so every request behaves the same.
 */

import { browser } from 'wxt/browser';
import type {
  HealthResponse,
  IngestResponse,
  QueueResponse,
  SearchResponse,
  SummarizeResponse,
  VideoStateResponse,
} from './types';

export type ExtensionMessage =
  | { type: 'video-status'; videoId: string }
  | { type: 'save-video'; videoId: string }
  | { type: 'summarize-video'; videoId: string }
  | { type: 'queue-video'; videoId: string; action: 'add' | 'remove' }
  | { type: 'search'; query: string }
  | { type: 'health' }
  | { type: 'get-server-url' }
  | { type: 'open-options' };

/** Sentinel payloads carrying the per-message success/failure result type. */
export interface MessageResults {
  'video-status': VideoStateResponse;
  'save-video': IngestResponse;
  'summarize-video': SummarizeResponse;
  'queue-video': QueueResponse;
  'search': SearchResponse;
  'health': HealthResponse;
  'get-server-url': { serverUrl: string | null };
  'open-options': null;
}

export type MessageResponse<T> = { ok: true; data: T } | { ok: false; error: string };

/** Typed send: content script / popup / options → service worker. */
export function sendMessage<K extends keyof MessageResults>(
  message: Extract<ExtensionMessage, { type: K }>,
): Promise<MessageResponse<MessageResults[K]>> {
  return browser.runtime.sendMessage(message) as Promise<
    MessageResponse<MessageResults[K]>
  >;
}
