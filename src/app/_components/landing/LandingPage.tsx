"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef } from "react";
import "./landing.css";

const Scene3D = dynamic(() => import("./Scene3D"), { ssr: false });

const features = [
  {
    icon: "▶",
    title: "Intelligent Queue",
    desc: "Stop re-watching the same videos. Our queue ranks what's next using your subscriptions, play history, summary topics, and reference graph — not YouTube's global average.",
  },
  {
    icon: "⏭",
    title: "Autoplay That Respects You",
    desc: "When a video ends, the next one loads with a 5-second countdown you can dismiss. The choice is transparent and editable — not a black box optimizing someone else's watch time.",
  },
  {
    icon: "🎬",
    title: "Watch Tab",
    desc: "A player-first surface: full-width 16:9 player, a Now Playing panel with summaries, chapters, chat, and references, plus an Up Next queue you control.",
  },
  {
    icon: "🎵",
    title: "Music Tab",
    desc: "A dedicated listening surface for music channels. Audio-first — no transcripts, no chat, no summaries. Just your tracks, queued by what you actually listen to.",
  },
  {
    icon: "🔗",
    title: "Reference Graph Queue",
    desc: "Your summaries cite each other — a private knowledge graph of what your subscriptions collectively think matters. Turn those citations into an instant themed queue.",
  },
  {
    icon: "🎛",
    title: "Queue Controls",
    desc: "Drag to reorder. Skip what you don't want. Pin a video to play next. Shuffle for serendipity. Push to Summarize Later. The queue is yours.",
  },
  {
    icon: "📥",
    title: "Smart Inbox",
    desc: "New videos from your subscriptions land in a dedicated inbox. Filter, sort, and triage what's worth your time — then send straight to your Watch queue.",
  },
  {
    icon: "📋",
    title: "Weekly Digests",
    desc: "Generate digests that condense your recent subscriptions into a single readable briefing.",
  },
  {
    icon: "✦",
    title: "AI Summaries",
    desc: "One-click summaries extract the key points from any video. Save the gist without watching the whole thing.",
  },
  {
    icon: "★",
    title: "Saved Summaries",
    desc: "Star important summaries for quick access. Your personal knowledge base of video insights.",
  },
  {
    icon: "🔍",
    title: "Transcript Search",
    desc: "Search across every indexed transcript. Results link straight to the exact moment in the video.",
  },
  {
    icon: "💬",
    title: "Chat with Videos",
    desc: "Ask questions about a video and get answers grounded in the transcript, with timestamp citations.",
  },
  {
    icon: "🗂",
    title: "Folders & Tags",
    desc: "Organize channels into folders and tag them for cross-cutting views. Filter music channels automatically.",
  },
  {
    icon: "🔖",
    title: "Summarize Later Queue",
    desc: "Bookmark videos for later summarization. Build your reading list, then process them in batches.",
  },
  {
    icon: "📊",
    title: "Metrics",
    desc: "See subscription counts, video totals, and summarization activity at a glance.",
  },
  {
    icon: "📤",
    title: "Export & Integrations",
    desc: "Export your library to JSON or CSV. Send summaries to Readwise and other note-taking tools.",
  },
];

const featureSections = [
  { title: "Your autoplay, finally", items: [features[0], features[1]] },
  { title: "Two ways to play", items: [features[2], features[3]] },
  { title: "Discovery from your own graph", items: [features[4], features[5]] },
  { title: "Never miss what matters", items: [features[6], features[7]] },
  { title: "Understand videos in minutes", items: [features[8], features[9]] },
  { title: "Find anything, ask anything", items: [features[10], features[11]] },
  { title: "Your library, your system", items: [features[12], features[13]] },
  { title: "Plug into your workflow", items: [features[14], features[15]] },
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
          <div className="landing-cta-row">
            <a
              className="btn btn-primary landing-btn-lg landing-btn-shine"
              href="/api/oauth/start"
            >
              Connect YouTube →
            </a>
            <a
              className="btn landing-btn-lg landing-btn-outline"
              href="#features"
            >
              See features
            </a>
          </div>
          <p className="landing-fine-print">
            Free • Your data stays in your account • Disconnect anytime
          </p>
        </div>
      </section>

      {/* Stats strip */}
      <section className="landing-stats">
        {[
          { label: "Intelligent Queue", value: "Your data" },
          { label: "Autoplay control", value: "5s countdown" },
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

      {/* Feature sections */}
      <section className="landing-features" id="features">
        <h2 className="landing-section-kicker landing-reveal">
          A player that ranks what you watch, not what YouTube wants you to watch
        </h2>
        {featureSections.map((section, i) => (
          <div
            key={section.title}
            className="landing-feature-section landing-reveal"
            style={{ "--d": Math.min(i, 4) } as React.CSSProperties}
          >
            <div className="landing-feature-num">0{i + 1} / 0{featureSections.length}</div>
            <h3 className="landing-feature-title">{section.title}</h3>
            <div className="landing-feature-grid">
              {section.items.map((f) => (
                <div className="landing-feature-card" key={f.title}>
                  <div className="landing-feature-icon">{f.icon}</div>
                  <div>
                    <h4>{f.title}</h4>
                    <p>{f.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
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
