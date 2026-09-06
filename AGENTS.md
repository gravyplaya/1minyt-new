# AGENTS.md

Guidance for AI agents (and humans) working in this repo.

## Commands

| Task | Command |
|------|---------|
| Install | `pnpm install` |
| Dev server | `pnpm dev` |
| Typecheck | `pnpm typecheck` (tsc --noEmit) |
| Lint | `pnpm run lint` |
| Production build | `pnpm run build` |
| DB smoke test | `pnpm smoke` |
| Headless subscription sync | `pnpm sync` |

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
lib/db.ts       pg Pool singleton; lib/schema.ts = DDL array; runs on first connect
lib/repo.ts     channels/folders/tags CRUD
lib/video-repo.ts  videos, summaries, per-video chat, references, chapters
lib/vector-store.ts chunking + embedding + cosine search (per-video and corpus-wide)
lib/chat.ts     per-video RAG chat (TAV-5)
lib/library-chat.ts  library-wide chat: scoped retrieval (E/F) + agent loop (H)
lib/library-chat-repo.ts  /chat threads + channel dossiers (G)
lib/dossier.ts  channel "memory" orchestration (map-reduce over summaries)
lib/topics.ts   topic graph for /topics mind map (I)
lib/summarize.ts  all LLM synthesis: video, playlist, comments, channel dossier
```

Server actions live in `src/app/actions.ts` — one section per TAV ticket. Pages never import lib logic directly when an action exists; client components call actions via `useTransition`.

## Conventions

- **Tickets:** features carry a `TAV-N` id. Current highest: TAV-66.
- **Schema migrations:** append `CREATE TABLE IF NOT EXISTS` / `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` statements to `SCHEMA_STATEMENTS` — never edit existing table definitions in place, existing DBs won't re-run them.
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

## Notes for future work

- The topic graph is computed live from `summaries.topics` (extracted at summarize time, TAV-8) — no extraction job needed; it costs zero tokens to rebuild.
- `channel_dossiers` upserts by `channel_id`; regenerate from the /chat panel ("Generate memory").
- Agent mode depends on the active OpenRouter model supporting function calling; `openrouter/free` routes to whatever free model is live, so guard for 400s and surface a friendly error (the standard RAG path always works).
