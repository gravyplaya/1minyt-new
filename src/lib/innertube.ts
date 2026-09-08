/**
 * Shared youtubei.js (Innertube) client singleton.
 *
 * Promoted from channel-search.ts (TAV-25) so the anonymous video ingest path
 * (TAV-67) and channel search share one client. `Innertube.create()` fetches
 * client config from YouTube on first use (session tokens, client version);
 * creating one per request would multiply that handshake — one per process is
 * what the library authors recommend for server use.
 *
 * Innertube speaks YouTube's private InnerTube API: no Data API quota, no
 * OAuth, no API key. It's the same API family the YouTube apps themselves use.
 */

let innertubePromise: Promise<InnertubeClient> | null = null;

export type InnertubeClient = Awaited<ReturnType<typeof createInnertube>>;

async function createInnertube() {
  const { Innertube } = await import('youtubei.js');
  return Innertube.create();
}

export function getInnertube(): Promise<InnertubeClient> {
  if (!innertubePromise) {
    innertubePromise = createInnertube().catch((err) => {
      // Don't cache a failed init — let the next call retry.
      innertubePromise = null;
      throw err;
    });
  }
  return innertubePromise;
}
