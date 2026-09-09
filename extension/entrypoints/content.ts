/**
 * TAV-68c/d: content script — the 1minyt button on YouTube watch pages.
 *
 * Injects a Shadow-DOM pill (bottom-right) on youtube.com watch/shorts pages.
 * Click to expand: Save to library, ⚡ Summarize (renders the TL;DR + key
 * points inline), Summarize Later (queue), and a link into the app's /watch
 * page. All actions go through the service worker (lib/messages.ts) — the
 * content script itself never touches the API key.
 *
 * YouTube is a SPA: `yt-navigate-finish` fires on in-app navigation, so the
 * pill re-resolves its state per video instead of going stale after the first
 * page load.
 */

import { defineContentScript } from 'wxt/utils/define-content-script';
import { sendMessage } from '@/lib/messages';
import { currentVideoId } from '@/lib/youtube-id';
import type { ExtensionSummary } from '@/lib/types';

interface ContentState {
  videoId: string | null;
  status: 'idle' | 'loading' | 'error';
  error?: string;
  saved: boolean;
  transcriptStatus?: string;
  summary: ExtensionSummary | null;
  busy: null | 'save' | 'summarize' | 'queue';
  expanded: boolean;
  /** Transient action feedback ("Saved ✓"), cleared on the next refresh. */
  notice?: string;
  serverUrl: string | null;
}

export default defineContentScript({
  matches: ['*://*.youtube.com/*'],
  runAt: 'document_idle',
  main() {
    const host = document.createElement('div');
    host.id = 'oneminyt-root';
    const shadow = host.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = CSS;
    shadow.appendChild(style);
    const root = document.createElement('div');
    shadow.appendChild(root);
    document.documentElement.appendChild(host);

    let state: ContentState = {
      videoId: null,
      status: 'idle',
      saved: false,
      summary: null,
      busy: null,
      expanded: false,
      serverUrl: null,
    };

    const setState = (patch: Partial<ContentState>) => {
      state = { ...state, ...patch };
      render();
    };

    // ----- actions -------------------------------------------------------------

    async function refresh(videoId: string, keepNotice = false) {
      setState({ videoId, status: 'loading', busy: null, notice: keepNotice ? state.notice : undefined, expanded: state.expanded });
      const res = await sendMessage({ type: 'video-status', videoId });
      if (!res.ok) {
        setState({ status: 'error', error: res.error });
        return;
      }
      const { saved, video, summary } = res.data;
      setState({
        status: 'idle',
        saved,
        summary,
        transcriptStatus: video?.transcriptStatus ?? 'none',
      });
    }

    async function doSave() {
      if (!state.videoId) return;
      setState({ busy: 'save' });
      const res = await sendMessage({ type: 'save-video', videoId: state.videoId });
      if (!res.ok) {
        setState({ busy: null, status: 'error', error: res.error });
        return;
      }
      await refresh(state.videoId, true);
      setState({
        notice: res.data.alreadySummarized ? 'Already in your library ✓' : 'Saved ✓',
      });
    }

    async function doSummarize() {
      if (!state.videoId) return;
      setState({ busy: 'summarize' });
      const res = await sendMessage({ type: 'summarize-video', videoId: state.videoId });
      if (!res.ok || !res.data.ok || !res.data.summary) {
        setState({
          busy: null,
          status: 'error',
          error: res.ok ? (res.data.error ?? 'Summarization failed.') : res.error,
        });
        return;
      }
      setState({
        busy: null,
        saved: true,
        transcriptStatus: 'fetched',
        summary: res.data.summary,
        expanded: true,
        notice: res.data.cached ? 'Cached summary ✓' : 'Summarized ✓',
      });
    }

    async function doQueue() {
      if (!state.videoId) return;
      setState({ busy: 'queue' });
      const res = await sendMessage({ type: 'queue-video', videoId: state.videoId, action: 'add' });
      if (!res.ok) {
        setState({ busy: null, status: 'error', error: res.error });
        return;
      }
      setState({ busy: null, notice: 'Queued for later ✓' });
    }

    async function doOpenOptions() {
      await sendMessage({ type: 'open-options' });
    }

    async function openPanel() {
      setState({ expanded: true });
      const res = await sendMessage({ type: 'get-server-url' });
      if (res.ok) setState({ serverUrl: res.data.serverUrl });
    }

    // ----- rendering ------------------------------------------------------------

    function render() {
      const videoId = currentVideoId();
      // Off watch pages (or after SPA-navigating away) the pill disappears.
      host.style.display = videoId ? 'block' : 'none';
      if (videoId !== state.videoId && videoId) {
        // A new video came into view — re-resolve asynchronously.
        state = { ...state, videoId, summary: null, saved: false, status: 'loading', notice: undefined };
        void refresh(videoId);
        return;
      }

      root.replaceChildren(state.expanded ? buildPanel() : buildPill());
    }

    function buildPill(): HTMLElement {
      const dot =
        state.status === 'error' ? 'om-dot-error' : state.summary ? 'om-dot-done' : state.saved ? 'om-dot-saved' : 'om-dot-idle';
      return el(
        'button',
        { class: 'om-pill', onclick: openPanel, title: '1minyt' },
        el('span', { class: `om-dot ${dot}` }),
        '1minyt',
      );
    }

    function buildPanel(): HTMLElement {
      const panel = el('div', { class: 'om-panel' });

      // Header
      panel.appendChild(
        el(
          'div',
          { class: 'om-header' },
          el('span', { class: 'om-brand' }, '⚡ 1minyt'),
          el(
            'button',
            {
              class: 'om-close',
              title: 'Collapse',
              onclick: () => setState({ expanded: false }),
            },
            '×',
          ),
        ),
      );

      // Setup / error states
      if (state.status === 'error' && state.error?.startsWith('Not configured')) {
        panel.appendChild(
          el(
            'div',
            { class: 'om-body' },
            el('p', { class: 'om-hint' }, 'Connect the extension to your 1minyt server first.'),
            el('button', { class: 'om-btn om-btn-primary', onclick: doOpenOptions }, 'Open options'),
          ),
        );
        return panel;
      }
      if (state.status === 'error') {
        panel.appendChild(
          el(
            'div',
            { class: 'om-body' },
            el('p', { class: 'om-error' }, state.error ?? 'Something went wrong.'),
            el('button', { class: 'om-btn', onclick: () => state.videoId && refresh(state.videoId) }, 'Retry'),
          ),
        );
        return panel;
      }

      // Actions
      const actions = el('div', { class: 'om-actions' });
      actions.appendChild(
        el(
          'button',
          {
            class: `om-btn ${state.saved ? 'om-btn-done' : ''}`,
            onclick: doSave,
            disabled: state.busy ? '' : undefined,
          },
          state.busy === 'save' ? 'Saving…' : state.saved ? 'Saved ✓' : 'Save to library',
        ),
      );
      actions.appendChild(
        el(
          'button',
          {
            class: `om-btn om-btn-primary ${state.summary ? 'om-btn-done' : ''}`,
            onclick: doSummarize,
            disabled: state.busy ? '' : undefined,
          },
          state.busy === 'summarize' ? 'Summarizing…' : state.summary ? 'Summary ✓' : '⚡ Summarize',
        ),
      );
      actions.appendChild(
        el(
          'button',
          {
            class: 'om-btn',
            onclick: doQueue,
            disabled: state.busy ? '' : undefined,
          },
          state.busy === 'queue' ? 'Queuing…' : 'Later 🕑',
        ),
      );
      panel.appendChild(el('div', { class: 'om-body' }, actions));

      if (state.notice) panel.appendChild(el('div', { class: 'om-notice' }, state.notice));

      // Summary
      if (state.summary) {
        panel.appendChild(buildSummary(state.summary));
      } else if (state.status === 'idle') {
        panel.appendChild(
          el(
            'p',
            { class: 'om-hint' },
            state.saved
              ? 'No summary yet — hit ⚡ Summarize.'
              : 'Save this video to your 1minyt library, then summarize it.',
          ),
        );
      }

      // Footer link into the app
      if (state.serverUrl && state.videoId) {
        panel.appendChild(
          el(
            'a',
            {
              class: 'om-link',
              href: `${state.serverUrl}/watch?v=${state.videoId}`,
              target: '_blank',
              rel: 'noreferrer',
            },
            'Open in 1minyt →',
          ),
        );
      }

      return panel;
    }

    function buildSummary(summary: ExtensionSummary): HTMLElement {
      const box = el('div', { class: 'om-summary' });
      box.appendChild(el('div', { class: 'om-tldr' }, summary.tldr));
      if (summary.keyPoints.length > 0) {
        const list = el('ul', { class: 'om-keypoints' });
        for (const point of summary.keyPoints) list.appendChild(el('li', {}, point));
        box.appendChild(list);
      }
      if (summary.topics.length > 0) {
        const chips = el('div', { class: 'om-chips' });
        for (const topic of summary.topics) chips.appendChild(el('span', { class: 'om-chip' }, topic));
        box.appendChild(chips);
      }
      return box;
    }

    // ----- SPA navigation ---------------------------------------------------------

    // Fires on YouTube's in-app navigations (watch → watch, home → watch, …).
    window.addEventListener('yt-navigate-finish', () => render());

    render();
  },
});

/** Tiny DOM builder — keeps the Shadow UI dependency-free. */
function el(
  tag: string,
  attrs: Record<string, string | ((e: Event) => void) | undefined> = {},
  ...children: (Node | string | null | undefined)[]
): HTMLElement {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (typeof value === 'function') {
      node.addEventListener(key.slice(2), value as EventListener);
    } else if (value !== undefined) {
      node.setAttribute(key, value);
    }
  }
  for (const child of children) {
    if (child == null) continue;
    node.append(child instanceof Node ? child : document.createTextNode(child));
  }
  return node;
}

// Palette mirrors the app's globals.css (dark: #0a0a0c bg, #5b9eff accent).
const CSS = `
  :host { all: initial; }
  * { box-sizing: border-box; font-family: -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; }

  .om-pill {
    position: fixed; right: 16px; bottom: 16px; z-index: 9999;
    display: flex; align-items: center; gap: 8px;
    padding: 9px 14px; border: 1px solid #2a2a33; border-radius: 999px;
    background: #15151a; color: #e7e7ea; font-size: 13px; font-weight: 600;
    cursor: pointer; box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
  }
  .om-pill:hover { background: #1f1f26; }

  .om-dot { width: 8px; height: 8px; border-radius: 50%; }
  .om-dot-idle { background: #66666e; }
  .om-dot-saved { background: #ffb84d; }
  .om-dot-done { background: #4ade80; }
  .om-dot-error { background: #ff6363; }

  .om-panel {
    position: fixed; right: 16px; bottom: 16px; z-index: 9999;
    width: 340px; max-height: 70vh; overflow-y: auto;
    background: #0a0a0c; color: #e7e7ea;
    border: 1px solid #2a2a33; border-radius: 12px;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.6);
  }

  .om-header {
    display: flex; align-items: center; justify-content: space-between;
    padding: 10px 14px; border-bottom: 1px solid #2a2a33;
    position: sticky; top: 0; background: #0a0a0c;
  }
  .om-brand { font-size: 13px; font-weight: 700; letter-spacing: 0.02em; }
  .om-close {
    background: none; border: none; color: #c2c2cb; font-size: 18px;
    cursor: pointer; padding: 0 4px; line-height: 1;
  }
  .om-close:hover { color: #e7e7ea; }

  .om-body { padding: 12px 14px; }

  .om-actions { display: flex; gap: 8px; flex-wrap: wrap; }
  .om-btn {
    flex: 1 1 auto; padding: 8px 10px; font-size: 12px; font-weight: 600;
    border: 1px solid #2a2a33; border-radius: 8px;
    background: #1f1f26; color: #e7e7ea; cursor: pointer; white-space: nowrap;
  }
  .om-btn:hover { background: #26262e; }
  .om-btn:disabled { opacity: 0.6; cursor: default; }
  .om-btn-primary { background: #5b9eff; border-color: #5b9eff; color: #0a0a0c; }
  .om-btn-primary:hover { background: #4b8eef; }
  .om-btn-primary:disabled { background: #5b9eff; }
  .om-btn-done { background: #173a26; border-color: #2f6c4a; color: #4ade80; }

  .om-notice { margin: 10px 14px 0; font-size: 12px; color: #4ade80; }

  .om-hint { margin: 10px 14px; font-size: 12px; color: #c2c2cb; line-height: 1.5; }
  .om-error { margin: 10px 14px; font-size: 12px; color: #ff6363; line-height: 1.5; }

  .om-summary { padding: 0 14px 14px; }
  .om-tldr { font-size: 13px; line-height: 1.55; color: #e7e7ea; }
  .om-keypoints { margin: 10px 0 0; padding-left: 18px; }
  .om-keypoints li { font-size: 12px; line-height: 1.5; color: #c2c2cb; margin-bottom: 4px; }
  .om-chips { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 10px; }
  .om-chip {
    font-size: 11px; padding: 3px 8px; border-radius: 999px;
    background: #1f1f26; border: 1px solid #2a2a33; color: #c2c2cb;
  }

  .om-link {
    display: block; margin: 0 14px 12px; font-size: 12px; font-weight: 600;
    color: #5b9eff; text-decoration: none;
  }
  .om-link:hover { text-decoration: underline; }
`;
