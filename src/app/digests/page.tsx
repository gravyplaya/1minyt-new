import Link from 'next/link';
import { AppShell } from '../_components/AppShell';
import { GenerateDigestButton } from '../_components/GenerateDigestButton';
import { DigestVideoRow } from '../_components/DigestVideoRow';
import { latestDigestWithVideos, listRecentDigests } from '@/lib/digest';
import { isConnected, getUserProfile } from '@/lib/tokens';
import { formatDate, formatRelative } from '../_lib/format';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: '1minyt — Digests',
  description: 'New-video digest: sync all channels and see what was published since last time.',
};

export default async function DigestsPage() {
  const [connected, profile, latest, history] = await Promise.all([
    isConnected(),
    getUserProfile(),
    latestDigestWithVideos(),
    listRecentDigests(10),
  ]);

  return (
    <AppShell active="digests" connected={connected} profile={profile} mainStyle={{ maxWidth: 900, margin: '0 auto', width: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 4 }}>📋 New-video digest</h1>
          <p style={{ color: '#8b8b94', fontSize: 13, maxWidth: 560 }}>
            Sync every channel and collect the videos published since your last sync into a single digest. Each video links to YouTube and offers a quick-summarize option.
          </p>
        </div>
        <GenerateDigestButton connected={connected} />
      </div>

      {/* Latest digest */}
      {latest ? (
        <section style={{ marginBottom: 36 }}>
          <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>Latest digest</h2>
          <p style={{ color: '#8b8b94', fontSize: 12, marginBottom: 14 }}>
            {latest.video_count} new video{latest.video_count === 1 ? '' : 's'} from {latest.channel_count} channel{latest.channel_count === 1 ? '' : 's'}
            {' · '}
            period {latest.period_start ? formatDate(latest.period_start) : '—'} → {formatDate(latest.period_end)}
            {' · '}
            generated {formatRelative(latest.created_at)}
          </p>

          {latest.errors && (
            <div style={{ padding: '10px 12px', marginBottom: 12, border: '1px solid rgba(255,99,99,0.3)', borderRadius: 8, background: 'rgba(255,99,99,0.06)', color: '#ff9b9b', fontSize: 12, whiteSpace: 'pre-wrap' }}>
              {latest.errors}
            </div>
          )}

          {latest.videos.length === 0 ? (
            <div style={{ padding: '24px 20px', textAlign: 'center', color: '#8b8b94', border: '1px dashed #2a2a33', borderRadius: 12, fontSize: 13 }}>
              No new videos in this digest. Hit “Generate digest” again after new uploads appear.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {latest.videos.map(v => (
                <DigestVideoRow key={v.video_id} video={v} />
              ))}
            </div>
          )}
        </section>
      ) : (
        <div style={{ marginTop: 32, padding: 32, textAlign: 'center', color: '#8b8b94', fontSize: 14, border: '1px dashed #2a2a33', borderRadius: 12, background: '#15151a' }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>📋</div>
          <div>No digests yet. Hit “Generate digest” to sync your channels and collect new videos.</div>
        </div>
      )}

      {/* Digest history */}
      {history.length > 1 && (
        <section>
          <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>History</h2>
          <p style={{ color: '#8b8b94', fontSize: 12, marginBottom: 14 }}>Recent digest runs</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {history.map(d => (
              <div
                key={d.id}
                style={{
                  display: 'flex',
                  gap: 12,
                  alignItems: 'center',
                  padding: '8px 12px',
                  border: '1px solid #2a2a33',
                  borderRadius: 8,
                  background: '#15151a',
                  fontSize: 13,
                }}
              >
                <span style={{ color: '#e7e7ea', fontWeight: 500 }}>{d.video_count} new</span>
                <span style={{ color: '#8b8b94' }}>{d.channel_count} channel{d.channel_count === 1 ? '' : 's'}</span>
                <span style={{ color: '#5a5a64', flex: 1 }}>
                  {d.period_start ? formatDate(d.period_start) : '—'} → {formatDate(d.period_end)}
                </span>
                <span style={{ color: '#5a5a64', fontSize: 11 }}>{formatRelative(d.created_at)}</span>
              </div>
            ))}
          </div>
        </section>
      )}
    </AppShell>
  );
}
