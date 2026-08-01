# 1minyt

**1minyt** is a YouTube subscription intelligence tool — it turns your YouTube subscriptions from a passive feed into a searchable, summarizable, exportable knowledge base.

Instead of scrolling past hundreds of uploads hoping to catch the ones that matter, 1minyt syncs your subscriptions, summarizes videos in one click, lets you search across every transcript you've indexed, and surfaces what's new — all in a single self-hosted web app.

---

## How it works

1. **Connect your YouTube account** via OAuth. 1minyt imports every channel you're subscribed to.
2. **Sync** pulls each channel's recent uploads and caches the video metadata and transcripts locally.
3. **Summarize** any video with one click — an LLM produces a TL;DR, key points, and follow-up questions.
4. **Search, bookmark, export, and digest** your way through the library.

---

## Core features

### Subscription management
- **OAuth import** — connect a YouTube account and sync every subscription automatically.
- **Organization** — group channels into folders, tag them, search, sort, and hide channels you don't want in the main view.
- **Music classifier** — automatically flags music channels so you can filter them out of your reading queue.
- **Responsive UI** — works on desktop and mobile with a collapsible sidebar.

### One-click summaries
- **Instant summaries** — fetch the transcript (via the Innertube API) and send it to an OpenRouter LLM. Get back a TL;DR, bulleted key points, and follow-up questions.
- **Auto-topic tagging** — every summary is tagged with 2–5 topics (e.g. "AI", "economics"). Filter your video list by topic, not just by channel.
- **AI chapter detection** — when a video has no YouTube chapters, 1minyt detects natural topic boundaries in the transcript and generates a clickable chapter list. Click any chapter to jump straight to that moment on YouTube.
- **Batch summarize** — a "Summarize all new" button summarizes every un-summarized video in a channel in one pass, with a progress indicator and resume-on-error.

### Cross-video transcript search
- **Search across all indexed transcripts** — ask "what did my subscriptions say about X?" and get matching transcript segments with timestamps, ranked by relevance. Each result links to the exact moment in the video.
- Powered by a local vector store — transcripts are chunked, embedded, and searched with cosine similarity, all in PostgreSQL. No hosted vector database required.

### Chat with video (RAG)
- **Ask questions about any video** — a retrieval-augmented chat grounds its answers in the transcript and cites timestamps. Click a citation to jump to that moment on YouTube.

### Knowledge base
- **Saved / bookmarked summaries** — star any summary to bookmark it. A dedicated `/saved` page shows only your bookmarked summaries, sorted by save date — a personal reference library.
- **Export** — download all summaries for a channel (or all channels) as Markdown or JSON. Drop them straight into Obsidian, Notion, or a blog draft.

### New-video digests
- **Digest generator** — sync all channels and produce a "what's new" digest. See every newly published video since the last sync, with channel, title, thumbnail, and a one-click summarize option.
- **Webhook support** — optionally POST the digest to a Discord, Slack, or Telegram webhook so new videos come to you instead of you checking the app.

### Metrics dashboard
- Track engagement across your subscriptions — summaries generated, chats started, per-channel and per-topic breakdowns.

---

## Architecture

| Layer | Technology |
|---|---|
| Framework | Next.js 16 (App Router, React Server Components) |
| Language | TypeScript |
| Database | PostgreSQL |
| Transcripts | YouTube Innertube API |
| LLM | OpenRouter (OpenAI-compatible `/chat/completions`) |
| Vector search | Local hashing vectorizer + cosine similarity in Postgres |
| Auth | Google OAuth (YouTube Data API v3) |
| Styling | CSS modules + Tailwind |

Every feature is a self-contained `src/lib/*.ts` module with server actions in `actions.ts` and React components — no external services beyond the database and the LLM API.

---

## Feature roadmap (in progress)

The following enhancements are currently being built ([TAV-16](mention://issue/d7200cc7-c4f5-4332-ae2e-813558707944)):

1. **Persist unused YouTube API data** — view/like/comment counts, video tags, category IDs, channel topics, branding, and livestream detection (all fetched today but discarded).
2. **RSS-first sync** — replace API polling with YouTube's free RSS feeds to cut quota usage ~90%.
3. **Whisper fallback** — speech-to-text for the ~40% of videos with no captions, unlocking summaries and chat for every video.
4. **Community Pulse** — summarize the top-voted comments alongside the transcript to surface corrections and context.
5. **IFrame Player with transcript-synced seek** — click a chat citation and the embedded player jumps to that timestamp.
6. **Unified inbox / triage view** — a single relevance-ranked feed of new videos across all subscriptions (à la Reeder/Gmail).
7. **Summarize Later queue** — a Pocket-style queue with overnight batch summarization.
8. **Coverage / habit tracking metrics** — see how much of your subscription library you've actually processed.
9. **Channel back-catalog search** — search a channel's entire history via the YouTube `search.list` endpoint.
10. **Curated playlists import** — import a channel's public playlists as recommended entry points.
11. **Read-later exports** — one-tap send to Readwise / Notion / Obsidian.
12. **Notification webhooks** — push digests to Discord / Slack / Telegram.
13. **Video reference graph** — visualize cross-video citations and topic connections.
14. **Collaborative curation** — shared channel folders for teams.

---

## Project structure

```
src/
├── app/
│   ├── _components/      # React components (HeaderBar, VideosPanel, VideoSummaryRow, etc.)
│   ├── _lib/            # Client-side helpers (formatting, form actions)
│   ├── api/             # API routes (OAuth callback, sync trigger)
│   ├── c/[id]/          # Channel detail page
│   ├── search/          # Cross-video transcript search page
│   ├── saved/           # Bookmarked summaries page
│   ├── digests/         # New-video digest page
│   ├── metrics/         # Metrics dashboard
│   ├── actions.ts       # Server actions (summarize, sync, bookmark, export, etc.)
│   ├── layout.tsx       # Root layout
│   └── page.tsx         # Home — subscription list
└── lib/
    ├── chapters.ts      # AI chapter detection (TAV-13)
    ├── chat.ts          # RAG chat logic
    ├── db.ts            # PostgreSQL connection
    ├── digest.ts        # New-video digest generator (TAV-14)
    ├── embeddings.ts    # Local hashing vectorizer
    ├── export.ts        # Markdown/JSON export (TAV-11)
    ├── metrics.ts       # Metrics queries
    ├── music-classifier.ts  # Music channel detection
    ├── repo.ts          # Channel/folder/tag data access
    ├── schema.ts        # PostgreSQL schema definition
    ├── summarize.ts     # LLM summarizer (TAV-4, TAV-8)
    ├── sync.ts          # Channel sync from YouTube
    ├── tokens.ts        # OAuth token management
    ├── transcript.ts    # Innertube transcript fetcher
    ├── types.ts         # Shared TypeScript types
    ├── vector-store.ts  # Embedding storage + search (TAV-5, TAV-10)
    ├── video-repo.ts    # Video + summary data access
    ├── video-sync.ts    # Video sync logic
    └── youtube.ts       # YouTube Data API client
```

---

## Getting started

```bash
# Install dependencies
pnpm install

# Set up environment variables
# - YOUTUBE_CLIENT_ID, YOUTUBE_CLIENT_SECRET (OAuth)
# - OPENROUTER_API_KEY (LLM)
# - DATABASE_URL (PostgreSQL)

# Run the database migrations (schema is applied on first connect)

# Start the dev server
pnpm dev
```

Open `http://localhost:3000`, connect your YouTube account, sync, and start summarizing.

---

*1minyt is a self-hosted tool. Your data stays in your Postgres database; the only external calls are to the YouTube Data API and your chosen LLM provider.*
