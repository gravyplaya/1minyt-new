/**
 * TAV-68 (self-host): /extension — the browser-extension explainer page.
 *
 * The landing page's Extension stop links here. Two jobs:
 *  1. Explain the extension: what it does on watch pages, the right-click
 *     menu, the popup, and the permissions it asks for.
 *  2. Make install a no-tooling path: the download button serves THIS
 *     deployment's built bundle (/extension/download — the Docker image
 *     bakes it in), followed by the unpacked-install steps and the
 *     connect-to-server steps. For developers building from source there's
 *     a "from source" section.
 *
 * Static marketing page (RSC, no client JS); it reuses the landing page's
 * BrowserWindowMock so the visual matches the tour.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { BrowserWindowMock } from '../_components/landing/StopPanels';
import '../_components/landing/landing.css';

export const metadata: Metadata = {
  title: '1minyt — Browser extension',
  description:
    'Summarize, save, and search YouTube from your browser with the 1minyt extension for Chrome and Brave. Works with any 1minyt server, including your own.',
};

export default function ExtensionPage() {
  return (
    <main className="landing-main">
      {/* Gradient vignette for legibility (same recipe as the landing page,
          minus the 3D canvas — this page doesn't need the WebGL scene). */}
      <div className="landing-vignette" />

      <section className="landing-hero" style={{ minHeight: 0, paddingTop: 96, paddingBottom: 24 }}>
        <div className="landing-hero-content">
          <div className="landing-badge">
            <span className="landing-badge-dot" />
            The extension
          </div>
          <h1 className="landing-h1" style={{ fontSize: 40 }}>
            1minyt in your browser
          </h1>
          <p className="landing-sub">
            A 1minyt pill rides along on every YouTube watch page. One click
            renders the TL;DR right on YouTube — no tab switching. Right-click
            any video link anywhere on the web to save it or queue it for
            later, and search your whole library from the toolbar popup.
          </p>
          <div className="landing-cta-row">
            <a
              className="btn btn-primary landing-btn-lg landing-btn-shine"
              href="/extension/download"
            >
              Download for Chrome &amp; Brave →
            </a>
          </div>
          <p className="landing-fine-print">
            Free • Chrome &amp; Brave • Works with any 1minyt server, including
            your own
          </p>
        </div>
      </section>

      {/* What it looks like on a watch page */}
      <section className="landing-stops" style={{ paddingTop: 0, marginTop: 0 }}>
        <div className="landing-stop landing-reveal landing-in">
          <div className="stop-panel" aria-label="Browser extension mock">
            <BrowserWindowMock />
          </div>
        </div>
      </section>

      {/* Install */}
      <section className="landing-stops" style={{ paddingTop: 0 }}>
        <h2 className="landing-section-kicker landing-reveal landing-in">
          Install it
        </h2>
        <div className="ext-grid">
          <StepCard n={1} title="Download the extension">
            <p className="ext-p">
              Grab the zip from{' '}
              <a className="ext-link" href="/extension/download">
                /extension/download
              </a>{' '}
              — it&apos;s served by this 1minyt deployment, so it&apos;s always
              the build that matches the app you use.
            </p>
          </StepCard>
          <StepCard n={2} title="Unzip it">
            <p className="ext-p">
              Unzip the file anywhere you like — the folder inside is what
              Chrome loads. Keep it somewhere permanent (e.g.{' '}
              <code className="ext-code">~/1minyt-extension</code>); deleting
              the folder removes the extension.
            </p>
          </StepCard>
          <StepCard n={3} title="Load it in your browser">
            <p className="ext-p">
              Open{' '}
              <code className="ext-code">chrome://extensions</code>{' '}
              (Brave: <code className="ext-code">brave://extensions</code>),
              turn on <strong>Developer mode</strong> (top right), click{' '}
              <strong>Load unpacked</strong>, and pick the unzipped folder.
            </p>
          </StepCard>
        </div>
        <p className="ext-note">
          Chrome shows an &quot;unpacked extension&quot; warning — that&apos;s
          expected for any extension installed outside the Web Store. The
          extension&apos;s code is open in the{' '}
          <code className="ext-code">extension/</code> folder of the 1minyt
          repository.
        </p>
      </section>

      {/* Connect */}
      <section className="landing-stops" style={{ paddingTop: 0 }}>
        <h2 className="landing-section-kicker landing-reveal landing-in">
          Connect it to your 1minyt server
        </h2>
        <div className="ext-grid">
          <StepCard n={1} title="Get your API key">
            <p className="ext-p">
              On the server you connect to, set the{' '}
              <code className="ext-code">EXTENSION_API_KEY</code>{' '}
              environment variable (any long random string). This is the
              shared secret the extension presents on every request.
            </p>
          </StepCard>
          <StepCard n={2} title="Sign in to the app">
            <p className="ext-p">
              Open the app in this browser and{' '}
              <Link className="ext-link" href="/">
                sign in
              </Link>
              . The extension rides your existing 1minyt session cookie — no
              separate account.
            </p>
          </StepCard>
          <StepCard n={3} title="Save &amp; test">
            <p className="ext-p">
              Click the 1minyt toolbar icon → gear → options. Enter the server
              URL and the API key, hit{' '}
              <strong>Save &amp; test connection</strong>, and the pill shows
              up on your next YouTube watch page.
            </p>
          </StepCard>
        </div>
        <p className="ext-note">
          Settings live in <code className="ext-code">browser.storage.sync</code>{' '}
          and follow your Chrome profile across machines.
        </p>
      </section>

      {/* Permissions */}
      <section className="landing-stops" style={{ paddingTop: 0 }}>
        <h2 className="landing-section-kicker landing-reveal landing-in">
          What it can access
        </h2>
        <div className="ext-grid">
          <FeatureCard title="youtube.com">
            The content script and right-click menus live only on YouTube
            pages. It reads the video you&apos;re watching and nothing else.
          </FeatureCard>
          <FeatureCard title="Your 1minyt server">
            Requested when you save your server URL — the extension talks only
            to the origin you configure, nowhere else.
          </FeatureCard>
          <FeatureCard title="No browsing history">
            No broad &quot;read all sites&quot; permission. It sees YouTube
            watch pages and the pages you explicitly act on via right-click.
          </FeatureCard>
        </div>
      </section>

      {/* Self-host */}
      <section className="landing-stops" style={{ paddingTop: 0 }}>
        <h2 className="landing-section-kicker landing-reveal landing-in">
          Running your own 1minyt?
        </h2>
        <div className="landing-stop landing-reveal landing-in" style={{ marginBottom: 0 }}>
          <div className="stop-panel">
            <p className="ext-p">
              Self-hosting is the intended way to use the extension. The
              download link above already serves <em>your</em> deployment&apos;s
              bundle — the standard Docker image builds it from source during
              the image build, so nothing extra to run.
            </p>
            <p className="ext-p">
              Building the bundle yourself (from a checkout of the repo):
            </p>
            <pre className="ext-pre">
              <code>{`pnpm install
pnpm -C extension zip
# → extension/dist/oneminyt-extension-<version>-chrome.zip`}</code>
            </pre>
            <p className="ext-p">
              Then load the unzipped{' '}
              <code className="ext-code">dist/chrome-mv3</code> folder as above,
              and point the options page at your server URL and{' '}
              <code className="ext-code">EXTENSION_API_KEY</code>.
            </p>
          </div>
        </div>
      </section>

      <section className="landing-final landing-reveal landing-in">
        <div className="landing-final-card">
          <h2>Ready when you are</h2>
          <p>
            Download the zip, load the folder, sign in — the pill appears on
            your next YouTube watch page.
          </p>
          <a
            className="btn btn-primary landing-btn-lg landing-btn-shine"
            href="/extension/download"
          >
            Download the extension →
          </a>
          <p className="stop-panel-cta-note" style={{ marginTop: 16 }}>
            <Link className="ext-link" href="/">
              ← Back to 1minyt
            </Link>
          </p>
        </div>
      </section>
    </main>
  );
}

function StepCard({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <div className="stop-panel ext-card">
      <div className="ext-step-num">{n}</div>
      <h3 className="ext-card-title">{title}</h3>
      {children}
    </div>
  );
}

function FeatureCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="stop-panel ext-card">
      <h3 className="ext-card-title">{title}</h3>
      <p className="ext-p">{children}</p>
    </div>
  );
}
