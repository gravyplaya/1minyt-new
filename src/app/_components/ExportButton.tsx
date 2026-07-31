'use client';

import { useState, useTransition, useRef, useEffect } from 'react';
import { exportSummariesAction, exportAllSummariesAction } from '@/app/actions';

interface Props {
  /** When set, exports a single channel. When undefined, exports all channels. */
  channelId?: string;
  /** Number of summaries in the current view — used to show a hint. */
  summaryCount?: number;
}

/**
 * TAV-11: Export button with a small dropdown offering Markdown or JSON
 * download. Uses a client-side Blob URL so no server route handler is needed.
 */
export function ExportButton({ channelId, summaryCount }: Props) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside.
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  const handleExport = (format: 'markdown' | 'json') => {
    setOpen(false);
    setError(null);
    start(async () => {
      try {
        const result = channelId
          ? await exportSummariesAction(channelId, format)
          : await exportAllSummariesAction(format);
        if (!result.ok || !result.content) {
          setError(result.error ?? 'Export failed.');
          return;
        }
        triggerDownload(result.content, result.mimeType, `${result.filenameBase}.${result.ext}`);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    });
  };

  return (
    <div ref={wrapperRef} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        type="button"
        className="btn"
        onClick={() => setOpen(o => !o)}
        disabled={pending}
        style={{ fontSize: 12 }}
        title="Export summaries"
      >
        {pending ? 'Exporting…' : 'Export ↓'}
      </button>

      {open && (
        <div
          style={{
            position: 'absolute',
            top: '100%',
            right: 0,
            marginTop: 4,
            minWidth: 150,
            background: '#15151a',
            border: '1px solid #2a2a33',
            borderRadius: 10,
            boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
            zIndex: 50,
            overflow: 'hidden',
          }}
        >
          <button
            type="button"
            onClick={() => handleExport('markdown')}
            style={dropdownItemStyle}
          >
            📄 Markdown
            <span style={{ color: '#5a5a64', fontSize: 11 }}>.md</span>
          </button>
          <button
            type="button"
            onClick={() => handleExport('json')}
            style={{ ...dropdownItemStyle, borderTop: '1px solid #2a2a33' }}
          >
            {'{ }'} JSON
            <span style={{ color: '#5a5a64', fontSize: 11 }}>.json</span>
          </button>
        </div>
      )}

      {error && (
        <span style={{ marginLeft: 8, fontSize: 12, color: '#ff6363' }}>
          ⚠ {error}
        </span>
      )}

      {summaryCount != null && summaryCount === 0 && !pending && (
        <span style={{ marginLeft: 8, fontSize: 11, color: '#5a5a64' }}>
          (no summaries yet)
        </span>
      )}
    </div>
  );
}

const dropdownItemStyle: React.CSSProperties = {
  display: 'flex',
  width: '100%',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '10px 14px',
  background: 'transparent',
  border: 'none',
  color: '#e7e7ea',
  fontSize: 13,
  cursor: 'pointer',
  textAlign: 'left',
};

/**
 * Create a Blob URL, click a temporary <a> to download it, then revoke.
 */
function triggerDownload(content: string, mimeType: string, filename: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
