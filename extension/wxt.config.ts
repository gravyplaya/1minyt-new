/**
 * TAV-68: 1minyt browser extension — Manifest V3, Chrome + Brave.
 *
 * One build covers both browsers (Brave is Chromium). The extension is the
 * client of the app's /api/extension/* surface (TAV-68a):
 *
 *   content script (youtube.com)  ──runtime messages──▶  service worker
 *                                                        (sole API client,
 *                                                        holds server URL +
 *                                                        API key)
 *   popup / options (extension pages) call the same lib/api client directly.
 *
 * Host permissions: only youtube.com is required up front. The app origin is
 * requested at runtime (optional_host_permissions) when the user saves their
 * server URL in options — the app can be self-hosted anywhere.
 */
import { defineConfig } from 'wxt';

export default defineConfig({
  // Everything imported explicitly — no auto-imports magic to keep the
  // codebase grep-able and consistent with the app repo's conventions.
  imports: false,

  // `.output` (WXT default) is a dot-folder — macOS "Load unpacked" file
  // dialogs hide those, which makes loading the dev build needlessly hard.
  outDir: 'dist',

  manifest: {
    name: '1minyt',
    description: 'Save, summarize, and search YouTube videos in your 1minyt library.',
    // Chrome Web Store requires version to be bare; WXT injects it from
    // package.json on build.
    permissions: ['storage', 'contextMenus'],
    optional_host_permissions: ['http://*/*', 'https://*/*'],
    host_permissions: ['*://*.youtube.com/*'],
    action: {
      default_title: '1minyt',
    },
  },
});
