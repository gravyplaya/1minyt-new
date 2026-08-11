import Link from 'next/link';
import { countSummarizedVideos } from '@/lib/video-repo';
import { countQueued } from '@/lib/summarize-queue';

/**
 * Adaptive rail for the Library tab.
 * Groups 5 curated collections into sub-navigation:
 * Saved, Liked, History, Summarized, Summarize Later.
 * Server component — fetches badge counts.
 */

const railHeading: React.CSSProperties = {
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  fontSize: 11,
  color: '#8b8b94',
  marginBottom: 8,
  fontWeight: 600,
};

export type LibraryCollection = 'saved' | 'liked' | 'history' | 'summarized' | 'summarize-later' | 'metrics';

export async function LibraryRail({ active }: { active: LibraryCollection }) {
  const [summarizedCount, queuedCount] = await Promise.all([
    countSummarizedVideos(),
    countQueued(),
  ]);

  const items: Array<{ id: LibraryCollection; label: string; icon: string; href: string; badge?: number }> = [
    { id: 'saved', label: 'Saved', icon: '★', href: '/saved' },
    { id: 'liked', label: 'Liked', icon: '♥', href: '/likes' },
    { id: 'history', label: 'History', icon: '◷', href: '/history' },
    { id: 'summarized', label: 'Summarized', icon: '✦', href: '/summarized', badge: summarizedCount },
    { id: 'summarize-later', label: 'Summarize Later', icon: '🔖', href: '/summarize-later', badge: queuedCount },
    { id: 'metrics', label: 'Metrics', icon: '📊', href: '/metrics' },
  ];

  return (
    <aside className="rail" style={{ padding: '20px 16px', display: 'flex', flexDirection: 'column', gap: 24, overflow: 'auto' }}>
      <section>
        <h3 style={railHeading}>Collections</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {items.map((item) => (
            <Link
              key={item.id}
              href={item.href}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '6px 8px',
                borderRadius: 6,
                fontSize: 13,
                color: active === item.id ? '#fff' : '#c2c2cb',
                background: active === item.id ? '#1f1f26' : 'transparent',
                textDecoration: 'none',
              }}
            >
              <span>{item.icon}</span>
              <span>{item.label}</span>
              {item.badge != null && item.badge > 0 && (
                <span style={{ marginLeft: 'auto', fontSize: 11, color: '#8b8b94' }}>{item.badge}</span>
              )}
            </Link>
          ))}
        </div>
      </section>
    </aside>
  );
}
