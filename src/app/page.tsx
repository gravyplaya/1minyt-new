import Link from "next/link";
import {
  countChannels,
  CHANNEL_PAGE_SIZE,
  PAGE_SIZE_OPTIONS,
} from "@/lib/queries";
import { listFolders, listTags, latestSyncRun } from "@/lib/repo";
import { isConnected, getUserProfile } from "@/lib/tokens";
import { countInboxNew } from "@/lib/inbox";
import { countQueued } from "@/lib/summarize-queue";
import { countSummarizedVideos } from "@/lib/video-repo";
import { AddFolderForm, AddTagForm } from "./_components/AddFolderTagForms";
import { HeaderBar } from "./_components/HeaderBar";
import { ChannelList } from "./_components/ChannelList";
import { ResponsiveSidebar } from "./_components/ResponsiveSidebar";

interface PageProps {
  searchParams: Promise<{
    q?: string;
    folder?: string;
    tag?: string;
    sort?: string;
    dir?: string;
    showMusic?: string;
    showHidden?: string;
    page?: string;
    pageSize?: string;
  }>;
}

export default async function HomePage({ searchParams }: PageProps) {
  const params = await searchParams;
  const [
    connected,
    profile,
    lastSync,
    folders,
    tags,
    counts,
    inboxCount,
    queuedCount,
    summarizedCount,
  ] = await Promise.all([
    isConnected(),
    getUserProfile(),
    latestSyncRun(),
    listFolders(),
    listTags(),
    countChannels(),
    countInboxNew(),
    countQueued(),
    countSummarizedVideos(),
  ]);

  const activeFolder = params.folder ?? null;
  const activeTag = params.tag ?? null;
  const search = params.q ?? "";
  const showMusic = params.showMusic === "1";
  const showHidden = params.showHidden === "1";
  const sort =
    (params.sort as
      | "recent"
      | "alpha"
      | "alpha-desc"
      | "subscribers"
      | "videos"
      | "updated") ?? "alpha";
  const dir = (params.dir as "asc" | "desc") ?? undefined;
  const page = Math.max(1, parseInt(params.page ?? "1", 10) || 1);
  const pageSize = PAGE_SIZE_OPTIONS.includes(
    Number(params.pageSize) as (typeof PAGE_SIZE_OPTIONS)[number],
  )
    ? Number(params.pageSize)
    : CHANNEL_PAGE_SIZE;

  const baseQuery: Record<string, string> = {};
  if (search) baseQuery.q = search;
  if (activeFolder) baseQuery.folder = activeFolder;
  if (activeTag) baseQuery.tag = activeTag;
  if (showMusic) baseQuery.showMusic = "1";
  if (showHidden) baseQuery.showHidden = "1";
  if (sort !== "alpha") baseQuery.sort = sort;
  if (dir) baseQuery.dir = dir;
  if (pageSize !== CHANNEL_PAGE_SIZE) baseQuery.pageSize = String(pageSize);

  function urlWith(
    overrides: Record<string, string | null | undefined>,
  ): string {
    const merged = { ...baseQuery };
    for (const [k, v] of Object.entries(overrides)) {
      if (v == null) delete merged[k];
      else merged[k] = v;
    }
    const qs = new URLSearchParams(merged).toString();
    return qs ? `/?${qs}` : "/";
  }

  return (
    <div
      style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}
    >
      <HeaderBar connected={connected} profile={profile} lastSync={lastSync?.started_at ?? null} />

      {!connected ? (
        <LandingPage />
      ) : (
      <div
        className="app-grid"
        style={{ display: "grid", gridTemplateColumns: "280px 1fr", flex: 1 }}
      >
        {/* Sidebar */}
        <ResponsiveSidebar>
          <section>
            <h3 style={sidebarHeading}>Library</h3>
            <SidebarLink href="/inbox" active={false}>
              <span>📥</span> Inbox{" "}
              {inboxCount > 0 && <Badge>{inboxCount}</Badge>}
            </SidebarLink>
            <SidebarLink href="/summarized" active={false}>
              <span>✦</span> Summarized{" "}
              {summarizedCount > 0 && <Badge>{summarizedCount}</Badge>}
            </SidebarLink>
            <SidebarLink href="/summarize-later" active={false}>
              <span>🔖</span> Summarize Later{" "}
              {queuedCount > 0 && <Badge>{queuedCount}</Badge>}
            </SidebarLink>
            <SidebarLink href="/search" active={false}>
              <span>🔍</span> Search
            </SidebarLink>
            <SidebarLink href="/saved" active={false}>
              <span>★</span> Saved
            </SidebarLink>
            <SidebarLink href="/digests" active={false}>
              <span>📋</span> Digests
            </SidebarLink>
            <SidebarLink href="/metrics" active={false}>
              <span>📊</span> Metrics
            </SidebarLink>
            <SidebarLink href="/settings" active={false}>
              <span>⚙</span> Settings
            </SidebarLink>
            <SidebarLink
              href={urlWith({ folder: null, tag: null, showMusic: null })}
              active={!activeFolder && !activeTag && !showMusic}
            >
              <span>📺</span> All channels <Badge>{counts.total}</Badge>
            </SidebarLink>
            <SidebarLink
              href={urlWith({ folder: "none", tag: null, showMusic: null })}
              active={activeFolder === "none"}
            >
              <span>🗂</span> Unfiled <Badge>{counts.unfiled}</Badge>
            </SidebarLink>
            <SidebarLink
              href={urlWith({ showMusic: "1", folder: null, tag: null })}
              active={showMusic}
            >
              <span>🎵</span> Music <Badge>{counts.music}</Badge>
            </SidebarLink>
            <SidebarLink
              href={urlWith({
                showHidden: showHidden ? null : "1",
                folder: null,
                tag: null,
              })}
              active={showHidden}
            >
              <span>🙈</span> Hidden <Badge>{counts.hidden}</Badge>
            </SidebarLink>
          </section>

          <section>
            <h3 style={sidebarHeading}>Folders</h3>
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              {folders.map((f: (typeof folders)[number]) => (
                <SidebarLink
                  key={f.id}
                  href={urlWith({
                    folder: activeFolder === f.id ? null : f.id,
                    tag: null,
                  })}
                  active={activeFolder === f.id}
                >
                  <span
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: "50%",
                      background: f.color ?? "#5b9eff",
                      display: "inline-block",
                    }}
                  />
                  <span style={{ flex: 1 }}>{f.name}</span>
                </SidebarLink>
              ))}
            </div>
            <div style={{ marginTop: 8 }}>
              <AddFolderForm />
            </div>
          </section>

          <section>
            <h3 style={sidebarHeading}>Tags</h3>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
              {tags.length === 0 && (
                <span style={{ color: "#5a5a64", fontSize: 12 }}>
                  no tags yet
                </span>
              )}
              {tags.map((t: (typeof tags)[number]) => (
                <Link
                  key={t.id}
                  href={urlWith({
                    tag: activeTag === t.id ? null : t.id,
                    folder: null,
                  })}
                  className="chip"
                  style={{
                    background: activeTag === t.id ? "#5b9eff" : "#1f1f26",
                    color: activeTag === t.id ? "#0a0a0c" : "#c2c2cb",
                    borderColor: activeTag === t.id ? "#5b9eff" : "#2a2a33",
                  }}
                >
                  #{t.name}
                </Link>
              ))}
            </div>
            <div style={{ marginTop: 8 }}>
              <AddTagForm />
            </div>
          </section>
        </ResponsiveSidebar>

        {/* Main */}
        <main
          className="main-content"
          style={{ padding: "24px 32px", overflow: "auto" }}
        >
          {counts.total === 0 ? (
            <FirstRunSync lastSync={lastSync} />
          ) : (
            <ChannelList
              search={search}
              folderId={activeFolder}
              tagId={activeTag}
              showMusic={showMusic}
              showHidden={showHidden}
              sort={sort}
              dir={dir}
              page={page}
              pageSize={pageSize}
              folders={folders}
              tags={tags}
              urlWith={urlWith}
            />
          )}
        </main>
      </div>
      )}
    </div>
  );
}

const sidebarHeading: React.CSSProperties = {
  textTransform: "uppercase",
  letterSpacing: "0.06em",
  fontSize: 11,
  color: "#8b8b94",
  marginBottom: 8,
  fontWeight: 600,
};

function SidebarLink({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "6px 8px",
        borderRadius: 6,
        fontSize: 13,
        color: active ? "#fff" : "#c2c2cb",
        background: active ? "#1f1f26" : "transparent",
        textDecoration: "none",
      }}
    >
      {children}
    </Link>
  );
}

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span style={{ marginLeft: "auto", fontSize: 11, color: "#8b8b94" }}>
      {children}
    </span>
  );
}

function LandingPage() {
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

  return (
    <main style={{ flex: 1, overflow: "auto" }}>
      {/* Hero */}
      <section
        style={{
          maxWidth: 800,
          margin: "0 auto",
          padding: "80px 32px 48px",
          textAlign: "center",
        }}
      >
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            padding: "6px 14px",
            borderRadius: 999,
            background: "rgba(91, 158, 255, 0.1)",
            border: "1px solid rgba(91, 158, 255, 0.25)",
            fontSize: 12,
            color: "#5b9eff",
            fontWeight: 500,
            marginBottom: 24,
          }}
        >
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#5b9eff" }} />
          Your YouTube, organized
        </div>
        <h1
          style={{
            fontSize: 44,
            fontWeight: 800,
            letterSpacing: "-0.03em",
            lineHeight: 1.1,
            marginBottom: 16,
          }}
        >
          Tame your YouTube
          <br />
          <span
            style={{
              background: "linear-gradient(135deg, #5b9eff, #7c5cff)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
              backgroundClip: "text",
            }}
          >
            subscription chaos
          </span>
        </h1>
        <p
          style={{
            fontSize: 17,
            color: "#8b8b94",
            lineHeight: 1.6,
            maxWidth: 560,
            margin: "0 auto 36px",
          }}
        >
          Connect your YouTube account once. 1minyt pulls your subscriptions,
          summarizes videos with AI, lets you search every transcript, and
          organizes everything with folders, tags, and digests.
        </p>
        <div
          style={{
            display: "flex",
            gap: 12,
            justifyContent: "center",
            flexWrap: "wrap",
          }}
        >
          <a
            className="btn btn-primary"
            href="/api/oauth/start"
            style={{ padding: "12px 28px", fontSize: 15, fontWeight: 600 }}
          >
            Connect YouTube →
          </a>
          <a
            className="btn"
            href="#features"
            style={{
              padding: "12px 28px",
              fontSize: 15,
              fontWeight: 500,
              background: "transparent",
              borderColor: "#2a2a33",
            }}
          >
            See features
          </a>
        </div>
        <p
          style={{
            fontSize: 12,
            color: "#5a5a64",
            marginTop: 20,
          }}
        >
          Free • Your data stays in your account • Disconnect anytime
        </p>
      </section>

      {/* Stats strip */}
      <section
        style={{
          maxWidth: 720,
          margin: "0 auto 64px",
          padding: "0 32px",
          display: "flex",
          justifyContent: "center",
          gap: 48,
          flexWrap: "wrap",
        }}
      >
        {[
          { label: "AI summaries", value: "One click" },
          { label: "Transcript search", value: "Every word" },
          { label: "Organization", value: "Folders + tags" },
        ].map((s) => (
          <div key={s.label} style={{ textAlign: "center" }}>
            <div
              style={{
                fontSize: 22,
                fontWeight: 700,
                color: "#e7e7ea",
                marginBottom: 4,
              }}
            >
              {s.value}
            </div>
            <div style={{ fontSize: 12, color: "#5a5a64", textTransform: "uppercase", letterSpacing: "0.06em" }}>
              {s.label}
            </div>
          </div>
        ))}
      </section>

      {/* Feature grid */}
      <section
        id="features"
        style={{ maxWidth: 1000, margin: "0 auto", padding: "0 32px 80px", scrollMarginTop: 80 }}
      >
        <h2
          style={{
            fontSize: 13,
            fontWeight: 600,
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            color: "#8b8b94",
            textAlign: "center",
            marginBottom: 32,
          }}
        >
          Everything you need to actually use your subscriptions
        </h2>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
            gap: 16,
          }}
        >
          {features.map((f) => (
            <div
              key={f.title}
              style={{
                background: "#0e0e12",
                border: "1px solid #2a2a33",
                borderRadius: 12,
                padding: "24px 20px",
                transition: "border-color .15s ease, background .15s ease",
              }}
            >
              <div
                style={{
                  fontSize: 28,
                  marginBottom: 12,
                  lineHeight: 1,
                }}
              >
                {f.icon}
              </div>
              <h3
                style={{
                  fontSize: 15,
                  fontWeight: 600,
                  marginBottom: 6,
                }}
              >
                {f.title}
              </h3>
              <p
                style={{
                  fontSize: 13,
                  color: "#8b8b94",
                  lineHeight: 1.5,
                }}
              >
                {f.desc}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section
        style={{
          maxWidth: 600,
          margin: "0 auto",
          padding: "0 32px 80px",
          textAlign: "center",
        }}
      >
        <h2
          style={{
            fontSize: 28,
            fontWeight: 700,
            letterSpacing: "-0.02em",
            marginBottom: 12,
          }}
        >
          Ready to get started?
        </h2>
        <p style={{ color: "#8b8b94", fontSize: 15, marginBottom: 28 }}>
          Connect your YouTube account in seconds. No credit card, no
          commitment.
        </p>
        <a
          className="btn btn-primary"
          href="/api/oauth/start"
          style={{ padding: "12px 32px", fontSize: 15, fontWeight: 600 }}
        >
          Connect YouTube →
        </a>
      </section>
    </main>
  );
}

function FirstRunSync({
  lastSync,
}: {
  lastSync: {
    started_at: number;
    status: string;
    channels_seen: number;
    channels_new: number;
    channels_updated: number;
    error: string | null;
  } | null;
}) {
  return (
    <div style={{ maxWidth: 540, margin: "60px auto", textAlign: "center" }}>
      <h2 style={{ fontSize: 22, fontWeight: 600, marginBottom: 8 }}>
        You&apos;re connected
      </h2>
      <p style={{ color: "#8b8b94", marginBottom: 28 }}>
        Hit <strong>Sync now</strong> in the sidebar to pull your subscriptions.
        We&apos;ll classify music channels automatically so you can hide them
        from your main view.
      </p>
      {lastSync?.error && (
        <div
          style={{
            background: "rgba(255, 99, 99, 0.1)",
            border: "1px solid rgba(255, 99, 99, 0.3)",
            padding: 12,
            borderRadius: 8,
            color: "#ff6363",
            fontSize: 13,
          }}
        >
          Last sync failed: {lastSync.error}
        </div>
      )}
    </div>
  );
}
