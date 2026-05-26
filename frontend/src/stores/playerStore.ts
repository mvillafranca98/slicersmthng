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
  expanded: false,
  activeSetlist: null,
  queueIndex: 0,
  setCurrentSong(song, stems) {
    set({
      currentSong: song,
      stems: song ? (stems || defaultStems(song.stems || [])) : {},
      duration: song?.duration || 0,
      currentTime: 0,
    });
  },
  setPlaying: (v) => set({ isPlaying: v }),
  setCurrentTime: (t) => set({ currentTime: t }),
  setDuration: (d) => set({ duration: d }),
  setMasterVolume: (v) => set({ masterVolume: Math.max(0, Math.min(1, v)) }),
  setTempoPercent: (p) => set({ tempoPercent: Math.max(50, Math.min(120, p)) }),
  setPitchSemitones: (s) => set({ pitchSemitones: Math.max(-6, Math.min(6, s)) }),
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
