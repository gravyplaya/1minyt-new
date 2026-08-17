"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { MostReferencedVideo } from "@/lib/types";
import { getMostReferencedVideosAction, pinMultipleToQueueTopAction } from "@/app/actions";
import { youtubeVideoUrl } from "../_lib/format";

/**
 * TAV-29: "Most referenced videos across your subscriptions" — a client-side
 * widget for the channel detail page. Shows the videos that are cited most
 * often by other summarized videos in your subscription graph. This is the
 * simplest possible graph view: a ranked list. A full force-directed graph
 * visualization is the stretch goal; this list satisfies the minimum
 * acceptance criterion.
 *
 * TAV-61: adds a "Play these next" button that batch-pins the referenced
 * videos to the top of the Watch queue and navigates to /watch so they play
 * as a session — "here are 6 videos your subscriptions keep citing, watch
 * them as a session." The button stays thin: it delegates the mutation to the
 * shared pinMultipleToQueueTopAction server action, no business logic here.
 *
 * Fetches its own data on mount and is non-fatal — an empty graph or a fetch
 * failure renders nothing.
 */
export function MostReferencedSection() {
  const [videos, setVideos] = useState<MostReferencedVideo[] | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [pending, start] = useTransition();
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const result = await getMostReferencedVideosAction(10);
      if (cancelled) return;
      setVideos(result);
      setLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!loaded || !videos || videos.length === 0) return null;

  // TAV-61: "Play these next" — batch-pin the referenced videos to the Watch
  // queue (default surface; these are cross-channel citation videos, not
  // music-specific) and navigate to /watch to start the session.
  const playTheseNext = () => {
    const ids = videos.map((v) => v.video_id);
    start(async () => {
      await pinMultipleToQueueTopAction(ids, "watch");
      router.push(`/watch?v=${ids[0]}`);
    });
  };

  return (
    <section style={{ marginTop: 28 }}>
      <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 4, display: "flex", alignItems: "center", gap: 12 }}>
        Most referenced across your subscriptions
        <span style={{ color: "#5a5a64", fontSize: 13, fontWeight: 400 }}>
          videos cited by other summaries
        </span>
        {/* TAV-61: batch-pin the referenced videos to the Watch queue */}
        <button
          type="button"
          className="btn btn-primary"
          onClick={playTheseNext}
          disabled={pending || videos.length === 0}
          title="Pin these videos to the top of the Watch queue and play as a session"
          style={{ fontSize: 12, padding: "5px 12px", marginLeft: "auto" }}
        >
          {pending ? "Queuing…" : "▶ Play these next"}
        </button>
      </h2>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {videos.map((v) => (
          <div
            key={v.video_id}
            style={{
              display: "flex",
              gap: 12,
              alignItems: "center",
              padding: "10px 12px",
              border: "1px solid #2a2a33",
              borderRadius: 10,
              background: "#15151a",
            }}
          >
            <span
              style={{
                fontSize: 18,
                fontWeight: 700,
                color: "#5b9eff",
                minWidth: 28,
                textAlign: "center",
                flexShrink: 0,
              }}
            >
              {v.reference_count}
            </span>
            <a
              href={youtubeVideoUrl(v.video_id)}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                color: "#e7e7ea",
                fontSize: 14,
                fontWeight: 500,
                flex: 1,
                minWidth: 0,
                textDecoration: "none",
              }}
            >
              {v.title}
            </a>
            <span style={{ color: "#8b8b94", fontSize: 12, flexShrink: 0 }}>{v.channel_title}</span>
            <span style={{ color: "#5a5a64", fontSize: 11, flexShrink: 0 }}>
              {v.reference_count} ref{v.reference_count === 1 ? "" : "s"}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
