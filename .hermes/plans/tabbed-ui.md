# Tabbed UI Redesign Plan

## Goal
Replace the left sidebar + 10 flat nav links with a 5-tab top bar + an adaptive contextual rail that changes per tab.

## Tab Structure (5 tabs)

| Tab | Default Route | Routes Covered | Rail? |
|-----|--------------|----------------|-------|
| Channels | `/` | `/`, `/c/[id]` | Yes — folders/tags filter tree |
| Inbox | `/inbox` | `/inbox` | No — filters stay inline at top of page |
| Library | `/saved` | `/saved`, `/likes`, `/history`, `/summarized`, `/summarize-later` | Yes — collection sub-nav |
| Search | `/search` | `/search` | No — full width |
| Settings | `/settings` | `/settings`, `/digests` | Yes — section sub-nav (Integrations, Labs) |

## Route → Tab Mapping
```
/                  → channels
/c/[id]            → channels (no rail — channel detail is full-width)
/inbox             → inbox
/saved             → library (active=saved)
/likes             → library (active=liked)
/history           → library (active=history)
/summarized        → library (active=summarized)
/summarize-later   → library (active=summarize-later)
/search            → search
/settings          → settings (active=integrations)
/digests           → settings (active=digests)
/terms             → none (no tab — standalone page)
/privacy           → none (no tab — standalone page)
```

## Layout

```
┌──────────────────────────────────────────────────┐
│  HeaderBar (brand · sync · profile)               │  unchanged
├──────────────────────────────────────────────────┤
│  Channels | Inbox | Library | Search | Settings  │  NEW: TabBar
├──────────┬───────────────────────────────────────┤
│          │                                       │
│  RAIL    │        MAIN CONTENT                    │  rail is adaptive
│ (ctx)    │       (full width when no rail)        │  — appears/hides
│          │                                       │  per active tab
├──────────┴───────────────────────────────────────┤
│  Footer                                           │  unchanged
└──────────────────────────────────────────────────┘
```

### Rail widths
- Channels: 220px (folders/tags tree needs room)
- Library: 180px (slim sub-nav)
- Settings: 180px (slim sub-nav)
- Inbox/Search/Channel-detail: 0 (no rail, full width)

### Mobile
- Tabs: horizontal scroll strip (`overflow-x: auto`), no drawer
- Rail: collapses into a "Filters ▾" button that expands inline accordion
- Channel detail: no rail on mobile either

## Components to Create

### 1. `TabBar.tsx` (server component)
- Renders 5 tab links below the HeaderBar
- Badge counts: Inbox (countInboxNew), Library (countQueued for Summarize Later)
- Active state based on current route
- Props: `active: string` (which tab is active)
- Fetches badge counts from existing lib functions

### 2. `ChannelRail.tsx` (server component)
- Extracted from GlobalSidebar — the Folders + Tags sections only
- Shows: All channels (count), Unfiled, Music, Hidden, folder list, tag chips
- AddFolderForm / AddTagForm remain inline at bottom of each section
- Props: `activeFolder`, `activeTag`, `showMusic`, `showHidden` (same as before)
- Fetches: countChannels, listFolders, listTags

### 3. `LibraryRail.tsx` (server component)
- Sub-nav for Library tab: Saved, Liked, History, Summarized (with count), Summarize Later (with count)
- Props: `active: string` (which collection is active)
- Fetches: countSummarizedVideos, countQueued

### 4. `SettingsRail.tsx` (server component)
- Sub-nav for Settings tab: Integrations, Labs (Digests)
- Props: `active: string`

## Components to Modify

### 5. `AppShell.tsx` — rewrite
New signature:
```ts
AppShell({
  children,
  tab,            // 'channels' | 'inbox' | 'library' | 'search' | 'settings'
  connected,
  profile,
  lastSync,
  mainStyle,
  // Channel rail props (only when tab='channels')
  activeFolder?,
  activeTag?,
  showMusic?,
  showHidden?,
  // Library/Settings active sub-nav
  libraryActive?,    // 'saved' | 'liked' | 'history' | 'summarized' | 'summarize-later'
  settingsActive?,   // 'integrations' | 'digests'
  // Channel detail — disable rail
  noRail?,
})
```
Layout logic:
- Always render HeaderBar + TabBar
- If tab has a rail and `!noRail`: grid `220px 1fr` (or 180px for library/settings)
- If no rail: full width `<main>`
- Pass `mainStyle` maxWidth as before

### 6. `page.tsx` (homepage) — refactor
- Use AppShell instead of manual HeaderBar + grid
- Pass `tab="channels"` + folder/tag props
- Render ChannelList inside AppShell children

### 7. All sub-pages — update AppShell calls
Change from `active="inbox"` to `tab="inbox"`, etc.
- inbox: `tab="inbox"`
- search: `tab="search"`
- saved: `tab="library" libraryActive="saved"`
- likes: `tab="library" libraryActive="liked"`
- history: `tab="library" libraryActive="history"`
- summarized: `tab="library" libraryActive="summarized"`
- summarize-later: `tab="library" libraryActive="summarize-later"`
- settings: `tab="settings" settingsActive="integrations"`
- digests: `tab="settings" settingsActive="digests"`
- c/[id]: `tab="channels" noRail`

### 8. `globals.css` — update
- Remove: `.app-grid`, `.sidebar`, `.sidebar-open`, `.sidebar-overlay`, `.sidebar-toggle`, `.sidebar-close` rules
- Add: `.tab-bar`, `.tab-item`, `.tab-item-active`, `.rail`, `.rail-mobile-toggle` styles
- Keep: all other responsive rules (channel rows, video rows, etc.)

## Components to Delete
- `GlobalSidebar.tsx` — fully replaced by TabBar + ChannelRail
- `ResponsiveSidebar.tsx` — no longer needed (tabs scroll horizontally on mobile)

## Files Unchanged
- All `lib/` files (queries, repos, etc.)
- All page data-fetching logic
- HeaderBar.tsx
- Footer.tsx
- AddFolderTagForms.tsx (used by ChannelRail)
- All other _components (ChannelList, InboxFeed, etc.)
- terms/page.tsx, privacy/page.tsx (standalone, no AppShell)

## Implementation Order
1. Create TabBar.tsx
2. Create ChannelRail.tsx (extract from GlobalSidebar)
3. Create LibraryRail.tsx
4. Create SettingsRail.tsx
5. Rewrite AppShell.tsx
6. Update homepage page.tsx
7. Update all 11 sub-pages' AppShell calls
8. Delete GlobalSidebar.tsx + ResponsiveSidebar.tsx
9. Update globals.css
10. Lint + typecheck + build

## Badge Count Sources (existing, unchanged)
- `countInboxNew()` — `@/lib/inbox`
- `countQueued()` — `@/lib/summarize-queue`
- `countSummarizedVideos()` — `@/lib/video-repo`
- `countChannels()` — `@/lib/queries`
