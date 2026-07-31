import Link from 'next/link';
import Image from 'next/image';
import type { ChannelWithRelations, FolderRow, TagRow } from '@/lib/types';
import { formatCount, youtubeChannelUrl } from '../_lib/format';

export function ChannelRowItem({
  channel,
  folders,
  tags,
}: {
  channel: ChannelWithRelations;
  folders: FolderRow[];
  tags: TagRow[];
}) {
  const folderNames = channel.folder_ids
    .map(id => folders.find(f => f.id === id))
    .filter((f): f is FolderRow => Boolean(f));
  const tagNames = channel.tag_ids
    .map(id => tags.find(t => t.id === id))
    .filter((t): t is TagRow => Boolean(t));

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '64px 1fr auto',
        gap: 14,
        padding: '10px 14px',
        borderRadius: 10,
        background: '#15151a',
        border: '1px solid #2a2a33',
        alignItems: 'center',
        textDecoration: 'none',
        color: 'inherit',
        transition: 'border-color .12s ease, background .12s ease',
      }}
      className="channel-row"
    >
      <Link href={`/c/${channel.channel_id}`} style={{ textDecoration: 'none', color: 'inherit', display: 'contents' }}>
        <Thumb url={channel.thumbnail_url} alt={channel.title} />
        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontWeight: 600, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {channel.title}
            </span>
            {channel.handle && (
              <span style={{ color: '#8b8b94', fontSize: 12 }}>{channel.handle}</span>
            )}
            {channel.music_flag === 1 && <span className="chip chip-music">🎵 music</span>}
            {channel.hidden === 1 && <span className="chip">hidden</span>}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4, flexWrap: 'wrap' }}>
            {folderNames.map(f => (
              <span key={f.id} className="chip" style={{ background: f.color ?? undefined, color: '#0a0a0c', borderColor: 'transparent' }}>
                {f.name}
              </span>
            ))}
            {tagNames.map(t => (
              <span key={t.id} className="chip">#{t.name}</span>
            ))}
            {channel.description && (
              <span style={{ color: '#5a5a64', fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 480 }}>
                {channel.description.split('\n')[0]}
              </span>
            )}
          </div>
        </div>
      </Link>
      <div className="channel-row-stats" style={{ textAlign: 'right', color: '#8b8b94', fontSize: 12, whiteSpace: 'nowrap' }}>
        <div>{formatCount(channel.subscriber_count)} subscribers</div>
        <div>{formatCount(channel.video_count)} videos</div>
        <Link
          href={`/c/${channel.channel_id}#videos`}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            marginTop: 6,
            fontSize: 11,
            fontWeight: 500,
            color: '#5b9eff',
            textDecoration: 'none',
            border: '1px solid #2a2a33',
            borderRadius: 999,
            padding: '2px 8px',
          }}
          title="Open this channel and summarize a video"
        >
          ⚡ Summarize
        </Link>
      </div>
    </div>
  );
}

function Thumb({ url, alt }: { url: string | null; alt: string }) {
  if (!url) {
    return (
      <div className="channel-row-thumb" style={{ width: 64, height: 64, borderRadius: 32, background: '#1f1f26', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#5a5a64', fontSize: 18, fontWeight: 600 }}>
        {alt[0]?.toUpperCase() ?? '?'}
      </div>
    );
  }
  return (
    <Image
      src={url}
      alt={alt}
      width={64}
      height={64}
      unoptimized
      className="channel-row-thumb"
      style={{ borderRadius: 32, objectFit: 'cover', width: 64, height: 64, background: '#1f1f26' }}
    />
  );
}