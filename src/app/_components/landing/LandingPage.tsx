"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef } from "react";
import { PasteUrlBox } from "../PasteUrlBox";
import {
  AgentPanel,
  BrowserPanel,
  GraphPanel,
  QueuePanel,
  SummaryPanel,
} from "./StopPanels";
import "./landing.css";

const Scene3D = dynamic(() => import("./Scene3D"), { ssr: false });

/* TAV-69: landing redesign — the page is a walkthrough, not a catalog.
   Five stops, one idea each, told with a stylized product panel.
   All 23 former feature cards are represented: most demoted from
   "card with a paragraph" to a chip or to content inside a panel.
   Full mapping: docs/design/landing-redesign-TAV-69.md
   (approved with one amendment: the Queue stop runs last). */

const stops: {
  kicker: string;
  title: string;
  sub: string;
  Panel: () => React.JSX.Element;
  chips: string[];
}[] = [
  {
    kicker: "Summaries",
    title: "Understand any video in minutes",
    sub: "One click pulls the TL;DR, key points, chapters, and topics out of any video. Ask follow-ups and get answers grounded in the transcript, with citations that jump to the exact second.",
    Panel: SummaryPanel,
    chips: [
      "Saved summaries — star what matters",
      "Chapters",
      "Summarize Later reading list",
    ],
  },
  {
    kicker: "The Graph",
    title: "Everything is connected",
    sub: "Your summaries cite each other. Every video you understand makes the next one easier to find — a private knowledge graph of what your subscriptions collectively think matters.",
    Panel: GraphPanel,
    chips: ["Topic mind map", "Channel memory", "Folders & tags"],
  },
  {
    kicker: "Deep Research",
    title: "A research assistant over your library",
    sub: "Flip on agent mode and ask across everything you've indexed: which of your channels covered this, and did any of them disagree? The assistant searches transcripts, summaries, and channel profiles itself — then shows its work.",
    Panel: AgentPanel,
    chips: [
      "Transcript search — to the exact second",
      "Chat with a single video",
      "Scoped to folder, tag, or channel",
      "Weekly digests",
    ],
  },
  {
    kicker: "The Extension",
    title: "1minyt in your browser",
    sub: "A 1minyt pill rides along on every watch page. One click renders the TL;DR right on YouTube — no tab switching. Right-click any video link anywhere to save it or queue it for later.",
    Panel: BrowserPanel,
    chips: [
      "Right-click to save",
      "Search from anywhere",
      "Export & Readwise",
      "Metrics",
    ],
  },
  {
    kicker: "The Queue",
    title: "Your autoplay, finally yours",
    sub: "1minyt ranks what plays next from your own attention — subscriptions, history, topics, the references between your summaries. When a video ends, it ends. What's next is your call, and the queue tells you why.",
    Panel: QueuePanel,
    chips: [
      "Watch tab — player-first",
      "Music tab — audio only",
      "Drag, pin, skip, shuffle",
      "Smart Inbox — triage before it queues",
    ],
  },
];

export function LandingPage() {
  const scrollRef = useRef(0);
  const mainRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    // Track scroll progress 0 → 1 across the full page
    const onScroll = () => {
      const max =
        document.documentElement.scrollHeight - window.innerHeight;
      scrollRef.current = max > 0 ? window.scrollY / max : 0;
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);

    // Reveal animations for content sections
    let io: IntersectionObserver | null = null;
    if (!reduce && mainRef.current) {
      const revealEls = Array.from(
        mainRef.current.querySelectorAll(".landing-reveal"),
      );
      io = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (entry.isIntersecting) {
              entry.target.classList.add("landing-in");
              io?.unobserve(entry.target);
            }
          }
        },
        { threshold: 0.15 },
      );
      revealEls.forEach((el) => io!.observe(el));
    } else if (reduce && mainRef.current) {
      mainRef.current
        .querySelectorAll(".landing-reveal")
        .forEach((el) => el.classList.add("landing-in"));
    }

    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      io?.disconnect();
    };
  }, []);

  return (
    <main className="landing-main" ref={mainRef}>
      {/* Fixed 3D canvas background */}
      <div className="landing-canvas-wrap">
        <Scene3D scrollRef={scrollRef} />
      </div>

      {/* Gradient vignette over canvas for text legibility */}
      <div className="landing-vignette" />

      {/* Hero */}
      <section className="landing-hero">
        <div className="landing-hero-content">
          <div className="landing-badge">
            <span className="landing-badge-dot" />
            Your YouTube, finally your autoplay
          </div>
          <h1 className="landing-h1">
            The YouTube player
            <br />
            <span className="landing-h1-gradient">that knows what you watch</span>
          </h1>
          <p className="landing-sub">
            Connect your YouTube account once. 1minyt pulls your subscriptions,
            summarizes videos with AI, lets you search every transcript, and
            builds an Intelligent Queue that ranks what to play next using your
            own attention data — not YouTube&apos;s global average.
          </p>
          {/* TAV-67: paste-to-try — the primary action, no sign-in needed.
              Anonymous pastes run entirely through Innertube + OpenRouter:
              metadata, transcript, summary, chat. */}
          <div className="landing-paste">
            <PasteUrlBox variant="hero" />
            <p className="landing-paste-note">
              Instant — no YouTube sign-in. Paste any video URL to get its
              transcript, a 1-click AI summary, chapters, and chat.
            </p>
          </div>

          <div className="landing-cta-divider">
            or connect your whole library
          </div>

          <div className="landing-cta-row">
            <a
              className="btn btn-primary landing-btn-lg landing-btn-shine"
              href="/api/oauth/start"
            >
              Connect YouTube →
            </a>
            <a
              className="btn landing-btn-lg landing-btn-outline"
              href="#tour"
            >
              Take the tour ↓
            </a>
          </div>
          <p className="landing-fine-print">
            Free • No sign-in to try • Your data stays in your account •
            Disconnect anytime
          </p>
        </div>
      </section>

      {/* Stats strip */}
      <section className="landing-stats">
        {[
          { label: "Intelligent Queue", value: "Your data" },
          { label: "Autoplay control", value: "Off by default" },
          { label: "Reference graph", value: "Cite → play" },
        ].map((s, i) => (
          <div
            key={s.label}
            className="landing-stat landing-reveal"
            style={{ "--d": i } as React.CSSProperties}
          >
            <div className="landing-stat-value">{s.value}</div>
            <div className="landing-stat-label">{s.label}</div>
          </div>
        ))}
      </section>

      {/* TAV-69: the five-stop tour. One idea per stop, a stylized
          product panel as the hero of each, chips for everything else. */}
      <section className="landing-stops" id="tour">
        <h2 className="landing-section-kicker landing-reveal">
          A player that ranks what you watch, not what YouTube wants you to watch
        </h2>
        {stops.map((stop, i) => {
          const Panel = stop.Panel;
          return (
            <div
              key={stop.title}
              className="landing-stop landing-reveal"
              style={{ "--d": Math.min(i, 4) } as React.CSSProperties}
            >
              <div className="landing-stop-num" aria-hidden="true">
                0{i + 1}
              </div>
              <div className="landing-stop-kicker">{stop.kicker}</div>
              <h3 className="landing-stop-title">{stop.title}</h3>
              <p className="landing-stop-sub">{stop.sub}</p>
              <Panel />
              <div className="landing-chip-row">
                {stop.chips.map((chip) => (
                  <span className="landing-chip" key={chip}>
                    {chip}
                  </span>
                ))}
              </div>
            </div>
          );
        })}
      </section>

      {/* Final CTA */}
      <section className="landing-final landing-reveal">
        <h2>Ready to watch your way?</h2>
        <p>
          Connect your YouTube account in seconds. Get an Intelligent Queue
          that actually knows what you&apos;ve seen — and what&apos;s next.
        </p>
        <a
          className="btn btn-primary landing-btn-lg landing-btn-shine"
          href="/api/oauth/start"
        >
          Connect YouTube →
        </a>
      </section>
    </main>
  );
}
