export interface ChordEvent {
  time: number;
  chord: string;
}

export interface Song {
  id: string;
  title: string;
  artist: string;
  duration: number;
  bpm: number;
  key: string;
  stems: string[];
  chords: ChordEvent[];
  thumbnail_url?: string;
  youtube_url?: string;
  model_used?: string;
  added_at?: string;
  notes?: string;
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
