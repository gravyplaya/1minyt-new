import Link from 'next/link';
import { getMetrics } from '@/lib/metrics';
import type { CoverageStat, WeeklyBucket } from '@/lib/metrics';
import { AppShell } from '../_components/AppShell';
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
    <AppShell active="metrics" connected={connected} profile={profile} mainStyle={{ maxWidth: 1100, margin: '0 auto', width: '100%' }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 4 }}>📊 Your metrics</h1>
        <p style={{ color: '#8b8b94', fontSize: 13, marginBottom: 28 }}>
          Derived from your summary and chat activity. Updated automatically as you use the app.
        </p>

        {m.summary.total_interactions === 0 ? (
          <EmptyState connected={connected} />
        ) : (
          <>
            {/* TAV-24: Coverage — "are you keeping up?" */}
            <CoverageCard coverage={m.coverage} />

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
    </AppShell>
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

/**
 * TAV-24: Coverage — an honest "are you keeping up?" stat. Shows the current
 * week's coverage ratio as a progress bar, a 12-week sparkline history, and a
 * streak counter (consecutive weeks ≥50% coverage).
 */
function CoverageCard({ coverage }: { coverage: CoverageStat }) {
  const cw = coverage.current_week;
  const pct = Math.round(cw.coverage * 100);
  const hasNew = cw.new_count > 0;
  const remaining = Math.max(0, cw.new_count - cw.processed_count);

  return (
    <section style={{
      background: '#15151a',
      border: '1px solid #2a2a33',
      borderRadius: 12,
      padding: '20px 22px',
      marginBottom: 36,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
        <div>
          <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 2 }}>🎯 This week&apos;s coverage</h2>
          <p style={{ fontSize: 12, color: '#5a5a64' }}>
            Of the {cw.new_count} new {cw.new_count === 1 ? 'video' : 'videos'} synced this week, you&apos;ve processed {cw.processed_count}.
          </p>
        </div>
        {coverage.streak_weeks > 0 && (
          <div style={{
            fontSize: 12,
            fontWeight: 600,
            color: '#ffb84d',
            background: 'rgba(255, 184, 77, 0.1)',
            border: '1px solid rgba(255, 184, 77, 0.3)',
            borderRadius: 999,
            padding: '4px 12px',
            whiteSpace: 'nowrap',
          }}>
            🔥 {coverage.streak_weeks}-week streak
          </div>
        )}
      </div>

      {/* Progress bar */}
      <div style={{ marginBottom: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
          <span style={{ fontSize: 12, color: '#8b8b94' }}>
            {hasNew ? `${cw.processed_count} / ${cw.new_count} processed` : 'No new videos this week'}
          </span>
          <span style={{
            fontSize: 13,
            fontWeight: 700,
            color: !hasNew ? '#5a5a64' : pct >= 50 ? '#5cd9a3' : pct >= 25 ? '#ffb84d' : '#ff7b7b',
          }}>
            {hasNew ? `${pct}%` : '—'}
          </span>
        </div>
        <div style={{
          height: 8,
          borderRadius: 4,
          background: '#0c0c0f',
          overflow: 'hidden',
          border: '1px solid #2a2a33',
        }}>
          <div style={{
            height: '100%',
            width: `${hasNew ? Math.max(2, pct) : 0}%`,
            borderRadius: 4,
            background: !hasNew ? 'transparent'
              : pct >= 50 ? 'linear-gradient(90deg, #3da888, #5cd9a3)'
              : pct >= 25 ? 'linear-gradient(90deg, #d9a83d, #ffb84d)'
              : 'linear-gradient(90deg, #d94d4d, #ff7b7b)',
            transition: 'width .4s ease',
          }} />
        </div>
        {hasNew && remaining > 0 && (
          <p style={{ fontSize: 11, color: '#5a5a64', marginTop: 6 }}>
            {remaining} {remaining === 1 ? 'video' : 'videos'} left to process this week.
          </p>
        )}
      </div>

      {/* 12-week history sparkline */}
      {coverage.history.length > 1 && (
        <div>
          <div style={{ fontSize: 11, color: '#5a5a64', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
            Last 12 weeks
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 44 }}>
            {coverage.history.map((wk, i) => {
              const h = Math.max(3, Math.round(wk.coverage * 40));
              const isCurrent = i === 0;
              return (
                <div key={wk.week_start} title={coverageTooltip(wk, isCurrent)} style={{
                  flex: 1,
                  minWidth: 0,
                  height: h,
                  borderRadius: 3,
                  background: wk.new_count === 0 ? '#2a2a33'
                    : wk.coverage >= 0.5 ? '#5cd9a3'
                    : wk.coverage >= 0.25 ? '#ffb84d' : '#ff7b7b',
                  opacity: isCurrent ? 1 : 0.65,
                  border: isCurrent ? '1px solid #5b9eff' : 'none',
                }} />
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}

function coverageTooltip(wk: WeeklyBucket, isCurrent: boolean): string {
  const pct = Math.round(wk.coverage * 100);
  const date = new Date(wk.week_start * 1000).toISOString().slice(0, 10);
  const label = isCurrent ? 'This week' : `Week of ${date}`;
  if (wk.new_count === 0) return `${label} — no new videos`;
  return `${label} — ${wk.processed_count}/${wk.new_count} (${pct}%)`;
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
