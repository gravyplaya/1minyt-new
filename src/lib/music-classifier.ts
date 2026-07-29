/**
 * Best-effort "is this channel a music channel?" classifier.
 *
 * YouTube's `topicDetails.topicIds` are the strongest signal — anything that
 * has `/m/04rlf` (Music) or `/m/05fw6t` (Music videos) is almost certainly
 * music. Beyond that we look at the channel's keywords string, its custom
 * URL, its title, and whether the title ends with the " - Topic" suffix
 * that YouTube uses for its auto-generated music channels.
 *
 * The classifier returns a flag (0 unknown, 1 music, 2 not-music) plus a
 * confidence score in [0,1] so the UI can show why it made a guess and so
 * the user can override.
 */

import type { youtube_v3 } from 'googleapis';

const MUSIC_TOPICS = new Set([
  '/m/04rlf',          // Music
  '/m/05fw6t',         // Music videos
  '/m/0z52',           // Music of Asia
  '/m/0g293',          // Music of Africa
  '/m/02hn8',          // Music of Latin America
  '/m/05rwpb',         // Music of Europe
  '/m/064t9',          // Pop music
  '/m/06by7',          // Rock music
  '/m/06j6l',          // R&B music
  '/m/0gyk',           // Hip hop music
  '/m/06bxc',          // Electronic music
  '/m/015ct5',         // Jazz
  '/m/0mkg',           // Country music
  '/m/07gxw',          // Classical music
  '/m/026t9',          // Music award
]);

const MUSIC_KEYWORDS = [
  'official music', 'music video', 'record label', 'records music',
  'vevo', 'topic', 'audio only', 'official audio', 'lyric video', 'lyrics',
  'remix', 'mixtape', 'spotify', 'apple music', 'soundcloud',
  'beats', 'dj ', 'mc ', 'rapper', 'singer-songwriter', 'concert', 'tour dates',
];

interface Classification {
  flag: 0 | 1 | 2;
  score: number;
  reasons: string[];
}

interface ChannelForClassification {
  title?: string | null;
  description?: string | null;
  keywords?: string | null;
  customUrl?: string | null;
  topicIds?: string[];
}

export function classifyMusic(
  channel: youtube_v3.Schema$Channel | null | undefined,
  fallbackTitle?: string,
): Classification {
  const reasons: string[] = [];
  let musicScore = 0;
  let notMusicScore = 0;

  const c: ChannelForClassification = {
    title: channel?.snippet?.title ?? fallbackTitle ?? null,
    description: channel?.snippet?.description ?? null,
    keywords: channel?.brandingSettings?.channel?.keywords ?? null,
    customUrl: channel?.snippet?.customUrl ?? null,
    topicIds: (channel?.topicDetails?.topicIds ?? []) as string[],
  };

  // 1. Topic categories.
  const topicIds: string[] = c.topicIds ?? [];
  const musicTopics = topicIds.filter(t => MUSIC_TOPICS.has(t));
  if (musicTopics.length > 0) {
    musicScore += 0.9;
    reasons.push(`music topic (${musicTopics[0]})`);
  }

  // 2. Title " - Topic" suffix — YouTube's auto-generated music channels.
  if (c.title && /\s-\sTopic$/.test(c.title.trim())) {
    musicScore += 0.95;
    reasons.push('" - Topic" title suffix');
  }

  // 3. Keywords.
  const kw = (c.keywords ?? '').toLowerCase();
  if (kw) {
    const musicHits = MUSIC_KEYWORDS.filter(k => kw.includes(k));
    if (musicHits.length >= 2) {
      musicScore += 0.7;
      reasons.push(`keywords: ${musicHits.slice(0, 3).join(', ')}`);
    } else if (musicHits.length === 1) {
      musicScore += 0.4;
      reasons.push(`keyword: ${musicHits[0]}`);
    }
  }

  // 4. Custom URL — "VEVO" or "records" hint at music.
  const cu = (c.customUrl ?? '').toLowerCase();
  if (cu.includes('vevo') || cu.includes('records') || cu.includes('music')) {
    musicScore += 0.5;
    reasons.push(`custom URL: ${c.customUrl}`);
  }

  // 5. Description sniff.
  const desc = (c.description ?? '').toLowerCase();
  if (desc.includes('official music channel') || desc.includes('music channel')) {
    musicScore += 0.6;
    reasons.push('description says "music channel"');
  }

  // 6. Negative signals: keywords that strongly imply NOT music.
  const nonMusicSignals = [
    'gaming', 'gameplay', 'walkthrough', 'news', 'politics',
    'tutorial', 'how to', 'coding', 'programming', 'developer',
    'podcast', 'interview', 'lecture', 'university', 'course',
    'cooking', 'recipe', 'fitness', 'workout', 'sports',
    'review', 'unboxing', 'vlog', 'daily vlog',
  ];
  const nonHits = nonMusicSignals.filter(s => kw.includes(s) || desc.includes(s));
  if (nonHits.length >= 1 && musicScore < 0.5) {
    notMusicScore += 0.6;
    reasons.push(`non-music: ${nonHits.slice(0, 2).join(', ')}`);
  }

  // Tally.
  if (musicScore >= 0.5) {
    return { flag: 1, score: clamp01(musicScore), reasons };
  }
  if (notMusicScore >= 0.5) {
    return { flag: 2, score: clamp01(notMusicScore), reasons };
  }
  return { flag: 0, score: Math.max(musicScore, notMusicScore), reasons };
}

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}