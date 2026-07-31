'use client';

import { useRouter } from 'next/navigation';

interface PageSizeOption {
  value: number;
  href: string;
}

interface Props {
  pageSize: number;
  options: readonly PageSizeOption[];
}

/**
 * Small client-side dropdown for switching the page size.
 * Navigates to the precomputed href (resets to page 1) on change.
 */
export function PageSizeSelect({ pageSize, options }: Props) {
  const router = useRouter();

  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: '#8b8b94', flexShrink: 0 }}>
      <select
        className="input"
        defaultValue={String(pageSize)}
        onChange={(e) => {
          const opt = options.find(o => String(o.value) === e.target.value);
          if (opt) router.push(opt.href);
        }}
        style={{ width: 'auto', minWidth: 60, fontSize: 12, height: 30 }}
      >
        {options.map(o => <option key={o.value} value={o.value}>{o.value}</option>)}
      </select>
      <span>/ page</span>
    </label>
  );
}
