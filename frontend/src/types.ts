export interface ChordEvent {
  time: number;
  chord: string;
}

/** One tempo region. `start` is the song-time (sec) where this tempo takes
 *  over AND the downbeat anchor for its click grid. Clicks fall at
 *  start + N*(60/bpm) until the next region begins. */
export interface TempoSegment {
  start: number;
  bpm: number;
}

export interface Song {
  id: string;
  title: string;
  artist: string;
  duration: number;
  bpm: number;
  /** Drum-stem-derived downbeat phase in seconds (0 .. beatPeriod).
   *  Used as the metronome's initial beat alignment so clicks land on
   *  the kick drum. Older slices without this field default to 0. */
  beat_offset?: number;
  /** User's manual BPM override, persisted via PUT /songs/<id>/tempo.
   *  Wins over auto-detected `bpm` when present. */
  bpm_user?: number | null;
  /** User's manual downbeat phase override, persisted. Wins over
   *  `beat_offset` when present. Set by dragging the align-mode grid. */
  beat_offset_user?: number | null;
  /** Full tempo map for songs with tempo changes. When present (length ≥ 1),
   *  the first entry is the base tempo and the rest are added regions.
   *  Supersedes bpm_user/beat_offset_user, which stay for back-compat. */
  tempo_map?: TempoSegment[] | null;
  key: string;
  stems: string[];
  chords: ChordEvent[];
  thumbnail_url?: string;
  cover_url?: string | null;
  youtube_url?: string;
  model_used?: string;
  added_at?: string;
  notes?: string;
  stem_urls?: Record<string, string>;
  title_original?: string;
  artist_original?: string;
  metadata_source?: 'musicbrainz' | 'original';
  metadata_confidence?: number;
}

export type StemName = 'vocals' | 'drums' | 'bass' | 'guitar' | 'piano' | 'other' | 'mytake';

export interface StemState {
  volume: number;
  muted: boolean;
  solo: boolean;
  eq?: { bass: number; mid: number; treble: number };
  pan?: number;
  reverb?: number;
}

export interface MixSnapshot {
  song_id: string;
  stems: Record<string, StemState>;
  tempo_percent: number;
  loop_a: number | null;
  loop_b: number | null;
  loop_active: boolean;
  pitch_semitones?: number;
}

export interface SetlistEntry {
  song_id: string;
  snapshot: MixSnapshot | null;
}

export interface Setlist {
  id: string;
  name: string;
  color: string;
  songs: SetlistEntry[];
  created_at?: string;
  last_played_at?: string | null;
}

export interface Job {
  job_id: string;
  status: 'pending' | 'running' | 'done' | 'error';
  stage?: string;
  percent?: number;
  message?: string;
  result?: Song;
  error?: string;
  /** Human-readable label for in-progress display in library cards. */
  title?: string;
  /** Set when the user X'd the processing modal — modal stays hidden for this job.
   *  The job itself keeps running server-side. */
  dismissed?: boolean;
}

/** One row from GET /api/v1/search (yt-dlp `ytsearch`). */
export interface YouTubeSearchResult {
  id: string;
  title: string;
  channel: string;
  /** Seconds; null when YouTube doesn't list one. */
  duration: number | null;
  url: string;
  thumbnail: string;
}
