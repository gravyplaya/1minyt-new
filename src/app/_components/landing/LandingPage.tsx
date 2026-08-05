"use client";

import { useEffect, useRef } from "react";
import "./landing.css";

const features = [
  {
    icon: "📥",
    title: "Smart Inbox",
    desc: "New videos from your subscriptions land in a dedicated inbox. Filter, sort, and triage what's worth your time.",
  },
  {
    icon: "✦",
    title: "AI Summaries",
    desc: "One-click summaries extract the key points from any video. Save the gist without watching the whole thing.",
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
    icon: "🔖",
    title: "Summarize Later Queue",
    desc: "Bookmark videos for later summarization. Build your reading list, then process them in batches.",
  },
  {
    icon: "📋",
    title: "Weekly Digests",
    desc: "Generate digests that condense your recent subscriptions into a single readable briefing.",
  },
  {
    icon: "🗂",
    title: "Folders & Tags",
    desc: "Organize channels into folders and tag them for cross-cutting views. Filter music channels automatically.",
  },
  {
    icon: "★",
    title: "Saved Summaries",
    desc: "Star important summaries for quick access. Your personal knowledge base of video insights.",
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

const stackCards = [
  {
    title: "Never miss what matters",
    items: [features[0], features[5]],
  },
  {
    title: "Understand videos in minutes",
    items: [features[1], features[7]],
  },
  {
    title: "Find anything, ask anything",
    items: [features[2], features[3]],
  },
  {
    title: "Your library, your system",
    items: [features[6], features[4]],
  },
  {
    title: "Plug into your workflow",
    items: [features[8], features[9]],
  },
];

const mockThumbs = [
  "linear-gradient(135deg, #5b9eff, #7c5cff)",
  "linear-gradient(135deg, #ff8a5c, #ff5c8a)",
  "linear-gradient(135deg, #3ddc97, #5b9eff)",
  "linear-gradient(135deg, #ffd166, #ff8a5c)",
];

export function LandingPage() {
  const mainRef = useRef<HTMLElement>(null);
  const heroRef = useRef<HTMLElement>(null);
  const tiltRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stackRefs = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => {
    const main = mainRef.current;
    if (!main) return;

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const finePointer = window.matchMedia("(pointer: fine)").matches;
    const supportsScrollTimeline = CSS.supports("animation-timeline: view()");

    // Reveal fallback: browsers without scroll-driven animations get
    // IntersectionObserver-driven class toggles instead.
    let io: IntersectionObserver | null = null;
    if (!supportsScrollTimeline) {
      const revealEls = Array.from(main.querySelectorAll(".landing-reveal"));
      if (reduce) {
        revealEls.forEach((el) => el.classList.add("landing-in"));
      } else {
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
      }
    }

    if (reduce) {
      return () => io?.disconnect();
    }

    const hero = heroRef.current;
    const tilt = tiltRef.current;
    const scrollWrap = scrollRef.current;
    const cards = stackRefs.current.filter(
      (c): c is HTMLDivElement => c !== null,
    );

    let targetX = 0;
    let targetY = 0;
    let curX = 0;
    let curY = 0;
    let raf = 0;

    const onPointerMove = (e: PointerEvent) => {
      if (!hero) return;
      const r = hero.getBoundingClientRect();
      targetY = ((e.clientX - r.left) / r.width - 0.5) * 10; // rotateY
      targetX = -((e.clientY - r.top) / r.height - 0.5) * 8; // rotateX delta
    };
    const onPointerLeave = () => {
      targetX = 0;
      targetY = 0;
    };
    if (finePointer && hero) {
      hero.addEventListener("pointermove", onPointerMove);
      hero.addEventListener("pointerleave", onPointerLeave);
    }

    const tick = () => {
      // Mouse tilt on the mockup (lerped for smoothness)
      curX += (targetX - curX) * 0.08;
      curY += (targetY - curY) * 0.08;
      if (tilt) {
        tilt.style.transform = `rotateX(${(12 + curX).toFixed(2)}deg) rotateY(${curY.toFixed(2)}deg)`;
      }

      const st = window.scrollY;
      const vh = window.innerHeight;

      // Hero mockup scroll parallax: drifts up and fades as you leave the hero
      if (scrollWrap && st < vh * 1.2) {
        scrollWrap.style.transform = `translateY(${(st * 0.12).toFixed(1)}px)`;
        scrollWrap.style.opacity = Math.max(0, 1 - st / (vh * 0.85)).toFixed(3);
      }

      // Feature stack: as the next card slides in, recede the previous one
      for (let i = 0; i < cards.length - 1; i++) {
        const next = cards[i + 1];
        const stickyTop = 48 + (i + 1) * 14;
        const nextTop = next.getBoundingClientRect().top;
        const p = Math.min(
          1,
          Math.max(0, 1 - (nextTop - stickyTop) / (vh * 0.6)),
        );
        const card = cards[i];
        card.style.transform = `scale(${(1 - 0.05 * p).toFixed(4)}) translateY(${(-10 * p).toFixed(1)}px)`;
        card.style.filter = `brightness(${(1 - 0.35 * p).toFixed(3)})`;
      }

      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      io?.disconnect();
      if (finePointer && hero) {
        hero.removeEventListener("pointermove", onPointerMove);
        hero.removeEventListener("pointerleave", onPointerLeave);
      }
    };
  }, []);

  return (
    <main className="landing-main" ref={mainRef}>
      {/* Hero */}
      <section className="landing-hero" ref={heroRef}>
        <div className="landing-orb landing-orb-1" />
        <div className="landing-orb landing-orb-2" />

        <div className="landing-hero-content">
          <div className="landing-badge">
            <span className="landing-badge-dot" />
            Your YouTube, organized
          </div>
          <h1 className="landing-h1">
            Tame your YouTube
            <br />
            <span className="landing-h1-gradient">subscription chaos</span>
          </h1>
          <p className="landing-sub">
            Connect your YouTube account once. 1minyt pulls your subscriptions,
            summarizes videos with AI, lets you search every transcript, and
            organizes everything with folders, tags, and digests.
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

          {/* 3D app mockup */}
          <div className="landing-mockup-stage">
            <div className="landing-mockup-scroll" ref={scrollRef}>
              <div className="landing-mockup-float">
                <div className="landing-mockup" ref={tiltRef}>
                  <div className="landing-mockup-bar">
                    <span className="landing-dot" />
                    <span className="landing-dot" />
                    <span className="landing-dot" />
                    <span className="landing-mockup-title">
                      1minyt — Smart Inbox
                    </span>
                  </div>
                  <div className="landing-mockup-body">
                    <div className="landing-mockup-side">
                      <div className="landing-mockup-side-item is-active">
                        📥 Inbox
                      </div>
                      <div className="landing-mockup-side-item">
                        ✦ Summaries
                      </div>
                      <div className="landing-mockup-side-item">🔍 Search</div>
                      <div className="landing-mockup-side-label">Folders</div>
                      <div className="landing-mockup-side-item">🗂 Tech</div>
                      <div className="landing-mockup-side-item">🗂 Science</div>
                    </div>
                    <div className="landing-mockup-feed">
                      {mockThumbs.map((g, i) => (
                        <div key={g}>
                          <div className="landing-mockup-row">
                            <div
                              className="landing-mockup-thumb"
                              style={{ background: g }}
                            />
                            <div className="landing-mockup-lines">
                              <div
                                className="landing-mockup-line"
                                style={{ width: `${72 - i * 9}%` }}
                              />
                              <div
                                className="landing-mockup-line is-dim"
                                style={{ width: `${45 - i * 5}%` }}
                              />
                            </div>
                          </div>
                          {i === 1 && (
                            <div className="landing-mockup-summary">
                              ✦ Key points extracted · 3 min read
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="landing-chip-float landing-chip-1">
                  ✦ Summary ready — 3 key points
                </div>
                <div className="landing-chip-float landing-chip-2">
                  🔍 1,204 transcripts indexed
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Stats strip */}
      <section className="landing-stats">
        {[
          { label: "AI summaries", value: "One click" },
          { label: "Transcript search", value: "Every word" },
          { label: "Organization", value: "Folders + tags" },
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

      {/* Feature stack */}
      <section className="landing-stack-section" id="features">
        <h2 className="landing-section-kicker landing-reveal">
          Everything you need to actually use your subscriptions
        </h2>
        <div>
          {stackCards.map((card, i) => (
            <div
              key={card.title}
              className="landing-stack-card"
              style={{ "--i": i } as React.CSSProperties}
              ref={(el) => {
                stackRefs.current[i] = el;
              }}
            >
              <div className="landing-stack-head">
                <span className="landing-stack-num">
                  0{i + 1} / 0{stackCards.length}
                </span>
                <h3 className="landing-stack-title">{card.title}</h3>
              </div>
              <div className="landing-stack-feats">
                {card.items.map((f) => (
                  <div className="landing-stack-feat" key={f.title}>
                    <div className="landing-stack-icon">{f.icon}</div>
                    <div>
                      <h4>{f.title}</h4>
                      <p>{f.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Final CTA */}
      <section className="landing-final landing-reveal">
        <h2>Ready to get started?</h2>
        <p>
          Connect your YouTube account in seconds. No credit card, no
          commitment.
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
