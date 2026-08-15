'use client';

import type { MusicFlag, VideoWithSummary } from '@/lib/types';
import { VideoSummaryRow } from './VideoSummaryRow';

/**
 * Renders the /summarized list using the same VideoSummaryRow component as
 * channel pages — embedded player, chat, bookmark/like/queue, chapters,
 * community pulse, references. This keeps the UI consistent across every
 * page that shows videos.
 */
export function SummarizedVideoList({
  items,
}: {
  items: { video: VideoWithSummary; musicFlag: MusicFlag }[];
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {items.map(({ video, musicFlag }) => (
        <VideoSummaryRow
          key={video.video_id}
          video={video}
          channelId={video.channel_id}
          musicFlag={musicFlag}
        />
      ))}
    </div>
  );
}
