import { create } from 'zustand';
import type { Song, StemState, Setlist, TempoSegment } from '../types';

const defaultStemState = (): StemState => ({
  volume: 1,
  muted: false,
  solo: false,
});

/**
 * Resolve the full ordered tempo map: the base tempo (from bpmOverride/
 * beatOffsetSec, falling back to the song's detected BPM) followed by the
 * added regions. Shared by the audio engine's metronome scheduler and the
 * waveform grid so both agree on where clicks land. Always returns at least
 * one segment, sorted by start ascending.
 */
export function resolveTempoSegments(
  bpmOverride: number | null,
  beatOffsetSec: number,
  tempoSegments: TempoSegment[],
  detectedBpm: number,
): TempoSegment[] {
  const clampBpm = (b: number) => Math.max(30, Math.min(300, b));
  const base: TempoSegment = {
    start: beatOffsetSec || 0,
    bpm: clampBpm(bpmOverride ?? detectedBpm ?? 120),
  };
  const added = tempoSegments
    .map((s) => ({ start: s.start, bpm: clampBpm(s.bpm) }))
    .filter((s) => s.start > base.start);
  return [base, ...added].sort((a, b) => a.start - b.start);
}

/** Index into the resolved list of the segment active at song-time `pos`
 *  (the last segment whose start ≤ pos; clamps to 0 when pos precedes all). */
export function activeSegmentIndex(segments: TempoSegment[], pos: number): number {
  let idx = 0;
  for (let i = 0; i < segments.length; i++) {
    if (segments[i].start <= pos) idx = i; else break;
  }
  return idx;
}

interface PlayerState {
  currentSong: Song | null;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  masterVolume: number;
  tempoPercent: number;
  pitchSemitones: number;
  loopA: number | null;
  loopB: number | null;
  loopActive: boolean;
  stems: Record<string, StemState>;
  metronomeEnabled: boolean;
  metronomeVolume: number;        // 0-1, persisted to localStorage
  metronomeCountIn: boolean;      // when true, 4 beats of click before stems start
  bpmOverride: number | null;     // when set, replaces detected BPM (per-session)
  // Absolute song-time of "beat 0" — the metronome's accented downbeat.
  // The click grid is { beatOffsetSec + N*beatPeriod | N integer } with the
  // accent landing every 4 beats from N=0. Set by the "Mark 1" button to
  // the current playback time, persisted per-song as beat_offset_user.
  beatOffsetSec: number;
  // Added tempo regions BEYOND the base tempo. The base tempo is
  // { start: beatOffsetSec, bpm: bpmOverride ?? song.bpm }; each entry here
  // is an additional region that takes over at its `start`. Empty for
  // single-tempo songs. Kept sorted by start, all with start > base.start.
  tempoSegments: TempoSegment[];
  // When true, the waveform enters "align mode": stems grey out and the
  // metronome grid becomes a bright, draggable overlay so the user can
  // slide it onto the song's beats by eye. Not persisted — it's a
  // transient editing state, reset on song change.
  alignMode: boolean;
  playMode: 'stop' | 'continue' | 'repeat' | 'shuffle'; // end-of-song behaviour
  expanded: boolean;
  activeSetlist: Setlist | null;
  queueIndex: number;
  setCurrentSong: (song: Song | null, stems?: Record<string, StemState>) => void;
  setPlaying: (v: boolean) => void;
  setCurrentTime: (t: number) => void;
  setDuration: (d: number) => void;
  setMasterVolume: (v: number) => void;
  setTempoPercent: (p: number) => void;
  setPitchSemitones: (s: number) => void;
  setLoopA: (t: number | null) => void;
  setLoopB: (t: number | null) => void;
  setLoopActive: (v: boolean) => void;
  setStem: (name: string, patch: Partial<StemState>) => void;
  setMetronomeEnabled: (v: boolean) => void;
  setMetronomeVolume: (v: number) => void;
  setMetronomeCountIn: (v: boolean) => void;
  setBpmOverride: (v: number | null) => void;
  setBeatOffsetSec: (v: number) => void;
  setAlignMode: (v: boolean) => void;
  // Add a tempo region at `start` (song-time) with `bpm`. Kept sorted.
  addTempoSegment: (start: number, bpm: number) => void;
  updateTempoSegment: (index: number, patch: Partial<TempoSegment>) => void;
  removeTempoSegment: (index: number) => void;
  setTempoSegments: (segs: TempoSegment[]) => void;
  setPlayMode: (m: 'stop' | 'continue' | 'repeat' | 'shuffle') => void;
  setExpanded: (v: boolean) => void;
  setActiveSetlist: (s: Setlist | null, index?: number) => void;
  nextInSetlist: () => Song | null;
  prevInSetlist: () => Song | null;
  seek: (t: number) => void;
  togglePlay: () => void;
}

export const usePlayerStore = create<PlayerState>((set, get) => ({
  currentSong: null,
  isPlaying: false,
  currentTime: 0,
  duration: 0,
  masterVolume: 1,
  tempoPercent: 100,
  pitchSemitones: 0,
  loopA: null,
  loopB: null,
  loopActive: false,
  stems: {},
  metronomeEnabled: false,
  metronomeVolume: (() => {
    try {
      if (typeof window === 'undefined') return 0.6;
      const v = parseFloat(localStorage.getItem('slcr.metronomeVolume') || '');
      return isFinite(v) ? Math.max(0, Math.min(1, v)) : 0.6;
    } catch { return 0.6; }
  })(),
  metronomeCountIn: (() => {
    try {
      if (typeof window === 'undefined') return false;
      return localStorage.getItem('slcr.metronomeCountIn') === '1';
    } catch { return false; }
  })(),
  bpmOverride: null,
  beatOffsetSec: 0,
  tempoSegments: [],
  alignMode: false,
  playMode: (() => {
    try {
      if (typeof window === 'undefined') return 'continue' as const;
      const v = localStorage.getItem('slcr.playMode');
      return (v === 'stop' || v === 'continue' || v === 'repeat' || v === 'shuffle') ? v as 'stop'|'continue'|'repeat'|'shuffle' : 'continue';
    } catch { return 'continue' as const; }
  })(),
  expanded: false,
  activeSetlist: null,
  queueIndex: 0,
  setCurrentSong(song, stems) {
    set((state) => {
      // Carry mute/solo/volume across song changes by stem NAME. Lets the
      // user mute vocals once and keep practicing through a whole setlist
      // without re-clicking on every song. Stems not present in the prev
      // song (e.g. "guitar" when stepping from a 4-stem slice to a 6-stem)
      // fall back to defaults.
      const prev = state.stems;
      const carryStems: Record<string, StemState> = {};
      if (song) {
        for (const name of song.stems || []) {
          carryStems[name] = prev[name] ? { ...prev[name] } : defaultStemState();
        }
      }
      // Rebuild the tempo model from the song's persisted data.
      //  - If a full tempo_map exists, its first (earliest) entry is the
      //    base tempo and the rest are the added regions.
      //  - Otherwise fall back to the single bpm_user/beat_offset_user
      //    fields (or the auto-detected values).
      let beatOffset = song?.beat_offset_user ?? song?.beat_offset ?? 0;
      let bpmOverride = song?.bpm_user ?? null;
      let tempoSegments: TempoSegment[] = [];
      const map = song?.tempo_map;
      if (map && map.length > 0) {
        const sorted = [...map].sort((a, b) => a.start - b.start);
        beatOffset = sorted[0].start;
        bpmOverride = sorted[0].bpm;
        tempoSegments = sorted.slice(1);
      }
      return {
        currentSong: song,
        stems: song ? (stems || carryStems) : {},
        duration: song?.duration || 0,
        currentTime: 0,
        bpmOverride,
        beatOffsetSec: beatOffset,
        tempoSegments,
        alignMode: false,  // never carry the align editor across songs
      };
    });
  },
  setPlaying: (v) => set({ isPlaying: v }),
  setCurrentTime: (t) => set({ currentTime: t }),
  setDuration: (d) => set({ duration: d }),
  setMasterVolume: (v) => set({ masterVolume: Math.max(0, Math.min(1, v)) }),
  setTempoPercent: (p) => set({ tempoPercent: Math.max(50, Math.min(120, p)) }),
  setPitchSemitones: (s) => set({ pitchSemitones: Math.max(-12, Math.min(12, s)) }),
  setLoopA: (t) => set({ loopA: t }),
  setLoopB: (t) => set({ loopB: t }),
  setLoopActive: (v) => set({ loopActive: v }),
  setStem(name, patch) {
    set(state => {
      const next = { ...state.stems };
      next[name] = { ...(next[name] || defaultStemState()), ...patch };
      return { stems: next };
    });
  },
  setMetronomeEnabled: (v) => set({ metronomeEnabled: v }),
  setMetronomeVolume: (v) => {
    const clamped = Math.max(0, Math.min(1, v));
    if (typeof window !== 'undefined') localStorage.setItem('slcr.metronomeVolume', String(clamped));
    set({ metronomeVolume: clamped });
  },
  setMetronomeCountIn: (v) => {
    if (typeof window !== 'undefined') localStorage.setItem('slcr.metronomeCountIn', v ? '1' : '0');
    set({ metronomeCountIn: v });
  },
  setBpmOverride: (v) => set({ bpmOverride: v == null ? null : Math.max(30, Math.min(300, v)) }),
  // No clamp — beatOffsetSec is an absolute song-time and can be
  // anywhere in (or before) the track. Negative values are valid pre-roll
  // anchors that get the grid math right for songs that start mid-bar.
  setBeatOffsetSec: (v) => set({ beatOffsetSec: Number.isFinite(v) ? v : 0 }),
  setAlignMode: (v) => set({ alignMode: v }),
  addTempoSegment: (start, bpm) => set((state) => {
    // Don't allow a region to start at/before the base anchor, and avoid
    // near-duplicate boundaries (< 0.25s apart).
    if (start <= state.beatOffsetSec + 0.1) return {};
    if (state.tempoSegments.some((s) => Math.abs(s.start - start) < 0.25)) return {};
    const next = [...state.tempoSegments, { start, bpm: Math.max(30, Math.min(300, bpm)) }]
      .sort((a, b) => a.start - b.start);
    return { tempoSegments: next };
  }),
  updateTempoSegment: (index, patch) => set((state) => {
    const next = state.tempoSegments.map((s, i) => {
      if (i !== index) return s;
      const merged = { ...s, ...patch };
      merged.bpm = Math.max(30, Math.min(300, merged.bpm));
      if (!Number.isFinite(merged.start)) merged.start = s.start;
      return merged;
    }).sort((a, b) => a.start - b.start);
    return { tempoSegments: next };
  }),
  removeTempoSegment: (index) => set((state) => ({
    tempoSegments: state.tempoSegments.filter((_, i) => i !== index),
  })),
  setTempoSegments: (segs) => set({
    tempoSegments: [...segs].sort((a, b) => a.start - b.start),
  }),
  setPlayMode: (m) => {
    if (typeof window !== 'undefined') localStorage.setItem('slcr.playMode', m);
    set({ playMode: m });
  },
  setExpanded: (v) => set({ expanded: v }),
  setActiveSetlist(s, index = 0) {
    set({ activeSetlist: s, queueIndex: index });
  },
  nextInSetlist() {
    const { activeSetlist, queueIndex } = get();
    if (!activeSetlist?.songs?.length || queueIndex >= activeSetlist.songs.length - 1) return null;
    const next = activeSetlist.songs[queueIndex + 1];
    return next ? { id: next.song_id, title: '', artist: '', duration: 0, bpm: 0, key: '', stems: [], chords: [] } as Song : null;
  },
  prevInSetlist() {
    const { activeSetlist, queueIndex } = get();
    if (!activeSetlist?.songs?.length || queueIndex <= 0) return null;
    const prev = activeSetlist.songs[queueIndex - 1];
    return prev ? { id: prev.song_id, title: '', artist: '', duration: 0, bpm: 0, key: '', stems: [], chords: [] } as Song : null;
  },
  seek: (t) => set({ currentTime: t }),
  togglePlay: () => set(s => ({ isPlaying: !s.isPlaying })),
}));
