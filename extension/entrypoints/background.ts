/**
 * TAV-68: background service worker — the extension's single network client.
 *
 *  - Message router (lib/messages.ts): content script / popup / options ask
 *    here; only this file talks to the app's /api/extension/* surface, so
 *    auth, error folding, and settings live in exactly one place.
 *  - Context menus (TAV-68f): "Save to 1minyt" / "Summarize Later" on any
 *    YouTube video link, and on watch pages themselves. The menu items only
 *    appear on URLs that can resolve to a video (targetUrlPatterns /
 *    documentUrlPatterns), so no dead clicks.
 */

import { browser } from 'wxt/browser';
import { defineBackground } from 'wxt/utils/define-background';
import {
  fetchVideoState,
  healthCheck,
  queueVideo,
  saveVideo,
  searchLibrary,
  summarizeVideo,
  getSettings,
} from '@/lib/api';
import type { ExtensionMessage } from '@/lib/messages';
import { parseVideoId } from '@/lib/youtube-id';

const YT_LINK_PATTERNS = [
  '*://*.youtube.com/watch*',
  '*://youtu.be/*',
  '*://*.youtube.com/shorts/*',
  '*://*.youtube.com/live/*',
  '*://*.youtube.com/embed/*',
  '*://*.youtube.com/v/*',
];

export default defineBackground(() => {
  // ----- message router ------------------------------------------------------

  browser.runtime.onMessage.addListener(async (raw: unknown) => {
    const msg = raw as ExtensionMessage;
    try {
      switch (msg.type) {
        case 'video-status':
          return ok(await fetchVideoState(msg.videoId));
        case 'save-video':
          return ok(await saveVideo(msg.videoId));
        case 'summarize-video':
          return ok(await summarizeVideo(msg.videoId));
        case 'queue-video':
          return ok(await queueVideo(msg.videoId, msg.action));
        case 'search':
          return ok(await searchLibrary(msg.query));
        case 'health':
          return ok(await healthCheck());
        case 'get-server-url': {
          const settings = await getSettings();
          return ok({ serverUrl: settings?.serverUrl ?? null });
        }
        case 'open-options':
          await browser.runtime.openOptionsPage();
          return ok(null);
        default:
          return fail(`Unknown message type: ${(msg as { type: string }).type}`);
      }
    } catch (err) {
      return fail(err instanceof Error ? err.message : String(err));
    }
  });

  // ----- context menus (TAV-68f) ---------------------------------------------

  browser.runtime.onInstalled.addListener(() => {
    // Any YouTube video link, on any site.
    browser.contextMenus.create({
      id: 'oneminyt-save-link',
      title: 'Save to 1minyt',
      contexts: ['link'],
      targetUrlPatterns: YT_LINK_PATTERNS,
    });
    browser.contextMenus.create({
      id: 'oneminyt-queue-link',
      title: 'Summarize Later (1minyt)',
      contexts: ['link'],
      targetUrlPatterns: YT_LINK_PATTERNS,
    });
    // The watch page itself — right-click anywhere on it.
    browser.contextMenus.create({
      id: 'oneminyt-save-page',
      title: 'Save to 1minyt',
      contexts: ['page', 'video'],
      documentUrlPatterns: YT_LINK_PATTERNS,
    });
    browser.contextMenus.create({
      id: 'oneminyt-queue-page',
      title: 'Summarize Later (1minyt)',
      contexts: ['page', 'video'],
      documentUrlPatterns: YT_LINK_PATTERNS,
    });
  });

  browser.contextMenus.onClicked.addListener(async (info) => {
    const target = (info as { linkUrl?: string; pageUrl?: string }).linkUrl
      ?? (info as { pageUrl?: string }).pageUrl
      ?? '';
    const videoId = parseVideoId(target);
    if (!videoId) return;

    try {
      if (info.menuItemId === 'oneminyt-save-link' || info.menuItemId === 'oneminyt-save-page') {
        await saveVideo(videoId);
      } else if (info.menuItemId === 'oneminyt-queue-link' || info.menuItemId === 'oneminyt-queue-page') {
        await queueVideo(videoId, 'add');
      }
    } catch (err) {
      // No UI surface here — the action result is visible next time the
      // popup or watch-page button refreshes status. Log for diagnosability.
      console.error(`1minyt context-menu action failed:`, err instanceof Error ? err.message : err);
    }
  });
});

function ok<T>(data: T) {
  return { ok: true as const, data };
}

function fail(error: string) {
  return { ok: false as const, error };
}
