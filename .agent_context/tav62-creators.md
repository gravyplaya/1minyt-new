## 1minyt for Creators — paid feature ideas

Right now 1minyt is built for the **viewer** side: organize subscriptions, summarize videos, chat with transcripts. A creator tier flips the lens — creators want to understand *their own* content and audience, optimize for the algorithm, and turn one video into ten pieces of distribution. The good news: most of the heavy lifting (transcript fetch, LLM summarize, chapters, comments, reference graph, integrations, export) is already in the codebase. Here's what would actually sell.

---

### Tier 1 — Content optimization (pre-publish)

These are the features creators already pay TubeBuddy / VidIQ for. 1minyt's edge: you already have the transcript + summary engine, so you can analyze the *script* before it's published, not just metadata after.

1. **Title & thumbnail A/B test predictor** — paste 3–5 title/thumbnail combos; the LLM scores click-through likelihood against the channel's niche and top-performing videos, returns a ranked list with reasoning. Creators currently guess; this turns it into a data-backed pick. *Net-new: a scoring prompt + comparison UI. Reuses `summarize.ts` LLM plumbing.*
2. **Description & tags optimizer** — given the video transcript, generate an SEO-tuned description, hashtags, and comma-separated tags grounded in what the video actually covers (not generic keyword spam). YouTube rewards relevance. *Reuses transcript fetch + `summarize.ts` JSON-mode output; adds a new prompt template.*
3. **Chapter auto-generator (creator mode)** — you already have `video_chapters` / `chapters.ts` for existing videos. Flip it to accept an uploaded/pasted transcript for an unpublished video and emit YouTube-compatible chapter timestamps + titles the creator can paste into the description. *Existing infra, new input path.*
4. **Retention-hole analysis** — for published videos with retention data (YouTube Analytics API), correlate transcript segments with drop-off points and flag the specific 30-second windows where viewers leave, with a rewrite suggestion. *Net-new: YouTube Analytics API + a join against `transcript_segments`. High perceived value — no current tool does this well at the script level.*

### Tier 2 — Audience intelligence (post-publish)

5. **Community Pulse Pro** — you already fetch top comments + summarize them (`video_comments` table, TAV-20). For creators, expand to: sentiment trend over time, top fan questions that go unanswered (great for community-tab / next-video ideas), and recurring topic requests. *Extends existing `summarizeComments`; adds a creator-facing dashboard view.*
6. **"What your audience is asking" feed** — aggregate questions found across comments on all the creator's videos, cluster them, and surface underserved topics → direct video-idea generation. This is the #1 thing Morningfame charges for. *Net-new clustering over existing comment data.*
7. **Audience retention vs. summary correlation** — cross-reference which topics/segments the audience engages with most (from comments + chat) against the AI summary's key points to show "what your audience *thinks* your video was about vs. what you intended." *Novel — leverages your unique summary + comment data.*

### Tier 3 — Workflow & repurposing (the "save me 3 hours" tier)

8. **Multi-format repurposing** — one click turns a video's summary into: a Twitter thread, a LinkedIn post, a newsletter blurb, and a short-form script (Shorts/Reels/TikTok). Creators spend hours on this manually. *Reuses `SummarizeResult`; adds per-format prompt templates + an export menu. High willingness-to-pay.*
9. **Batch summary export → CMS** — you already have `export.ts` (Markdown/JSON) and integrations (Readwise/Notion/Obsidian). For creators, add Notion-as-CMS and Ghost/WordPress direct publish so summarized/repurposed content lands in their blog automatically. *Extends `integrations.ts`; adds two integration slugs.*
10. **Content calendar from your own library** — scan the creator's last 30 videos, detect the topic clusters (you already extract `topics` per summary), and suggest a 2-week publishing cadence with gap topics. *Reuses `topics` field + a scheduling UI.*

### Tier 4 — Competitive intelligence

11. **Channel teardown** — paste any competitor's channel; 1minyt fetches their recent videos, summarizes them, and shows: their top recurring topics, posting cadence, average length, and which formats get the most comments. Creators pay for this via Social Blade / Noxinfluencer today; the transcript angle is unique. *Reuses `sync.ts` + `summarize.ts` against an arbitrary channel id rather than the user's subs.*
12. **"Reference graph" for competitors** — you already built `video_references` (TAV-29) mapping which videos cite which. Point it at a competitor's channel to show their content web → which of their videos act as hubs. *Existing infra, new scope.*

---

### Suggested packaging

| Tier | Price (mo) | What's in it |
|---|---|---|
| Free (current) | $0 | Viewer features — subscriptions, summaries, chat, digests |
| **Creator** | $12–19 | Tier 1 + Tier 3 (optimization + repurposing) — the daily workflow tools |
| **Creator Pro** | $29–39 | Adds Tier 2 + Tier 4 (audience intelligence + competitor teardowns) |

The pricing logic: Tier 1+3 are "save me hours every week" tools that justify a mid-tier subscription. Tier 2+4 are "grow my channel" intelligence that justifies a premium. Avoid gating the existing viewer features — the free tier is your top-of-funnel, and creators are also viewers.

### One thing to build first

If I had to pick one feature to validate the whole tier: **multi-format repurposing (#8)**. It uses infrastructure you already have (`SummarizeResult` + `export.ts`), solves a pain every creator feels daily, and is easy to charge for because the time saved is concrete and measurable. Ship it as a single button on the video detail page: "Repurpose → [Twitter / LinkedIn / Newsletter / Shorts script]." If creators click it more than twice, you have a product.
