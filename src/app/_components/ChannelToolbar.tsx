'use client';

import { useRouter } from 'next/navigation';

interface SortOption { value: string; label: string }

interface Props {
  search: string;
  folderId: string | null;
  tagId: string | null;
  showMusic: boolean;
  showHidden: boolean;
  sort: string;
  sortOptions: readonly SortOption[];
}

/**
 * Toolbar form. Lives on the client so the <select> can auto-submit on change.
 * Keeps the rest of ChannelList on the server.
 */
export function ChannelToolbar({ search, folderId, tagId, showMusic, showHidden, sort, sortOptions }: Props) {
  const router = useRouter();

  return (
    <form
      className="toolbar-form"
      action="/"
      method="get"
      style={{ display: 'flex', gap: 8, marginBottom: 18, flexWrap: 'wrap', alignItems: 'center' }}
    >
      <input
        className="input toolbar-search"
        type="search"
        name="q"
        defaultValue={search}
        placeholder="Search channels, handles, descriptions…"
        style={{ flex: 1, minWidth: 240 }}
      />
      {folderId && <input type="hidden" name="folder" value={folderId} />}
      {tagId && <input type="hidden" name="tag" value={tagId} />}
      {showMusic && <input type="hidden" name="showMusic" value="1" />}
      {showHidden && <input type="hidden" name="showHidden" value="1" />}
      <select
        className="input"
        name="sort"
        defaultValue={sort}
        onChange={(e) => {
          const form = e.currentTarget.form;
          if (!form) return;
          // Build query string from the form, then soft-navigate so the server
          // component re-renders with the new params.
          const params = new URLSearchParams();
          const data = new FormData(form);
          for (const [key, value] of data.entries()) {
            if (typeof value === 'string' && value !== '') params.set(key, value);
          }
          const qs = params.toString();
          router.push(qs ? `/?${qs}` : '/');
        }}
        style={{ width: 'auto', minWidth: 160 }}
      >
        {sortOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <button className="btn" type="submit">Search</button>
    </form>
  );
}
