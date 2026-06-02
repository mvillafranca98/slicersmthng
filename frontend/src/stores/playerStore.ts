import { create } from 'zustand';
import type { Song, StemState, Setlist } from '../types';

const defaultStemState = (): StemState => ({
  volume: 1,
  muted: false,
  solo: false,
});

function defaultStems(names: string[]): Record<string, StemState> {
  const o: Record<string, StemState> = {};
  names.forEach(n => { o[n] = defaultStemState(); });
  return o;
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
  beatOffsetSec: number;          // phase offset for downbeat alignment (-2 to +2 seconds)
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
      // Tempo override priority: user-set > drum-auto-detected > zero.
      const beatOffset = song?.beat_offset_user ?? song?.beat_offset ?? 0;
      const bpmOverride = song?.bpm_user ?? null;
      return {
        currentSong: song,
        stems: song ? (stems || carryStems) : {},
        duration: song?.duration || 0,
        currentTime: 0,
        bpmOverride,
        beatOffsetSec: beatOffset,
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
  setBeatOffsetSec: (v) => set({ beatOffsetSec: Math.max(-2, Math.min(2, v)) }),
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
