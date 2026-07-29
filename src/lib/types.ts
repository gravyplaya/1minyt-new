/**
 * Domain types — these are the shapes the UI and server actions pass around.
 * Keep them flat (no nested objects from joined queries) so we can serialize
 * freely across server/client boundaries.
 */

export type MusicFlag = 0 | 1 | 2; // unknown | music | not-music

export interface ChannelRow {
  channel_id: string;
  title: string;
  handle: string | null;
  description: string | null;
  thumbnail_url: string | null;
  subscriber_count: number | null;
  video_count: number | null;
  country: string | null;
  custom_url: string | null;
  music_flag: MusicFlag;
  music_score: number;
  hidden: 0 | 1;
  notes: string | null;
  subscribed_at: number | null;
  synced_at: number;
  created_at: number;
  updated_at: number;
}

export interface FolderRow {
  id: string;
  name: string;
  color: string | null;
  position: number;
  created_at: number;
}

export interface TagRow {
  id: string;
  name: string;
  color: string | null;
  created_at: number;
}

export interface ChannelWithRelations extends ChannelRow {
  folder_ids: string[];
  tag_ids: string[];
}

export type ChannelSort =
  | 'recent'
  | 'alpha'
  | 'subscribers'
  | 'videos'
  | 'updated';

export interface ChannelQuery {
  search?: string;
  folderId?: string | null;       // null = all, 'none' = unfiled, otherwise folder id
  tagId?: string | null;           // similar semantics
  includeMusic?: boolean;          // default false — hide music
  onlyMusic?: boolean;             // toggle for the music view
  hidden?: boolean;                // default false — hide soft-hidden
  sort?: ChannelSort;              // default 'alpha'
  dir?: 'asc' | 'desc';            // default 'asc' for alpha, 'desc' for others
}