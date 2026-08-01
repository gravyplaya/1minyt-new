'use client';

import { useRouter } from 'next/navigation';

/**
 * A filter `<select>` that navigates to a new URL on change. Used by the inbox
 * page for channel/topic filters — server components can't use window.location,
 * so this tiny client wrapper handles the navigation with next/router.
 *
 * Instead of receiving a `buildHref` function (which can't cross the
 * server→client boundary), it receives the serializable `baseQuery` object
 * and the `filterKey` it controls, then builds the URL client-side.
 */
export function FilterSelect({
  value,
  options,
  baseQuery,
  filterKey,
  style,
}: {
  value: string;
  options: { value: string; label: string }[];
  baseQuery: Record<string, string>;
  filterKey: string;
  style?: React.CSSProperties;
}) {
  const router = useRouter();
  return (
    <select
      className="input inbox-filter-select"
      defaultValue={value}
      style={style}
      onChange={(e) => {
        const merged = { ...baseQuery };
        const v = e.target.value;
        if (v === 'all') delete merged[filterKey];
        else merged[filterKey] = v;
        merged.page = '1'; // any filter change resets to page 1
        const qs = new URLSearchParams(merged).toString();
        router.push(qs ? `/inbox?${qs}` : '/inbox');
      }}
    >
      {options.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  );
}
