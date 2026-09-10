# Landing page redesign — design plan

**Multica issue:** TAV-67 "redesign landing page"
**Status:** APPROVED & IMPLEMENTED (TAV-69) — amendment from review: the Queue stop moved from first to last. This doc reflects the as-built order.

---

## The problem, in numbers

Today's landing page (`src/app/_components/landing/LandingPage.tsx`) is a catalog:

- **23 feature cards** across **10 stacked card-grid sections** — roughly 700 words of body copy.
- About **6–7 full screens** of scrolling before the final CTA.
- Every section has the same shape (number → title → 2-card grid), so the page reads as one long undifferentiated list. The 3D background morphs beautifully underneath, but the content on top doesn't participate — it's the same card grid ten times in a row.

The complaint: too many cards, scroll too long. The fix isn't shrinking the cards — it's changing the unit of the page from **feature list** to **walkthrough**.

*(Measured against the current CSS: hero 100vh + stats ~180px + 8 two-card sections ~370px each + two taller sections + final CTA ≈ 5,300px ≈ 6–7 viewports on a typical laptop. The redesign targets ~5.)*

## What stays

- The Three.js background stack, unchanged in mechanics: fixed canvas, 12k particles, scroll-fraction morph bands, camera parallax + mouse rig, DistortIco (`Scene3D.tsx`).
- The hero — badge, headline, paste-to-try box, connect CTA, fine print. It's the conversion surface and it's good.
- The vignette, scroll-reveal system, `prefers-reduced-motion` handling, dark palette (`#5b9eff` → `#7c5cff`).
- **All 23 features stay represented** — none dropped. Most get demoted from "card with a paragraph" to "chip" or to an element inside a mocked product panel. Full mapping table below so nothing is silently lost.

## The redesign in one sentence

**Stop selling the feature list; walk the visitor through the product in five cinematic stops — one idea per stop, told with a stylized product panel instead of a card grid — while the particle field morphs in sync behind each stop.**

Page shape: **hero → 5 stops → final CTA**. As built: ~5.7 screens (from ~6.6 measured on the old page). Roughly half the words, a third of the cards.

---

## The page, stop by stop

| ~Scroll | Screen | 3D background |
|---|---|---|
| 0.00–0.22 | **Hero** (unchanged, + "Take the tour ↓" scroll hint) | sphere assembles into the "1minyt" particle wordmark |
| 0.22–0.42 | **Stop 1 — Understand any video in minutes** | wordmark holds, breathing |
| 0.42–0.56 | **Stop 2 — Everything is connected** | wordmark → torus knot; DistortIco fades in ~0.48 |
| 0.56–0.88 | **Stops 3–4 — research assistant, browser extension** | knot holds, rotating; DistortIco until ~0.86 |
| 0.88–0.97 | **Stop 5 — Your autoplay, finally yours** | knot unwinds into a calm ring |
| 0.97–1.00 | **Final CTA** (unchanged copy) | ring scatters back to sphere |

*(Fractions measured against the as-built page: ~5100px doc height at 1440×900 — about 5.7 viewports, down from ~6.6. Stop centers land at ~0.26 / 0.42 / 0.55 / 0.72 / 0.91 of scroll.)*

Exact fractions get tuned in-browser once real heights exist — the mechanism (scroll-fraction bands in `useFrame`) is unchanged.

### Stop skeleton (same for all five)

```
[ghost numeral 01]     ← oversized ~120px, ~4% opacity, blue→purple gradient text
KICKER                 ← small caps, one phrase
HEADLINE               ← one line, the idea
Sub                    ← max two lines
[Product panel]        ← the star: stylized HTML mock of the actual UI
[Chip row]             ← 2–4 small pills for demoted features
```

Ghost numerals replace today's `01 / 10` section counters — same idea, bigger, calmer, and they anchor the 3D phase changes.

---

## Stop details

### Stop 1 — Understand any video in minutes
*Kicker: SUMMARIES*

Sub: "One click pulls the TL;DR, key points, chapters, and topics out of any video. Ask follow-ups and get answers grounded in the transcript, with citations that jump to the exact second."

**Panel — a summary card, mocked:**
- Header row: video title + channel + duration.
- TL;DR paragraph (2 lines), then 3 key-point rows with timestamp chips (`04:12`, `11:48`, `19:03`).
- Below, one chat exchange: question bubble, answer bubble ending in two citation chips.
- Small footer line in the panel: "…or paste any YouTube URL at the top of this page — no account needed." (ties back to the hero's paste box)

**Chips:** `Saved summaries — star what matters` · `Chapters` · `Summarize Later reading list`

### Stop 2 — Everything is connected
*Kicker: THE GRAPH*

Sub: "Your summaries cite each other. Every video you understand makes the next one easier to find — a private knowledge graph of what your subscriptions collectively think matters."

**Panel — citations made visible:**
- One summary card in the center with two inline citation chips.
- Two smaller summary cards above/beside it, connected to the chips by thin gradient lines (pure CSS, static).
- A "Play this thread →" button under the cluster — the reference-graph-queue idea in one control.

**Chips:** `Topic mind map` · `Channel memory` · `Folders & tags`

### Stop 3 — A research assistant over your library
*Kicker: DEEP RESEARCH*

Sub: "Flip on agent mode and ask across everything you've indexed: which of your channels covered this, and did any of them disagree? The assistant searches transcripts, summaries, and channel profiles itself — then shows its work."

**Panel — an agent run, mocked:**
- Question bubble: "Which of my channels covered the James Webb backlog, and did any disagree on the timeline?"
- A subtle "working" strip: `Searched 214 transcripts → Read 3 summaries → Compared claims` (three small steps with arrows).
- Answer bubble with 3 source chips, each labeled with channel + timestamp.

**Chips:** `Transcript search — to the exact second` · `Chat with a single video` · `Scoped to folder, tag, or channel` · `Weekly digests`

### Stop 4 — 1minyt in your browser
*Kicker: THE EXTENSION*

Sub: "A 1minyt pill rides along on every watch page. One click renders the TL;DR right on YouTube — no tab switching. Right-click any video link anywhere to save it or queue it for later."

**Panel — a browser window, mocked:**
- Browser chrome strip (three dots, URL bar reading `youtube.com/watch?v=…`).
- Inside: a simplified watch layout (player block + side column) with the **1minyt pill** overlaid on the player, in its active state showing a two-line TL;DR.
- Below the window: the download CTA — `Download for Chrome & Brave →` + note "Free • Chrome & Brave • Connects to your 1minyt account". **The href stays the existing `#` placeholder** until the Chrome Web Store listing is live (TAV-68g note).

**Chips (the workflow row):** `Right-click to save` · `Search from anywhere` · `Export & Readwise` · `Metrics`

### Stop 5 — Your autoplay, finally yours
*Kicker: THE QUEUE*

Sub: "1minyt ranks what plays next from your own attention — subscriptions, history, topics, the references between your summaries. When a video ends, it ends. What's next is your call, and the queue tells you why."

**Panel — the Intelligent Queue, mocked:**
- Left (main): 3–4 queue rows — thumbnail block, title, channel, duration — each with a small **reason chip**: `Because you watched …`, `New from a channel you follow`, `Cited by a summary you saved`.
- One row expanded: a "Why this is next" strip underneath showing the ranking signals as tiny labeled bars (Watch history / Topics / References). This is the explainability moment — the single most differentiated feature, so it gets the most elaborate mock. It closes the tour.
- Right rail: a compact "Up Next" column with a drag-handle glyph on one row and a pin glyph on another.

**Chips:** `Watch tab — player-first` · `Music tab — audio only` · `Drag, pin, skip, shuffle` · `Smart Inbox — triage before it queues`

### Final CTA
Unchanged copy and button. The ring scattering back into the sphere behind it gives the page a closing exhale.

---

## Where the current 23 cards go

| Current card | New home |
|---|---|
| Intelligent Queue | Stop 5 panel |
| Autoplay That Respects You | Stop 5 sub ("when a video ends, it ends") |
| Watch Tab / Music Tab / Queue Controls | Stop 5 chips |
| Smart Inbox | Stop 5 chip |
| AI Summaries / Chat with Videos | Stop 1 panel |
| Saved Summaries / Summarize Later | Stop 1 chips |
| Reference Graph Queue | Stop 2 panel ("Play this thread") |
| Topic Mind Map / Channel Memory / Folders & Tags | Stop 2 chips |
| Deep Research Agent | Stop 3 panel |
| Transcript Search / Chat with Your Library | Stop 3 chips |
| Weekly Digests | Stop 3 chip |
| Summarize on YouTube / Right-Click to Save / Search From Anywhere | Stop 4 panel + sub |
| Export & Integrations / Metrics | Stop 4 workflow chips |

---

## Scene3D changes (small, contained)

1. **Re-time the morph bands** to the new page height so the knot phase centers on stops 3–4 and the ending calms down. Constants only, in `ParticleField`'s `useFrame`.
2. **New morph target: a flat ring** (torus, R ≈ 3.2, r ≈ 0.5) for stop 5 → final CTA — one more sampler function in the existing `sampleTorusKnot` pattern, ~10 lines. The knot "unwinding" into a ring reads as the system settling.
3. **Optional, cheap:** lerp the particle gradient endpoints per scroll band (blue→purple → teal→blue → back) so each stop gets a subtle tint shift. Same two `THREE.Color` lerps, driven by `scrollRef`.

No changes to the camera rig, DistortIco, particle count, or the Canvas setup.

## Visual language details

- **Panels are the new cards.** Solid enough to sit on the 3D (rgba(14,14,18,0.6) + `backdrop-filter: blur(12px)` + `#2a2a33` border, same recipe as today's `.landing-feature-section`), so particles glow through the edges. Width ~980px vs today's 820px column — mocks need room to feel real.
- **Chips** reuse the badge pattern (pill, 12px, subtle border) — one new small class.
- **Between stops:** generous whitespace (~120px + the ghost numeral) where the 3D shows through clean. The page breathes; that's part of the length fix.
- **Mobile (≤768px):** panels keep the browser-chrome/queue framing but collapse internal grids to one column; ghost numerals shrink to ~64px; panel side rails hide below ~640px. Same breakpoints as today's CSS.
- **A11y:** panels are stylized illustrations — decorative internals get `aria-hidden`, real text stays real text. All reveals keep the existing IntersectionObserver + `prefers-reduced-motion` pattern.
- **No images anywhere.** Panels are HTML/CSS, so there's nothing to keep in sync with product changes.

## What we're explicitly NOT doing

- No interactivity inside the mock panels beyond hover states (no fake typing, no autoplaying demos).
- No new sections, no FAQ, no pricing, no testimonials.
- No changes to the hero or final CTA copy.
- No changes to the 3D architecture, particle count, or camera behavior.
- No touching any page other than `/` signed-out.

## File plan & estimate

| File | Change |
|---|---|
| `src/app/_components/landing/LandingPage.tsx` | Rewrite: delete `features`/`featureSections`, render 5 stops from a `stops` array |
| `src/app/_components/landing/StopPanels.tsx` | **New** — the five mock panels as small components, keeping LandingPage readable |
| `src/app/_components/landing/landing.css` | Rewrite feature-section styles → stop styles, panel styles, chips, ghost numerals |
| `src/app/_components/landing/Scene3D.tsx` | Re-timed bands + ring target (+ optional tint) |

One PR, one ticket (TAV-69). Roughly half a day including browser-tuning the scroll bands. Verify with `pnpm typecheck` + `pnpm run lint` + `pnpm run build`, and a manual scroll-through at desktop + mobile widths.

## Open questions — resolved in review

1. **Length discipline:** ~5 screens approved (from ~6–7); as built it lands at ~5.7 — the extra ~0.7 keeps the "page breathes" whitespace between stops rather than cramming panels.
2. **Ghost numerals in, dot rail skipped.** As defaulted.
3. **Scene3D extras:** ring morph + per-stop tint — both in, as defaulted.
4. **Feature mapping:** approved as tabled, with the Queue stop moved from first to last (review amendment).
