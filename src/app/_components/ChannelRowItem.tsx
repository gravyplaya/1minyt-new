import Link from 'next/link';
import Image from 'next/image';
import type { ChannelWithRelations, FolderRow, TagRow } from '@/lib/types';
import { formatCount, youtubeChannelUrl } from '../_lib/format';

/**
 * TAV-71: channel card — glass panel matching the redesign demo: rounded
 * avatar, name + handle, stat row (videos/summarized/refs), folder & tag
 * chips, and a hover lift. The whole card links to the channel page; the
 * ⚡ Summarize button is a separate nested link.
 */

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
    <div className="channel-card">
      <Link
        href={`/c/${channel.channel_id}`}
        style={{ textDecoration: 'none', color: 'inherit', display: 'grid', gridTemplateColumns: '64px 1fr', gap: 16, minWidth: 0 }}
      >
        <Thumb url={channel.thumbnail_url} alt={channel.title} />
        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 17.5, fontWeight: 700, letterSpacing: '-0.01em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {channel.title}
            </span>
            {channel.handle && (
              <span style={{ color: '#8b8b94', fontSize: 13.5 }}>{channel.handle}</span>
            )}
            {channel.music_flag === 1 && <span className="chip chip-music">🎵 music</span>}
            {channel.hidden === 1 && <span className="chip">hidden</span>}
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 18, marginTop: 8, flexWrap: 'wrap', color: '#8b8b94', fontSize: 14 }}>
            <span><b style={{ color: '#8fb8ff', fontVariantNumeric: 'tabular-nums' }}>{formatCount(channel.video_count)}</b> videos</span>
            <span><b style={{ color: '#e7e7ea', fontVariantNumeric: 'tabular-nums' }}>{formatCount(channel.subscriber_count)}</b> subscribers</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
            {folderNames.map(f => (
              <span key={f.id} className="chip" style={{ background: f.color ?? undefined, color: '#0a0a0c', borderColor: 'transparent', fontWeight: 600 }}>
                {f.name}
              </span>
            ))}
            {tagNames.map(t => (
              <span key={t.id} className="chip">#{t.name}</span>
            ))}
            {channel.description && !folderNames.length && !tagNames.length && (
              <span style={{ color: '#5a5a64', fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 420 }}>
                {channel.description.split('\n')[0]}
              </span>
            )}
          </div>
        </div>
      </Link>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', justifyContent: 'center', gap: 8, flex: 'none' }}>
        <Link
          href={`/c/${channel.channel_id}#videos`}
          className="btn btn-sm-summarize"
          title="Open this channel and summarize a video"
        >
          ⚡ Summarize
        </Link>
        <a
          href={youtubeChannelUrl(channel.channel_id, channel.custom_url)}
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: '#5a5a64', fontSize: 12.5, textDecoration: 'none' }}
          title="Open on YouTube"
        >
          YouTube ↗
        </a>
      </div>
    </div>
  );
}

function Thumb({ url, alt }: { url: string | null; alt: string }) {
  if (!url) {
    return (
      <div className="channel-card-avatar channel-card-avatar-fallback" aria-hidden>
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
      className="channel-card-avatar"
      style={{ objectFit: 'cover' }}
    />
  );
}
