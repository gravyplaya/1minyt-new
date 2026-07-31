import Link from 'next/link';
import { getMetrics } from '@/lib/metrics';
import { HeaderBar } from '../_components/HeaderBar';
import { formatCount, formatRelative, youtubeVideoUrl } from '../_lib/format';
import { isConnected, getUserProfile } from '@/lib/tokens';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: '1minyt — Metrics',
  description: 'Your most-watched channels, most-summarized videos, and top topics.',
};

export default async function MetricsPage() {
  const [connected, profile, m] = await Promise.all([
    isConnected(),
    getUserProfile(),
    getMetrics(),
  ]);

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <HeaderBar connected={connected} profile={profile} />
      <main className="metrics-main" style={{ padding: '24px 32px', maxWidth: 1100, margin: '0 auto', width: '100%' }}>
        <div style={{ marginBottom: 14 }}>
          <Link href="/" style={{ color: '#8b8b94', fontSize: 13, textDecoration: 'none' }}>← Back to subscriptions</Link>
        </div>

        <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 4 }}>📊 Your metrics</h1>
        <p style={{ color: '#8b8b94', fontSize: 13, marginBottom: 28 }}>
          Derived from your summary and chat activity. Updated automatically as you use the app.
        </p>

        {m.summary.total_interactions === 0 ? (
          <EmptyState connected={connected} />
        ) : (
          <>
            {/* Headline stats */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 36 }}>
              <StatCard label="Channels interacted with" value={m.summary.total_channels} />
              <StatCard label="Videos touched" value={m.summary.total_videos_cached} />
              <StatCard label="Summaries generated" value={m.summary.total_summaries} />
              <StatCard label="Chat questions asked" value={m.summary.total_chats} />
              <StatCard label="Total interactions" value={m.summary.total_interactions} highlight />
            </div>

            <div className="metrics-grid-2" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 32, alignItems: 'start' }}>
              {/* Top channels */}
              <section>
                <h2 style={sectionHeading}>Top channels</h2>
                <p style={sectionSub}>By summaries + chat questions</p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 14 }}>
                  {m.top_channels.map((c, i) => (
                    <Link
                      key={c.channel_id}
                      href={`/c/${c.channel_id}`}
                      style={rowStyle}
                    >
                      <span style={rankStyle(i)}>{i + 1}</span>
                      {c.thumbnail_url ? (
                        <img src={c.thumbnail_url} alt="" style={thumbStyle} />
                      ) : (
                        <div style={{ ...thumbStyle, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          {c.title[0]?.toUpperCase() ?? '?'}
                        </div>
                      )}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={titleStyle}>{c.title}</div>
                        <div style={subStyle}>
                          <span style={pillStyle('summary')}>{c.summaries} summaries</span>
                          <span style={pillStyle('chat')}>{c.chats} chats</span>
                        </div>
                      </div>
                      <span style={totalStyle}>{c.total}</span>
                    </Link>
                  ))}
                </div>
              </section>

              {/* Top videos */}
              <section>
                <h2 style={sectionHeading}>Most-engaged videos</h2>
                <p style={sectionSub}>By summaries + chat questions</p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 14 }}>
                  {m.top_videos.map((v, i) => (
                    <a
                      key={v.video_id}
                      href={youtubeVideoUrl(v.video_id)}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={rowStyle}
                    >
                      <span style={rankStyle(i)}>{i + 1}</span>
                      {v.thumbnail_url ? (
                        <img src={v.thumbnail_url} alt="" style={thumbStyle} />
                      ) : (
                        <div style={{ ...thumbStyle, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          {v.title[0]?.toUpperCase() ?? '?'}
                        </div>
                      )}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={titleStyle}>{v.title}</div>
                        <div style={subStyle}>
                          <span style={pillStyle('summary')}>{v.summaries} summaries</span>
                          <span style={pillStyle('chat')}>{v.chats} chats</span>
                          {v.last_interaction && (
                            <span style={{ color: '#5a5a64', fontSize: 11 }}>
                              {formatRelative(v.last_interaction)}
                            </span>
                          )}
                        </div>
                      </div>
                      <span style={totalStyle}>{v.total}</span>
                    </a>
                  ))}
                </div>
              </section>
            </div>

            {/* Top topics */}
            {m.top_topics.length > 0 && (
              <section style={{ marginTop: 36 }}>
                <h2 style={sectionHeading}>Top topics</h2>
                <p style={sectionSub}>Folders & tags you interact with most</p>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 14 }}>
                  {m.top_topics.map(t => (
                    <div
                      key={t.id}
                      className="chip"
                      style={{
                        padding: '6px 12px',
                        fontSize: 12,
                        background: t.color ? `${t.color}22` : '#1f1f26',
                        borderColor: t.color ?? '#2a2a33',
                        color: t.color ?? '#c2c2cb',
                        gap: 8,
                      }}
                    >
                      {t.kind === 'folder' && '📁 '}
                      {t.kind === 'tag' && '#'}
                      {t.kind === 'untagged' && '• '}
                      {t.name}
                      <span style={{ color: '#5a5a64', fontSize: 11 }}>{t.total}</span>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </main>
    </div>
  );
}

// ----- sub-components + styles -----------------------------------------------

function StatCard({ label, value, highlight }: { label: string; value: number; highlight?: boolean }) {
  return (
    <div style={{
      background: highlight ? 'rgba(91, 158, 255, 0.08)' : '#15151a',
      border: `1px solid ${highlight ? 'rgba(91, 158, 255, 0.3)' : '#2a2a33'}`,
      borderRadius: 10,
      padding: '14px 16px',
    }}>
      <div style={{ fontSize: 11, color: '#8b8b94', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
        {label}
      </div>
      <div style={{ fontSize: 26, fontWeight: 700, color: highlight ? '#5b9eff' : '#e7e7ea' }}>
        {formatCount(value)}
      </div>
    </div>
  );
}

function EmptyState({ connected }: { connected: boolean }) {
  return (
    <div style={{ maxWidth: 480, margin: '40px auto', textAlign: 'center' }}>
      <div style={{ fontSize: 32, marginBottom: 8 }}>📊</div>
      <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>No interactions yet</h2>
      <p style={{ color: '#8b8b94', fontSize: 13, lineHeight: 1.5, marginBottom: 20 }}>
        {connected
          ? 'Summarize a video or chat with one — the channels, videos, and topics you engage with most will show up here.'
          : 'Connect your YouTube account first, then start summarizing and chatting with videos.'}
      </p>
      <Link href="/" className="btn btn-primary" style={{ textDecoration: 'none', padding: '8px 16px', fontSize: 13 }}>
        {connected ? 'Browse subscriptions' : 'Connect YouTube'}
      </Link>
    </div>
  );
}

const sectionHeading: React.CSSProperties = {
  fontSize: 16,
  fontWeight: 600,
};
const sectionSub: React.CSSProperties = {
  fontSize: 12,
  color: '#5a5a64',
  marginTop: 2,
};

const rowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  padding: '8px 10px',
  borderRadius: 8,
  background: '#15151a',
  border: '1px solid #2a2a33',
  textDecoration: 'none',
  color: 'inherit',
  transition: 'border-color .15s ease',
};
const thumbStyle: React.CSSProperties = {
  width: 40,
  height: 40,
  borderRadius: 6,
  objectFit: 'cover',
  background: '#1f1f26',
  flexShrink: 0,
};
const titleStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 500,
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};
const subStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  marginTop: 2,
};
const totalStyle: React.CSSProperties = {
  fontSize: 16,
  fontWeight: 700,
  color: '#5b9eff',
  flexShrink: 0,
  minWidth: 28,
  textAlign: 'right',
};

function rankStyle(index: number): React.CSSProperties {
  const medal = index === 0 ? '#ffb84d' : index === 1 ? '#c2c2cb' : index === 2 ? '#cd7f32' : '#5a5a64';
  return {
    width: 20,
    height: 20,
    borderRadius: '50%',
    background: `${medal}22`,
    color: medal,
    fontSize: 11,
    fontWeight: 700,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  };
}

function pillStyle(kind: 'summary' | 'chat'): React.CSSProperties {
  return {
    fontSize: 10,
    padding: '1px 6px',
    borderRadius: 999,
    background: kind === 'summary' ? 'rgba(91, 158, 255, .12)' : 'rgba(124, 92, 255, .12)',
    color: kind === 'summary' ? '#5b9eff' : '#7c5cff',
    whiteSpace: 'nowrap',
  };
}
