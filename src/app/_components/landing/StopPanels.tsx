/* ============================================================
   TAV-69: Landing page redesign — stop panels
   Five stylized HTML/CSS mocks of the actual product UI, one per
   stop of the walkthrough. Pure illustration: decorative internals
   are aria-hidden; real text stays real text. No images anywhere,
   so nothing can drift out of sync with the product.
   Approved plan: docs/design/landing-redesign-TAV-69.md
   (amended: the Queue stop moves from first to last).
   ============================================================ */

export function SummaryPanel() {
  return (
    <div className="stop-panel" aria-label="1minyt summary card mock">
      <div className="stop-panel-head">
        <span className="mock-thumb" aria-hidden="true" />
        <div>
          <div className="mock-title">The YouTube Algorithm Is Not a Person</div>
          <div className="mock-meta">Veritasium · 18:42</div>
        </div>
        <span className="mock-chip">TL;DR</span>
      </div>

      <p className="mock-tldr">
        The recommendation system optimizes for watch time across a billion
        users — not for what any one viewer actually wants to watch next.
      </p>

      <ul className="mock-points" aria-label="Key points">
        <li>
          <span className="mock-ts">04:12</span>
          Recommendations come from global averages, not your history
        </li>
        <li>
          <span className="mock-ts">11:48</span>
          Watch time is the metric being maximized
        </li>
        <li>
          <span className="mock-ts">19:03</span>
 What you click is not what you want to keep watching
        </li>
      </ul>

      <div className="mock-chat" aria-label="Chat with the video">
        <div className="mock-bubble mock-bubble-q">
          So is the algorithm malicious or just indifferent?
        </div>
        <div className="mock-bubble">
          Indifferent — it optimizes a metric, not an intent.
          <span className="mock-cite">04:12</span>
          <span className="mock-cite">19:03</span>
        </div>
      </div>

      <div className="mock-panel-foot">
        …or paste any YouTube URL at the top of this page — no account needed.
      </div>
    </div>
  );
}

export function GraphPanel() {
  return (
    <div className="stop-panel" aria-label="Summary citations mock">
      <div className="graph-stage" aria-hidden="true">
        <div className="graph-node graph-node-sm graph-pos-a">
          <span className="graph-dot" />
          <div>
            <div className="graph-node-title">Webb optics, explained</div>
            <div className="graph-node-meta">NASA Webb · 12:10</div>
          </div>
        </div>
        <div className="graph-node graph-node-sm graph-pos-b">
          <span className="graph-dot" />
          <div>
            <div className="graph-node-title">Inside the cleanroom</div>
            <div className="graph-node-meta">Deep Sky Videos · 9:32</div>
          </div>
        </div>
        <div className="graph-node graph-node-lg graph-pos-c">
          <span className="graph-dot" />
          <div>
            <div className="graph-node-title">The James Webb backlog</div>
            <div className="graph-node-meta">Scoped to your subscriptions</div>
          </div>
          <div className="graph-cites">
            <span className="mock-cite">cited 3× in your library</span>
            <span className="mock-cite">6 related</span>
          </div>
        </div>
        <svg className="graph-lines" viewBox="0 0 100 60" preserveAspectRatio="none">
          <line x1="20" y1="12" x2="50" y2="32" />
          <line x1="80" y1="12" x2="50" y2="32" />
        </svg>
      </div>
      <button type="button" className="graph-play">
        Play this thread →
      </button>
    </div>
  );
}

export function AgentPanel() {
  return (
    <div className="stop-panel" aria-label="Deep Research agent run mock">
      <div className="mock-bubble mock-bubble-q">
        Which of my channels covered the James Webb backlog, and did any
        disagree on the timeline?
      </div>

      <div className="agent-steps" aria-label="Agent steps" aria-hidden="true">
        <span>Searched 214 transcripts</span>
        <span className="agent-arrow">→</span>
        <span>Read 3 summaries</span>
        <span className="agent-arrow">→</span>
        <span>Compared claims</span>
      </div>

      <div className="mock-bubble">
        Three of your channels covered it. Two agree the launch slips to
        December; Cosmic Front disagrees, citing the integration schedule.
        <div className="agent-sources">
          <span className="agent-src">Cosmic Front · 08:15</span>
          <span className="agent-src">NASA Webb · 21:40</span>
          <span className="agent-src">Deep Sky · 04:02</span>
        </div>
      </div>
    </div>
  );
}

export function BrowserPanel() {
  return (
    <div className="stop-panel" aria-label="Browser extension mock">
      <div className="browser-chrome" aria-hidden="true">
        <span className="browser-dot" />
        <span className="browser-dot" />
        <span className="browser-dot" />
        <div className="browser-url">youtube.com/watch?v=…</div>
      </div>

      <div className="browser-body">
        <div className="browser-player" aria-hidden="true">
          <div className="browser-pill">
            <span className="browser-pill-dot" />
            1minyt
          </div>
          <div className="browser-pill-card">
            <div className="browser-pill-title">TL;DR</div>
            <p>
              Test mirrors arrived intact; integration testing is ahead of
              schedule — the December window holds.
            </p>
          </div>
        </div>
        <div className="browser-side" aria-hidden="true">
          <div className="browser-ghost-row" />
          <div className="browser-ghost-row" />
          <div className="browser-ghost-row" />
        </div>
      </div>

      <div className="stop-panel-cta">
        <a className="btn btn-primary landing-btn-lg landing-btn-shine" href="#">
          Download for Chrome &amp; Brave →
        </a>
        <p className="stop-panel-cta-note">
          Free • Chrome &amp; Brave • Connects to your 1minyt account
        </p>
      </div>
    </div>
  );
}

export function QueuePanel() {
  return (
    <div className="stop-panel" aria-label="Intelligent Queue mock">
      <div className="queue-layout">
        <div className="queue-main">
          <div className="queue-row">
            <span className="mock-thumb" aria-hidden="true" />
            <div className="queue-row-body">
              <div className="mock-title">Why JWST looks backwards</div>
              <div className="mock-meta">NASA Webb · 12:10</div>
              <span className="queue-reason">Because you watched “Webb optics, explained”</span>
            </div>
          </div>

          <div className="queue-row queue-row-open">
            <span className="mock-thumb" aria-hidden="true" />
            <div className="queue-row-body">
              <div className="mock-title">The James Webb backlog</div>
              <div className="mock-meta">Cosmic Front · 18:05</div>
              <span className="queue-reason">Cited by a summary you saved</span>
              <div className="queue-why" aria-label="Why this is next">
                <div className="queue-why-title">Why this is next</div>
                <div className="queue-signal">
                  <span>Watch history</span>
                  <div className="queue-bar"><i style={{ width: "72%" }} /></div>
                </div>
                <div className="queue-signal">
                  <span>Topics</span>
                  <div className="queue-bar"><i style={{ width: "54%" }} /></div>
                </div>
                <div className="queue-signal">
                  <span>References</span>
                  <div className="queue-bar"><i style={{ width: "88%" }} /></div>
                </div>
              </div>
            </div>
          </div>

          <div className="queue-row">
            <span className="mock-thumb" aria-hidden="true" />
            <div className="queue-row-body">
              <div className="mock-title">Live: mirror alignment</div>
              <div className="mock-meta">Deep Sky Videos · 42:18</div>
              <span className="queue-reason">New from a channel you follow</span>
            </div>
          </div>
        </div>

        <div className="queue-rail" aria-hidden="true">
          <div className="queue-rail-title">Up Next</div>
          <div className="queue-rail-row">
            <span className="mock-thumb mock-thumb-sm" />
            <div>
              <div className="queue-rail-name">Deep field survey</div>
              <div className="queue-rail-meta">queued · drag ⠿</div>
            </div>
          </div>
          <div className="queue-rail-row">
            <span className="mock-thumb mock-thumb-sm" />
            <div>
              <div className="queue-rail-name">L2, explained</div>
              <div className="queue-rail-meta">plays next · 📌</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
