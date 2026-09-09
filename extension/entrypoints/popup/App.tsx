/**
 * TAV-68e: popup — current video status + actions + library search.
 *
 * Routes everything through the service worker (lib/messages.ts) like the
 * content script does. Shows one of three sections:
 *  - not configured → setup nudge into options
 *  - on a YouTube watch page → status, Save / ⚡ Summarize / Later, cached summary
 *  - always → quick search across the library's transcript index (TAV-10)
 */

import { useEffect, useState } from 'react';
import { browser } from 'wxt/browser';
import { sendMessage } from '@/lib/messages';
import { parseVideoId } from '@/lib/youtube-id';
import type { ExtensionSummary, SearchResponse, VideoStateResponse } from '@/lib/types';

type Connection = 'checking' | 'ok' | 'not-configured' | 'down' | null;

export default function App() {
  const [connection, setConnection] = useState<Connection>('checking');
  const [videoId, setVideoId] = useState<string | null>(null);
  const [video, setVideo] = useState<VideoStateResponse | null>(null);
  const [summary, setSummary] = useState<ExtensionSummary | null>(null);
  const [busy, setBusy] = useState<'save' | 'summarize' | 'queue' | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [serverUrl, setServerUrl] = useState<string | null>(null);

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResponse['results'] | null>(null);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    (async () => {
      const health = await sendMessage({ type: 'health' });
      setConnection(health.ok ? 'ok' : health.error.startsWith('Not configured') ? 'not-configured' : 'down');

      const settings = await sendMessage({ type: 'get-server-url' });
      if (settings.ok) setServerUrl(settings.data.serverUrl);

      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      const id = tab?.url ? parseVideoId(tab.url) : null;
      if (id) {
        setVideoId(id);
        const res = await sendMessage({ type: 'video-status', videoId: id });
        if (res.ok) {
          setVideo(res.data);
          setSummary(res.data.summary);
        }
      }
    })();
  }, []);

  async function run(action: 'save' | 'summarize' | 'queue') {
    if (!videoId) return;
    setBusy(action);
    setError(null);
    setNotice(null);
    if (action === 'summarize') {
      const res = await sendMessage({ type: 'summarize-video', videoId });
      setBusy(null);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      if (res.data.summary) {
        setSummary(res.data.summary);
        setVideo((v) => (v ? { ...v, saved: true } : v));
        setNotice(res.data.cached ? 'Cached summary ✓' : 'Summarized ✓');
      } else {
        setError(res.data.error ?? 'Summarization failed.');
      }
      return;
    }
    const res =
      action === 'save'
        ? await sendMessage({ type: 'save-video', videoId })
        : await sendMessage({ type: 'queue-video', videoId, action: 'add' });
    setBusy(null);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    if (action === 'save') setVideo((v) => (v ? { ...v, saved: true } : v));
    setNotice(action === 'save' ? 'Saved to library ✓' : 'Queued for later ✓');
  }

  async function runSearch(e: React.FormEvent) {
    e.preventDefault();
    const q = query.trim();
    if (!q) return;
    setSearching(true);
    setResults(null);
    const res = await sendMessage({ type: 'search', query: q });
    setSearching(false);
    if (res.ok) setResults(res.data.results);
    else setError(res.error);
  }

  const dotClass =
    connection === 'ok' ? 'dot ok' : connection === 'not-configured' ? 'dot warn' : connection === 'down' ? 'dot err' : 'dot';

  return (
    <div className="popup">
      <header>
        <span className="brand">⚡ 1minyt</span>
        <span className={dotClass} title={connection ?? undefined} />
        <button className="icon-btn" title="Settings" onClick={() => void sendMessage({ type: 'open-options' })}>
          ⚙
        </button>
      </header>

      {connection === 'not-configured' ? (
        <section className="card">
          <p>Connect the extension to your 1minyt server.</p>
          <button className="btn primary" onClick={() => void sendMessage({ type: 'open-options' })}>
            Open options
          </button>
        </section>
      ) : connection === 'down' ? (
        <section className="card">
          <p>Server unreachable — is the app running? (Settings gear to fix the URL.)</p>
        </section>
      ) : null}

      {videoId && (
        <section className="card">
          <div className="video-title">{video?.video?.title ?? 'Current video'}</div>
          <div className="badges">
            {video?.saved && <span className="badge">Saved</span>}
            {summary && <span className="badge good">Summarized</span>}
            {video?.video?.transcriptStatus === 'unavailable' && <span className="badge warn">No captions</span>}
          </div>
          <div className="row">
            <button className="btn" disabled={busy !== null} onClick={() => void run('save')}>
              {busy === 'save' ? 'Saving…' : video?.saved ? 'Saved ✓' : 'Save'}
            </button>
            <button className="btn primary" disabled={busy !== null} onClick={() => void run('summarize')}>
              {busy === 'summarize' ? 'Summarizing…' : summary ? 'Summary ✓' : '⚡ Summarize'}
            </button>
            <button className="btn" disabled={busy !== null} onClick={() => void run('queue')}>
              {busy === 'queue' ? '…' : 'Later'}
            </button>
          </div>
          {notice && <p className="notice">{notice}</p>}
          {error && <p className="error">{error}</p>}
          {summary && (
            <div className="summary">
              <p className="tldr">{summary.tldr}</p>
              {summary.keyPoints.length > 0 && (
                <ul>
                  {summary.keyPoints.map((point, i) => (
                    <li key={i}>{point}</li>
                  ))}
                </ul>
              )}
              {summary.topics.length > 0 && (
                <div className="chips">
                  {summary.topics.map((topic) => (
                    <span key={topic} className="chip">
                      {topic}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}
          {serverUrl && (
            <a className="link" href={`${serverUrl}/watch?v=${videoId}`} target="_blank" rel="noreferrer">
              Open in 1minyt →
            </a>
          )}
        </section>
      )}

      <section className="card">
        <form onSubmit={runSearch}>
          <input
            type="search"
            placeholder="Search your library…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <button className="btn" disabled={searching}>
            {searching ? '…' : 'Search'}
          </button>
        </form>
        {results && results.length === 0 && <p className="muted">No matches in your library.</p>}
        {results && results.length > 0 && (
          <ul className="results">
            {results.slice(0, 8).map((r, i) => (
              <li key={i}>
                {serverUrl ? (
                  <a href={`${serverUrl}/watch?v=${r.videoId}&t=${Math.floor(r.startMs / 1000)}`} target="_blank" rel="noreferrer">
                    <span className="result-title">{r.videoTitle}</span>
                    <span className="result-channel">{r.channelTitle}</span>
                    <span className="result-snippet">“{r.chunkText}”</span>
                  </a>
                ) : (
                  <span className="result-title">{r.videoTitle}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
