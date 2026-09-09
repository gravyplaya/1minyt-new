# AGENTS.md

Guidance for AI agents (and humans) working in this repo.

## Commands

| Task | Command |
|------|---------|
| Install | `pnpm install` |
| Dev server | `pnpm dev` |
| Typecheck | `pnpm typecheck` (tsc --noEmit, includes `extension/`) |
| Lint | `pnpm run lint` |
| Production build | `pnpm run build` |
| DB smoke test | `pnpm smoke` |
| Headless subscription sync | `pnpm sync` |
| Extension dev (HMR) | `pnpm -C extension dev` |
| Extension build (MV3) | `pnpm -C extension build` → `extension/dist/chrome-mv3` |
| Extension zip (store) | `pnpm -C extension zip` |

Always run `pnpm typecheck` and `pnpm run lint` after changes. Never use npm/yarn — this project uses pnpm.

## Stack

- Next.js 16 App Router (RSC-first; `'use client'` only where interaction is needed)
- PostgreSQL (Neon) — schema auto-creates on first DB connection (see `src/lib/schema.ts`)
- Google OAuth + YouTube Data API v3 (`googleapis`)
- OpenRouter `/chat/completions` for all LLM calls (summarize, chat, dossiers)
- Tailwind 3; dark UI, mostly inline styles matching existing patterns

## Architecture map

```
app/            pages (RSC) + _components (client) + actions.ts (all server actions)
lib/auth.ts     TAV-68 sessions: getSessionUser / requireUserId / resolvePageUser / ANON_USER_ID
lib/db.ts       pg Pool singleton; lib/schema.ts = DDL array; runs on first connect (one txn + advisory lock)
lib/repo.ts     channels/folders/tags CRUD (all per-user)
lib/video-repo.ts  videos, summaries, per-video chat, references, chapters (all per-user)
lib/video-ingest.ts  ad-hoc video ingest by id (paste-a-URL + /watch fallback; Data API when connected, Innertube when anonymous)
lib/youtube-url.ts  pure YouTube URL parser → video id (TAV-67)
lib/innertube.ts  shared youtubei.js client singleton (no OAuth, no quota)
lib/vector-store.ts chunking + embedding + cosine search (per-video and corpus-wide, per-user)
lib/chat.ts     per-video RAG chat (TAV-5)
lib/library-chat.ts  library-wide chat: scoped retrieval (E/F) + agent loop (H)
lib/library-chat-repo.ts  /chat threads + channel dossiers (G)
lib/dossier.ts  channel "memory" orchestration (map-reduce over summaries)
lib/topics.ts   topic graph for /topics mind map (I)
lib/summarize.ts  all LLM synthesis: video, playlist, comments, channel dossier
lib/extension-api.ts  shared auth/CORS/response helpers for /api/extension/* (TAV-68a)
app/api/extension/  HTTP surface the browser extension calls (ingest, video, summarize, queue, search, health)
extension/      WXT MV3 workspace package (Chrome + Brave): content.ts watch-page pill, popup, options, background.ts message router + context menus
```

Server actions live in `src/app/actions.ts` — one section per TAV ticket. Pages never import lib logic directly when an action exists; client components call actions via `useTransition`.

## Conventions

- **Tickets:** features carry a `TAV-N` id. Current highest: TAV-68.
- **User scoping (TAV-68):** every data table carries `user_id`; every repo function takes the owner's user id as its FIRST parameter and every query carries a `user_id` predicate. Resolve it in actions/pages via `requireUserId()` (personal/token-spending) or `getScopedUserId()` (anonymous-tolerant — falls back to the `__anon` bucket). Never write an unscoped query against a data table.
- **Sessions (TAV-68):** opaque id cookie `1minyt_session` → `sessions` table; identity = the Google account's YouTube channel id. Sign in and Connect are the same OAuth flow; `signOutAction` ends the session, `disconnectAction` revokes the YouTube token. The pre-multiuser data pool was backfilled to the literal user `'me'` and is claimed by the first Google login after migration.
- **Extension:** `extension/` is a pnpm workspace package (WXT, MV3, Chrome + Brave — one build covers both since Brave is Chromium). Its service worker is the ONLY network client for the app's `/api/extension/*` surface; content script/popup/options message it via `lib/messages.ts`. Auth is two-layer: the shared secret `EXTENSION_API_KEY` env on the app (sent as `Authorization: Bearer`; unset = the whole extension API 404/503s) gates the surface, then data routes resolve the user from the app session cookie the extension sends with `credentials: 'include'` (`requireExtensionUser` in `lib/extension-api.ts` — friendly 401 JSON when signed out, never `requireUserId`'s redirect). New endpoints go in `src/app/api/extension/` + wrappers in `extension/lib/api.ts` + a message type in `extension/lib/messages.ts`; response types are mirrored by hand in `extension/lib/types.ts`.
- **Schema migrations:** append `CREATE TABLE IF NOT EXISTS` / `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` statements to `SCHEMA_STATEMENTS` — never edit existing table definitions in place, existing DBs won't re-run them. For constraint surgery, use the guarded `DO`-block builders at the top of `schema.ts` (`scopedPrimaryKey` / `scopedForeignKey` / `scopedIndex`) so statements stay idempotent; the whole array runs in one transaction under `pg_advisory_xact_lock`.
- **Embeddings:** local hashing vectorizer (`lib/embeddings.ts`), stored as BYTEA `Float32Array` in `transcript_chunks` with a `chunk_type` of `'transcript'` or `'summary'`. Cosine similarity is computed in JS — fine at hundreds-to-thousands of chunks; revisit if the corpus grows 10x.
- **LLM calls:** always via `https://openrouter.ai/api/v1/chat/completions`, key `OPENROUTER_API_KEY`, model `SUMMARY_MODEL`/`CHAT_MODEL` env override, default `openrouter/free`. Structured output uses `response_format: { type: 'json_object' }` + fence-tolerant parsing.
- **Scopes:** library-chat scope strings are `'all' | 'channel:<id>' | 'folder:<id>' | 'tag:<id>'` — parse with `parseScope` in `library-chat.ts`; never hand-roll.
- **Comments:** match the existing style — block comment header per file explaining the ticket and the flow.

## Key features and where they live

| Feature | Ticket | Backend | UI |
|---------|--------|---------|----|
| 1-Click summaries | TAV-4 | `summarize.ts`, `video-repo.ts` | VideoSummaryRow |
| Chat with a video | TAV-5 | `chat.ts` + `vector-store.ts` | VideoChatPanel |
| Cross-video transcript search | TAV-10 | `vector-store.searchAcross` | /search |
| Library chat (all/scoped) | TAV-63 (E/F) | `library-chat.ts`, `library-chat-repo.ts` | /chat, LibraryChatPanel |
| Deep Research agent | TAV-65 (H) | `chatWithLibraryAgent` in `library-chat.ts` | /chat (Deep Research toggle) |
| Channel memory dossiers | TAV-64 (G) | `dossier.ts`, `summarize.synthesizeChannelDossier` | /chat (scoped to channel) |
| Topic mind map | TAV-66 (I) | `topics.ts` | /topics, TopicGraphView |
| Paste a YouTube URL | TAV-67 | `youtube-url.ts`, `video-ingest.ts` (Innertube path = no sign-in) | HeaderBar PasteUrlBox, landing hero, /watch |
| Multi-user sessions + isolation | TAV-68 | `auth.ts`, user_id on all tables, per-user repos/actions | HeaderBar Sign in/out, all pages scoped |
| Browser extension | TAV-68 (a–g) | `src/app/api/extension/*` + `src/lib/extension-api.ts` | `extension/` — watch-page pill (content.ts), popup, options, context menus; landing feature section + download CTA (TAV-68g, LandingPage.tsx — href still a placeholder pending the Chrome Web Store listing) |

## Notes for future work

- The topic graph is computed live from `summaries.topics` (extracted at summarize time, TAV-8) — no extraction job needed; it costs zero tokens to rebuild.
- `channel_dossiers` upserts by (user, channel); regenerate from the /chat panel ("Generate memory").
- Agent mode depends on the active OpenRouter model supporting function calling; `openrouter/free` routes to whatever free model is live, so guard for 400s and surface a friendly error (the standard RAG path always works).
- TAV-68 legacy note: the pre-multiuser data pool (everything backfilled to user id `'me'`) is claimed by the first Google login after the migration deploys — the owner should log in before inviting anyone. Anonymous paste/watch activity lands in the shared `__anon` bucket (public metadata + transcripts only).
- `pnpm sync`, `pnpm sync:videos`, and `POST /api/sync` (optional `CRON_SECRET` header) iterate ALL connected users, one sync per user with per-user error isolation.
- Postgres RLS as defense-in-depth under the app-level scoping is a possible future hardening pass — not currently configured.
