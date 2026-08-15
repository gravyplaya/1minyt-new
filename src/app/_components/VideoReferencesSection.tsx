"use client";

import { useEffect, useState } from "react";
import type { IncomingReference, VideoReferenceWithTarget } from "@/lib/types";
import { getVideoReferencesAction } from "@/app/actions";
import { youtubeVideoUrl } from "../_lib/format";

/**
 * TAV-29: Shows the cross-video reference graph for a summarized video.
 *
 * Two sections:
 *  - "References" — outgoing edges: videos this video's summary cited as
 *    follow-ups. Rendered as a list of linked videos with the cite reason.
 *  - "Referenced by" — incoming edges: other videos whose summaries cite this
 *    video. Rendered the same way, with the citing video's reason.
 *
 * The section fetches its own data on mount via a server action and is
 * non-fatal: a fetch failure or empty graph simply renders nothing.
 */
export function VideoReferencesSection({ videoId }: { videoId: string }) {
  const [outgoing, setOutgoing] = useState<VideoReferenceWithTarget[] | null>(null);
  const [incoming, setIncoming] = useState<IncomingReference[] | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const result = await getVideoReferencesAction(videoId);
      if (cancelled) return;
      setOutgoing(result.ok ? result.outgoing : []);
      setIncoming(result.ok ? result.incoming : []);
      setLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [videoId]);

  // Nothing to show until we've loaded, and nothing if both lists are empty.
  if (!loaded || ((outgoing?.length ?? 0) === 0 && (incoming?.length ?? 0) === 0)) {
    return null;
  }

  return (
    <div style={{ marginTop: 0 }}>
      {outgoing && outgoing.length > 0 && (
        <OutgoingReferenceList
          title="References"
          subtitle="Videos this summary cites"
          refs={outgoing}
          videoId={videoId}
        />
      )}
      {incoming && incoming.length > 0 && (
        <IncomingReferenceList
          title="Referenced by"
          subtitle="Videos whose summaries cite this one"
          refs={incoming}
          videoId={videoId}
        />
      )}
    </div>
  );
}

/**
 * Renders a labelled list of outgoing reference edges. Each edge shows the
 * cited (target) video's title linking to YouTube and the citing reason.
 */
function OutgoingReferenceList({
  title,
  subtitle,
  refs,
  videoId,
}: {
  title: string;
  subtitle: string;
  refs: VideoReferenceWithTarget[];
  videoId: string;
}) {
  return (
    <ReferenceShell title={title} subtitle={subtitle}>
      {refs.map((r) => {
        const linkedVideoId = r.target_video_id;
        if (!linkedVideoId) return null;
        const label = r.target_video_title ?? linkedVideoId;
        return (
          <ReferenceRow
            key={r.id}
            href={youtubeVideoUrl(linkedVideoId)}
            label={label}
            channel={r.target_channel_title}
            context={r.context}
            dimmed={linkedVideoId === videoId}
          />
        );
      })}
    </ReferenceShell>
  );
}

/**
 * Renders a labelled list of incoming reference edges. Each edge shows the
 * citing (source) video's title linking to YouTube and the reason it gave.
 */
function IncomingReferenceList({
  title,
  subtitle,
  refs,
}: {
  title: string;
  subtitle: string;
  refs: IncomingReference[];
  videoId: string;
}) {
  return (
    <ReferenceShell title={title} subtitle={subtitle}>
      {refs.map((r) => {
        const linkedVideoId = r.source_video_id;
        const label = r.source_video_title ?? linkedVideoId;
        return (
          <ReferenceRow
            key={r.id}
            href={youtubeVideoUrl(linkedVideoId)}
            label={label}
            channel={r.source_channel_title}
            context={r.context}
          />
        );
      })}
    </ReferenceShell>
  );
}

/** Shared header + list container for both reference sections. */
function ReferenceShell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div
        style={{
          textTransform: "uppercase",
          letterSpacing: "0.06em",
          fontSize: 11,
          color: "#8b8b94",
          marginBottom: 2,
          display: "flex",
          gap: 8,
          alignItems: "center",
        }}
      >
        <span>{title}</span>
        <span style={{ fontSize: 10, color: "#5a5a64", textTransform: "none", letterSpacing: 0 }}>
          {subtitle}
        </span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>{children}</div>
    </div>
  );
}

/** A single reference row: linked title, channel, and optional reason. */
function ReferenceRow({
  href,
  label,
  channel,
  context,
  dimmed = false,
}: {
  href: string;
  label: string;
  channel: string | null;
  context: string | null;
  dimmed?: boolean;
}) {
  return (
    <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        style={{
          color: dimmed ? "#8b8b94" : "#5b9eff",
          fontSize: 13,
          fontWeight: 500,
          flex: 1,
          minWidth: 0,
        }}
      >
        {label}
      </a>
      {channel && (
        <span style={{ color: "#5a5a64", fontSize: 11, flexShrink: 0 }}>{channel}</span>
      )}
      {context && (
        <span
          style={{
            color: "#8b8b94",
            fontSize: 12,
            fontStyle: "italic",
            maxWidth: 200,
          }}
        >
          {context}
        </span>
      )}
    </div>
  );
}
