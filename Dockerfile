# 1minyt — production image for Dokploy (Netlify migration).
#
# Multi-stage build:
#   builder → full workspace install + `next build`. No env vars are needed at
#             build time: every route is force-dynamic (the root page reads
#             cookies via resolvePageUser), so nothing prerenders DB work.
#   runner  → production deps only + the compiled .next output, `next start`,
#             with ffmpeg + yt-dlp baked in so the transcript fallback chain
#             (yt-dlp → Whisper) actually works — those binaries never existed
#             on Netlify, so the fallbacks silently never ran there.
#
# Deliberately NOT using `output: 'standalone'`: next.config.mjs stays
# byte-identical for the still-live Netlify build during the cutover window,
# and plain `next start` matches the Netlify runtime 1:1.

# ---------------------------------------------------------------------------
# builder — install all workspace deps and build the Next app
# ---------------------------------------------------------------------------
FROM node:22-bookworm-slim AS builder
WORKDIR /app

# pnpm pinned to the exact version the lockfile is generated with locally,
# so `allowBuilds` in pnpm-workspace.yaml behaves identically in CI.
RUN npm install -g pnpm@12.5.1

# Manifests first so the dependency layers cache independently of source changes.
# extension/package.json must be present: pnpm-workspace.yaml lists it as a member.
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY extension/package.json extension/

# --ignore-scripts: the only workspace postinstall is the extension's
# `wxt prepare`, which loads the extension project (not shipped here — the
# extension is built for the Chrome store, not this web deploy) and would fail
# without its source. Nothing the Next build needs has an install script:
# every native dep in the build path (sharp, @next/swc, Turbopack) ships
# prebuilt platform binaries; esbuild/better-sqlite3/etc. are extension/lint
# tooling only.
RUN pnpm install --frozen-lockfile --ignore-scripts

# Build inputs: source, static assets, and the config files Next/Tailwind/PostCSS read.
COPY next.config.mjs postcss.config.mjs tailwind.config.ts tsconfig.json next-env.d.ts ./
COPY src ./src
COPY public ./public

ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm build

# ---------------------------------------------------------------------------
# runner — production deps + build output + transcript tooling
# ---------------------------------------------------------------------------
FROM node:22-bookworm-slim AS runner
WORKDIR /app

# ffmpeg: audio extraction for the yt-dlp/Whisper paths.
# python3: runtime for the yt-dlp zipapp. curl: yt-dlp download + HEALTHCHECK.
# tini: PID 1 signal handling (SIGTERM → next start shuts down cleanly).
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg python3 ca-certificates curl tini \
  && rm -rf /var/lib/apt/lists/*

# yt-dlp zipapp (platform-independent, needs python3). YouTube breaks old
# releases regularly — `latest` keeps every image rebuild fresh.
RUN curl -fsSL https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp \
  -o /usr/local/bin/yt-dlp \
  && chmod +x /usr/local/bin/yt-dlp \
  && yt-dlp --version

RUN npm install -g pnpm@12.5.1

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000

# Production deps only. --ignore-scripts skips the extension's `wxt prepare`
# postinstall (it needs dev deps we don't ship); nothing in the prod tree has
# an install script that matters (sharp ships prebuilt platform binaries).
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY extension/package.json extension/
RUN pnpm install --prod --frozen-lockfile --ignore-scripts

# Compiled app + static assets + runtime config (next start reads next.config.mjs).
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY next.config.mjs ./

EXPOSE 3000

# Anonymous GET / resolves without touching the DB, so this is a pure
# "is the server up" probe (DB outages surface as app errors, not flapping checks).
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD curl -fsS http://127.0.0.1:3000/ >/dev/null || exit 1

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["pnpm", "start"]