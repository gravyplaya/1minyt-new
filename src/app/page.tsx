import {
  countChannels,
  CHANNEL_PAGE_SIZE,
  PAGE_SIZE_OPTIONS,
} from "@/lib/queries";
import { listFolders, listTags, latestSyncRun } from "@/lib/repo";
import { isConnected, getUserProfile } from "@/lib/tokens";
import { HeaderBar } from "./_components/HeaderBar";
import { ChannelList } from "./_components/ChannelList";
import { GlobalSidebar } from "./_components/GlobalSidebar";
import { LandingPage } from "./_components/landing/LandingPage";

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
  ] = await Promise.all([
    isConnected(),
    getUserProfile(),
    latestSyncRun(),
    listFolders(),
    listTags(),
    countChannels(),
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
        <GlobalSidebar
          active="home"
          activeFolder={activeFolder}
          activeTag={activeTag}
          showMusic={showMusic}
          showHidden={showHidden}
        />

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
