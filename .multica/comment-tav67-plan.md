Drafted the redesign plan — no code touched yet, per the issue. Full doc lives at `docs/design/landing-redesign-TAV-69.md` in the repo; the essentials below.

**Diagnosis.** 23 cards in 10 stacked sections ≈ 6–7 screens of scroll. The problem isn't card size — it's the unit of the page. It's a catalog. The fix is to make it a walkthrough.

**The redesign in one sentence:** five cinematic "stops" that each carry one idea, shown with a stylized HTML mock of the actual product UI (CSS, no screenshots — nothing to drift out of sync), while the existing Three.js particle field morphs in sync behind each stop.

Page shape: hero (unchanged) → 5 stops → final CTA. ~5 screens (from ~6–7), roughly half the words, a third of the cards.

**The five stops:**

1. **Your autoplay, finally yours** — Intelligent Queue mock: queue rows with reason chips ("Because you watched…", "Cited by a summary you saved") and one row expanded into a "why this is next" signal strip. Chips: Watch/Music tabs, queue controls, Smart Inbox.
2. **Understand any video in minutes** — summary card mock: TL;DR, key points with timestamp chips, one grounded chat exchange; footer ties back to the hero paste box ("no account needed"). Chips: saved summaries, chapters, Summarize Later.
3. **Everything is connected** — citations made visible: summary cards linked by thin gradient lines + a "Play this thread →" control (that's the reference-graph queue). Chips: topic mind map, channel memory, folders & tags.
4. **A research assistant over your library** — agent run mock: question bubble → search steps → cited answer. Chips: transcript search, per-video chat, digests.
5. **1minyt in your browser** — browser-window mock with the 1minyt pill active on a watch page, plus the download CTA (href stays the existing `#` placeholder until the Chrome Web Store listing is live). Chips: export, metrics.

All 23 current features stay represented — full mapping table in the doc; nothing dropped, most demoted from "card with a paragraph" to chip or panel content.

**3D stays.** Same canvas, particle count, camera rig, DistortIco, reduced-motion handling. Changes are contained: morph bands re-timed to the new page height, one new morph target (the knot unwinds into a calm ring for the final CTA), and an optional subtle per-stop particle tint.

**Open defaults** — say "defaults good" or override any:

1. ~5 screens target; prioritizing memorable stops over absolute minimum scroll.
2. Oversized ghost numerals per stop; skipping a dot-progress rail to keep chrome minimal.
3. Ring morph + per-stop tint: both in.
4. Feature mapping as tabled — anything you want promoted back to a full panel, or cut?

Approve (or tweak) and I'll implement it as TAV-69 — one PR touching `LandingPage.tsx`, a new `StopPanels.tsx`, `landing.css`, and the band constants in `Scene3D.tsx`; typecheck/lint/build verified before handoff.
