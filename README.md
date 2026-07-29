# 1minyt — Subscriptions

> Phase 1 foundation (TAV-3): organize, search, and curate your YouTube subscriptions.

This is the foundation ticket for the 1minyt product — the app that turns your
flat, polluted YouTube subscription feed into something you can actually use.
Everything else (instant summaries, chat-with-video, metrics) builds on top of
the data model and UI in this repo.

---

## What it does

- **Pulls your subscriptions** from the YouTube Data API (OAuth, one-time
  authorization, refresh token persisted locally).
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

## Stack

| Layer        | Choice                                  | Why                                       |
|--------------|------------------------------------------|--------------------------------------------|
| App          | Next.js 15 (App Router, RSC)            | Server-rendered, fast, no API routes for most UI |
| Database     | SQLite (`better-sqlite3`)                | Zero-setup, single-file, easy to back up   |
| Auth         | Google OAuth (`google-auth-library`)     | `subscriptions.list?mine=true` requires it |
| API          | `googleapis` YouTube Data API v3         | First-party SDK, no scraping                |
| Styling      | Tailwind 3 + a few CSS variables         | Dark UI without a UI library                |

Everything runs locally on your own machine — no third-party servers touch
your subscription data.

## Run it

### 1. Install

```bash
cd app
npm install
```

### 2. Set up Google OAuth

1. Visit https://console.cloud.google.com/
2. Create a new project (or pick an existing one).
3. **APIs & Services → Library → search "YouTube Data API v3" → Enable**.
4. **APIs & Services → Credentials → Create Credentials → OAuth client ID**.
   - Application type: **Web application**
   - Authorized redirect URI: `http://localhost:3000/api/oauth/callback`
     (add additional URIs for any other port/host you use)
5. Copy the **Client ID** and **Client Secret**.

### 3. Configure

```bash
cp .env.example .env.local
```

Edit `.env.local`:

```
YOUTUBE_CLIENT_ID=...apps.googleusercontent.com
YOUTUBE_CLIENT_SECRET=...
YOUTUBE_REDIRECT_URI=http://localhost:3000/api/oauth/callback
```

### 4. Start

```bash
npm run dev
```

Visit **http://localhost:3000**, click **Connect YouTube**, authorize once,
then click **Sync now** in the sidebar.

### 5. (Optional) Headless sync

```bash
npm run sync
```

Useful for cron / launchd:

```cron
# /usr/local/bin/1minyt-sync — refresh every 6 hours
0 */6 * * *  cd /path/to/app && /usr/local/bin/node ./node_modules/.bin/tsx scripts/sync-subscriptions.ts >> ~/1minyt-sync.log 2>&1
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
```

DB lives at `./data/1minyt.db` by default — override with `DATABASE_PATH`.

## Verify

```bash
npm run typecheck   # tsc --noEmit
npm run smoke       # exercise the DB layer against a /tmp DB
npx tsx scripts/test-classifier.ts   # exercise the music classifier
```

## Project structure

```
app/
├── package.json
├── next.config.mjs
├── tailwind.config.ts
├── scripts/
│   ├── smoke-test.ts          # exercises DB layer
│   ├── test-classifier.ts     # exercises music classifier
│   └── sync-subscriptions.ts  # CLI sync (for cron)
└── src/
    ├── app/
    │   ├── page.tsx           # main UI (sidebar + list)
    │   ├── actions.ts         # server actions (sync, CRUD)
    │   ├── c/[id]/page.tsx    # channel detail / editor
    │   ├── api/
    │   │   ├── oauth/start/   # kicks off Google consent
    │   │   ├── oauth/callback # persists tokens
    │   │   └── sync/          # POST /api/sync for cron
    │   └── _components/       # UI pieces (RSC + 'use client')
    └── lib/
        ├── db.ts              # better-sqlite3 singleton
        ├── schema.ts          # DDL + indexes
        ├── repo.ts            # CRUD + queries
        ├── queries.ts         # aggregated counts
        ├── tokens.ts          # OAuth token storage + refresh
        ├── youtube.ts         # googleapis client
        ├── sync.ts            # sync orchestrator
        ├── music-classifier.ts# music / not-music heuristic
        ├── types.ts           # shared domain types
        └── id.ts              # ULID-ish generator
```

## Out of scope (Phase 1)

- Multi-user / signup (single-user by design)
- Mobile UI (desktop-first; will be responsive in Phase 2)
- Auto re-sync (cron / manual only)
- 1-click summaries, chat with video, metrics dashboard (Tickets 2/3/4)

## Known limitations

- **Music classifier is heuristic.** It catches the obvious cases (VEVO
  channels, " - Topic" auto-gen, `/m/04rlf` topic). Edge cases — e.g. an
  artist with a normal custom URL — may need a manual override via the
  per-channel Music Classification card.
- **No automatic refresh.** Phase 1 expects manual sync or a cron job.
- **Quota.** YouTube Data API v3 has a 10k unit/day default quota. A typical
  sync of 500 subscriptions costs ~30 units (1 per `channels.list` call of
  50 ids). Easy to stay under.
- **No delta sync.** Every sync walks the full subscriptions list. Fine for
  <5000 subs; will want delta queries in Phase 2.

## License

Personal project, do what you like.