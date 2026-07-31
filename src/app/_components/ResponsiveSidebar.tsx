'use client';

import { useState, type ReactNode } from 'react';

/**
 * Wraps the sidebar so it becomes a slide-in drawer on mobile (≤768px).
 * On desktop the <aside> renders normally in the grid with its inline styles.
 * On mobile, CSS .sidebar overrides position/transform to hide it off-screen,
 * and the toggle button becomes visible to open the drawer.
 */
export function ResponsiveSidebar({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        className="btn sidebar-toggle"
        onClick={() => setOpen(true)}
        aria-label="Open filters"
        style={{ marginBottom: 12, width: '100%', justifyContent: 'center', padding: '10px 16px', fontSize: 14 }}
      >
        ☰  Filters & Folders
      </button>
      {open && <div className="sidebar-overlay" onClick={() => setOpen(false)} />}
      <aside
        className={`sidebar${open ? ' sidebar-open' : ''}`}
        style={{ borderRight: '1px solid #2a2a33', background: '#0e0e12', padding: '20px 16px', display: 'flex', flexDirection: 'column', gap: 24 }}
      >
        <button
          className="btn btn-ghost sidebar-close"
          onClick={() => setOpen(false)}
          aria-label="Close sidebar"
          style={{ position: 'absolute', top: 12, right: 12, fontSize: 16, padding: '4px 8px', zIndex: 1 }}
        >
          ✕
        </button>
        {children}
      </aside>
    </>
  );
}
