"use client";

import { useEffect, useState } from "react";
import type { MostReferencedVideo } from "@/lib/types";
import { getMostReferencedVideosAction } from "@/app/actions";
import { youtubeVideoUrl } from "../_lib/format";

/**
 * TAV-29: "Most referenced videos across your subscriptions" — a client-side
 * widget for the channel detail page. Shows the videos that are cited most
 * often by other summarized videos in your subscription graph. This is the
 * simplest possible graph view: a ranked list. A full force-directed graph
 * visualization is the stretch goal; this list satisfies the minimum
 * acceptance criterion.
 *
 * Fetches its own data on mount and is non-fatal — an empty graph or a fetch
 * failure renders nothing.
 */
export function MostReferencedSection() {
  const [videos, setVideos] = useState<MostReferencedVideo[] | null>(null);
  const [loaded, setLoaded] = useState(false);

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

  return (
    <section style={{ marginTop: 28 }}>
      <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>
        Most referenced across your subscriptions
        <span style={{ color: "#5a5a64", fontSize: 13, fontWeight: 400, marginLeft: 8 }}>
          videos cited by other summaries
        </span>
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
