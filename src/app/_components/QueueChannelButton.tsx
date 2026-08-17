'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { pinMultipleToQueueTopAction } from '@/app/actions';

/**
 * TAV-61: "Queue this channel" — a thin client button for the channel page
 * header. Batch-pins the channel's N most-recent unwatched videos to the top
 * of the Watch (or Music) queue, then navigates to /watch (or /music) so the
 * session starts immediately.
 *
 * The queue target is decided by `musicFlag`: channels with `music_flag = 1`
 * target the Music queue ("Listen next"); all others target the Watch queue
 * ("Watch next"). The button label and navigation route reflect this.
 *
 * The button stays thin: it collects the video ids from the already-fetched
 * channel videos list (passed in as `videoIds`) and delegates the mutation to
 * the shared `pinMultipleToQueueTopAction` server action — no business logic
 * lives here.
 */
export function QueueChannelButton({
  channelId,
  videoIds,
  musicFlag,
}: {
  channelId: string;
  /** The channel's video ids to pin, in the order they should appear (newest first). */
  videoIds: string[];
  /** 0/2 = Watch queue, 1 = Music queue. */
  musicFlag: 0 | 1 | 2;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();

  const isMusic = musicFlag === 1;
  const queue = isMusic ? 'music' : 'watch';
  const route = isMusic ? '/music' : '/watch';
  const label = isMusic ? '🎵 Listen next' : '▶ Queue this channel';

  // Nothing to pin — render nothing rather than a dead button.
  if (videoIds.length === 0) return null;

  const handleClick = () => {
    start(async () => {
      await pinMultipleToQueueTopAction(videoIds, queue);
      // Navigate to the first pinned video so playback starts immediately.
      router.push(`${route}?v=${videoIds[0]}`);
    });
  };

  return (
    <button
      type="button"
      className="btn btn-primary"
      onClick={handleClick}
      disabled={pending}
      title={isMusic ? 'Pin this channel\'s recent videos to the Music queue' : 'Pin this channel\'s recent videos to the Watch queue'}
      style={{ fontSize: 13, padding: '8px 14px' }}
    >
      {pending ? 'Queuing…' : label}
    </button>
  );
}
