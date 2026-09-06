# 1minyt — Subscriptions

> Phase 1 foundation (TAV-3): organize, search, and curate your YouTube subscriptions.
> Phase 2 (TAV-4): 1-Click Instant Summaries — transcript + LLM summarization, inline.

This is the foundation ticket for the 1minyt product — the app that turns your
flat, polluted YouTube subscription feed into something you can actually use.
Everything else (instant summaries, chat-with-video, metrics) builds on top of
the data model and UI in this repo.

---

## What it does

- **Pulls your subscriptions** from the YouTube Data API (OAuth, one-time
  authorization, refresh token persisted in Postgres).
- **Auto-classifies music channels** by topic category, title pattern,
  custom URL, and keywords — then lets you filter them out of your main view
  with a single toggle.
- **Folders** with color tags (e.g. `Watch Later`, `Cooking`, `Tech`).
- **Tags** for finer-grained grouping (`deep-dive`, `tutorial`, `news`).
- **Search & sort** across title, handle, and description; sort by A→Z,
  subscriber count, video count, recently subscribed, or recently updated.
- **Soft-hide** channels you want out of the way without unsubscribing on
  YouTube.
- **Per-channel notes** so you remember why you subscribed.
- **CLI sync** for cron / launchd jobs that keep the library fresh.
- **1-Click Instant Summaries (TAV-4):** open any channel, hit ⚡ Summarize on a
  video, and get an inline TL;DR + key points + recommended follow-ups in
  seconds. Transcripts and summaries are cached, so re-clicks are instant.
- **Chat with Video (TAV-5):** ask questions about a video grounded in its
  transcript via RAG — answers include timestamp citations.
- **Chat with Your Library (TAV-63):** ask anything across *every* indexed
  video at once. Retrieval runs over all transcript + summary chunks, and the
  scope picker narrows it to a folder, tag, or single channel — "chat with my
  Tech folder". Answers cite the video, channel, and timestamp.
- **Deep Research agent (TAV-65):** agent mode gives the model its own tools
  (`search_transcripts`, `search_summaries`, `list_channels`,
  `get_channel_profile`) so it can plan multi-step research over your
  subscriptions before answering. The tool calls it made are shown under each
  answer.
- **Channel Memory (TAV-64):** distill any channel's cached summaries into a
  long-term dossier (beat, perspective, recurring themes) that library chat
  injects as context when you ask about that channel.
- **Topic Mind Map (TAV-66):** every summary's topic tags feed a living topic
  graph — force-directed, interactive, with co-occurrence edges — so you can
  see what your subscriptions collectively talk about and jump from a topic
  straight to its videos.
- **Metrics dashboard (TAV-6):** see your most-engaged channels, videos, and
  topics.

## Stack

| Layer        | Choice                                  | Why                                       |
|--------------|------------------------------------------|--------------------------------------------|
| App          | Next.js 16 (App Router, RSC)            | Server-rendered, fast, no API routes for most UI |
| Database     | PostgreSQL (Neon)                       | Serverless Postgres — works on Netlify |
| Auth         | Google OAuth (`google-auth-library`)     | `subscriptions.list?mine=true` requires it |
| API          | `googleapis` YouTube Data API v3         | First-party SDK, no scraping                |
| LLM          | OpenRouter (`/chat/completions`)         | OpenAI-compatible, free tier available |
| Styling      | Tailwind 3 + a few CSS variables         | Dark UI without a UI library                |

## Deploy to Netlify

This app is configured for Netlify deployment out of the box.

### 1. Push to GitHub

```bash
git remote add origin <your-repo>
git push -u origin main
```

### 2. Connect on Netlify

1. Go to [netlify.com](https://app.netlify.com) → **Add new site** → **Import an existing project**.
2. Pick your GitHub repo.
3. Netlify will auto-detect Next.js via `netlify.toml`. Build command is `pnpm run build`, publish directory is `.next`.
4. **Set environment variables** under Site settings → Environment variables:

   | Variable | Value |
   |----------|-------|
   | `DATABASE_URL` | Your Neon Postgres connection string (e.g. `postgresql://...?sslmode=require`) |
   | `YOUTUBE_CLIENT_ID` | Google OAuth client ID |
   | `YOUTUBE_CLIENT_SECRET` | Google OAuth client secret |
   | `YOUTUBE_REDIRECT_URI` | `https://your-site.netlify.app/api/oauth/callback` |
   | `OPENROUTER_API_KEY` | OpenRouter API key (for summaries + chat) |

5. **Deploy.** The schema auto-creates on first DB connection — no manual migration needed.

### 3. Google OAuth redirect URI

In Google Cloud Console → Credentials → your OAuth client, add:
- `https://your-site.netlify.app/api/oauth/callback`

## Run it locally

### 1. Install

```bash
pnpm install
```

### 2. Set up Google OAuth

1. Visit https://console.cloud.google.com/
2. Create a new project (or pick an existing one).
3. **APIs & Services → Library → search "YouTube Data API v3" → Enable**.
4. **APIs & Services → Credentials → Create Credentials → OAuth client ID**.
   - Application type: **Web application**
   - Authorized redirect URI: `http://localhost:3000/api/oauth/callback`
5. Copy the **Client ID** and **Client Secret**.

### 3. Configure

```bash
cp .env.example .env.local
```

Edit `.env.local`:

```
DATABASE_URL=postgresql://user:password@host:5432/dbname?sslmode=require
YOUTUBE_CLIENT_ID=...apps.googleusercontent.com
YOUTUBE_CLIENT_SECRET=...
YOUTUBE_REDIRECT_URI=http://localhost:3000/api/oauth/callback
OPENROUTER_API_KEY=...
```

### 4. Start

```bash
pnpm dev
```

Visit **http://localhost:3000**, click **Connect YouTube**, authorize once,
then click **Sync now** in the sidebar. The database schema auto-creates on first run.

### 5. (Optional) Headless sync

```bash
pnpm sync
```

## Data model

```
channels               per subscribed channel (id, title, handle, stats, music_flag, hidden, notes, ...)
folders                user-defined collections
tags                   free-form labels
channel_folders        many-to-many
channel_tags           many-to-many
sync_runs              history of every sync attempt (status, error, counts)
oauth_tokens           single-user refresh tokens (user_id="me")
videos                 cached recent uploads per channel (with transcript)
summaries              one per (video, model) — LLM-generated TL;DR + key points
transcript_segments    timestamped caption cues for chat RAG
transcript_chunks      embedded chunks for vector search (BYTEA embeddings)
chat_messages          conversation history per video
library_chat_messages  /chat threads, one per scope ('all', 'channel:<id>', ...)
channel_dossiers       per-channel LLM "memory" distilled from its summaries
```

## Verify

```bash
pnpm typecheck      # tsc --noEmit
pnpm smoke          # exercise the DB layer against your Postgres instance
pnpm run lint       # ESLint
pnpm run build      # Next.js production build
```

## Project structure

```
├── package.json
├── next.config.mjs
├── netlify.toml           # Netlify deployment config
├── tailwind.config.ts
├── scripts/
│   ├── smoke-test.ts       # exercises DB layer
│   ├── test-classifier.ts  # exercises music classifier
│   └── sync-subscriptions.ts # CLI sync (for cron)
└── src/
    ├── app/
    │   ├── page.tsx        # main UI (sidebar + list)
    │   ├── actions.ts      # server actions (sync, CRUD, chat, topics)
    │   ├── c/[id]/page.tsx # channel detail / editor
    │   ├── chat/page.tsx   # library-wide chat (scoped, agent mode)
    │   ├── topics/page.tsx # topic mind map
    │   ├── metrics/page.tsx# metrics dashboard
    │   ├── api/
    │   │   ├── oauth/start/   # kicks off Google consent
    │   │   ├── oauth/callback # persists tokens
    │   │   └── sync/          # POST /api/sync for cron
    │   └── _components/       # UI pieces (RSC + 'use client')
    └── lib/
        ├── db.ts              # pg Pool singleton + schema init
        ├── schema.ts          # Postgres DDL
        ├── repo.ts            # CRUD + queries (async)
        ├── queries.ts         # aggregated counts (async)
        ├── tokens.ts          # OAuth token storage + refresh (async)
        ├── youtube.ts         # googleapis client
        ├── sync.ts            # sync orchestrator
        ├── video-sync.ts      # video upload sync
        ├── video-repo.ts      # video + summary persistence (async)
        ├── vector-store.ts    # local vector store for RAG (async)
        ├── embeddings.ts      # local hashing vectorizer
        ├── transcript.ts      # YouTube transcript fetcher
        ├── summarize.ts       # LLM summarizer (+ playlist, dossier synthesis)
        ├── chat.ts            # RAG chat over a single video's transcript
        ├── library-chat.ts    # library-wide chat: scoped RAG + agent tool loop
        ├── library-chat-repo.ts # /chat threads + channel dossier storage
        ├── dossier.ts         # channel "memory" orchestration (TAV-64)
        ├── topics.ts          # topic graph builder for the mind map (TAV-66)
        ├── music-classifier.ts# music / not-music heuristic
        ├── types.ts           # shared domain types
        └── id.ts              # ULID-ish generator
```

## License

Personal project, do what you like.
