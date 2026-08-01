import Link from 'next/link';
import { HeaderBar } from '../_components/HeaderBar';
import { listSummarizedVideos } from '@/lib/video-repo';
import { isConnected, getUserProfile } from '@/lib/tokens';
import { formatRelative, youtubeVideoUrl } from '../_lib/format';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: '1minyt — Summarized videos',
  description: 'Every video you have summarized, most recent first.',
};

export default async function SummarizedPage() {
  const [connected, profile, items] = await Promise.all([
    isConnected(),
    getUserProfile(),
    listSummarizedVideos(),
  ]);

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <HeaderBar connected={connected} profile={profile} />
      <main style={{ padding: '24px 32px', maxWidth: 900, margin: '0 auto', width: '100%' }}>
        <div style={{ marginBottom: 14 }}>
          <Link href="/" style={{ color: '#8b8b94', fontSize: 13, textDecoration: 'none' }}>← Back to subscriptions</Link>
        </div>

        <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 4 }}>✦ Summarized videos</h1>
        <p style={{ color: '#8b8b94', fontSize: 13, marginBottom: 24 }}>
          Every video with a cached summary, sorted by most recently summarized.
        </p>

        {items.length === 0 ? (
          <div
            style={{
              marginTop: 48,
              padding: 32,
              textAlign: 'center',
              color: '#8b8b94',
              fontSize: 14,
              border: '1px dashed #2a2a33',
              borderRadius: 12,
              background: '#15151a',
            }}
          >
            <div style={{ fontSize: 32, marginBottom: 8 }}>✦</div>
            <div>No summaries yet — open any channel and tap ⚡ Summarize on a video to generate one.</div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {items.map(({ summary, video, channelTitle }) => (
              <div
                key={summary.id}
                style={{
                  border: '1px solid #2a2a33',
                  borderRadius: 12,
                  background: '#15151a',
                  padding: 16,
                }}
              >
                <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                  {video.thumbnail_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={video.thumbnail_url}
                      alt={video.title}
                      style={{ width: 120, height: 68, objectFit: 'cover', borderRadius: 8, background: '#1f1f26', flexShrink: 0 }}
                    />
                  ) : (
                    <div style={{ width: 120, height: 68, borderRadius: 8, background: '#1f1f26', flexShrink: 0 }} />
                  )}
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <a
                      href={youtubeVideoUrl(video.video_id)}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ color: '#e7e7ea', textDecoration: 'none', fontWeight: 600, fontSize: 14, display: 'block' }}
                    >
                      {video.title}
                    </a>
                    <div style={{ color: '#8b8b94', fontSize: 12, marginTop: 4, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                      <Link
                        href={`/c/${video.channel_id}`}
                        style={{ color: '#7db5ff', textDecoration: 'none' }}
                      >
                        {channelTitle}
                      </Link>
                      {video.duration_seconds != null && <span>{formatDuration(video.duration_seconds)}</span>}
                      <span>summarized {formatRelative(summary.created_at)}</span>
                    </div>
                  </div>
                </div>

                <div style={{ marginTop: 12 }}>
                  <div style={{ textTransform: 'uppercase', letterSpacing: '0.06em', fontSize: 11, color: '#8b8b94', marginBottom: 4 }}>TL;DR</div>
                  <div style={{ color: '#e7e7ea', fontSize: 14, lineHeight: 1.5 }}>{summary.tldr}</div>
                </div>

                {summary.key_points.length > 0 && (
                  <div style={{ marginTop: 10 }}>
                    <div style={{ textTransform: 'uppercase', letterSpacing: '0.06em', fontSize: 11, color: '#8b8b94', marginBottom: 6 }}>Key points</div>
                    <ul style={{ margin: 0, paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 4 }}>
                      {summary.key_points.map((p, i) => (
                        <li key={i} style={{ color: '#c2c2cb', fontSize: 13, lineHeight: 1.5 }}>{p}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {summary.topics.length > 0 && (
                  <div style={{ marginTop: 10, display: 'inline-flex', gap: 4, flexWrap: 'wrap' }}>
                    {summary.topics.map(t => (
                      <span
                        key={t}
                        style={{
                          fontSize: 11,
                          padding: '1px 7px',
                          borderRadius: 999,
                          background: 'rgba(91,158,255,0.12)',
                          color: '#7db5ff',
                          border: '1px solid rgba(91,158,255,0.25)',
                          textTransform: 'lowercase',
                        }}
                      >
                        {t}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}
