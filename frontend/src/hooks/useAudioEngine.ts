import { useEffect } from 'react';
import { usePlayerStore } from '../stores/playerStore';
import { useLibraryStore } from '../stores/libraryStore';
import { audioEngine } from '../lib/audioEngine';
import type { Song } from '../types';

/**
 * Wires the audio engine singleton to the player store. Mount in exactly
 * one place (Layout/PlayerBar). Triggers loadSong on song change, and
 * forwards play/pause/volume/tempo/stem updates into the engine.
 */
export function useAudioEngine() {
  const currentSong = usePlayerStore((s) => s.currentSong);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const masterVolume = usePlayerStore((s) => s.masterVolume);
  const stems = usePlayerStore((s) => s.stems);
  const tempoPercent = usePlayerStore((s) => s.tempoPercent);
  const pitchSemitones = usePlayerStore((s) => s.pitchSemitones);
  const metronomeVolume = usePlayerStore((s) => s.metronomeVolume);

  // Load stems on song change. Songs without stems become a no-op load.
  useEffect(() => {
    let cancelled = false;
    if (!currentSong) {
      audioEngine.loadSong('', []);
      return;
    }
    if (audioEngine.isReady(currentSong.id)) return;
    audioEngine.loadSong(currentSong.id, currentSong.stems || [])
      .catch((err) => {
        if (cancelled) return;
        console.error('audioEngine.loadSong failed', err);
      });
    return () => { cancelled = true; };
  }, [currentSong?.id, currentSong?.stems?.join(',')]);

  // Play/pause. We read countIn from the latest store state at the moment of
  // transition so toggling it on/off between plays takes effect immediately.
  useEffect(() => {
    if (isPlaying) {
      const state = usePlayerStore.getState();
      const countInBeats = state.metronomeCountIn ? 4 : 0;
      audioEngine.play({ countInBeats });
    } else {
      audioEngine.pause();
    }
  }, [isPlaying]);

  // Metronome volume → engine
  useEffect(() => {
    audioEngine.setMetronomeVolume(metronomeVolume);
  }, [metronomeVolume]);

  // Master volume
  useEffect(() => {
    audioEngine.setMasterVolume(masterVolume);
  }, [masterVolume]);

  // Per-stem solo/mute/volume — recompute gains
  useEffect(() => {
    audioEngine.applyStemGains();
  }, [stems]);

  // Tempo
  useEffect(() => {
    audioEngine.setTempo(tempoPercent);
  }, [tempoPercent]);

  // Pitch shift (independent of tempo — uses GrainPlayer detune)
  useEffect(() => {
    audioEngine.setPitchSemitones(pitchSemitones);
  }, [pitchSemitones]);

  // Wire end-of-song "next song" handler. The engine doesn't know about the
  // library or setlists, so we provide a callback that resolves whichever
  // makes sense given current state.
  useEffect(() => {
    audioEngine.onRequestNext = (mode) => {
      const ps = usePlayerStore.getState();
      const songs = useLibraryStore.getState().songs;
      let next: Song | null = null;
      // 1. If a setlist is active, prefer setlist navigation
      if (ps.activeSetlist && ps.activeSetlist.songs.length > 0) {
        const setlist = ps.activeSetlist;
        if (mode === 'shuffle') {
          const choices = setlist.songs.filter((_, i) => i !== ps.queueIndex);
          if (choices.length) {
            const pick = choices[Math.floor(Math.random() * choices.length)];
            const found = songs.find((s) => s.id === pick.song_id);
            if (found) {
              const idx = setlist.songs.findIndex((e) => e.song_id === pick.song_id);
              ps.setActiveSetlist(setlist, Math.max(0, idx));
              next = found;
            }
          }
        } else if (mode === 'continue') {
          if (ps.queueIndex < setlist.songs.length - 1) {
            const entry = setlist.songs[ps.queueIndex + 1];
            const found = songs.find((s) => s.id === entry.song_id);
            if (found) {
              ps.setActiveSetlist(setlist, ps.queueIndex + 1);
              next = found;
            }
          }
        }
      }
      // 2. Library fallback (when no setlist or setlist navigation found nothing)
      if (!next && songs.length > 1) {
        const currentId = ps.currentSong?.id;
        if (mode === 'shuffle') {
          const choices = songs.filter((s) => s.id !== currentId);
          next = choices[Math.floor(Math.random() * choices.length)] || null;
        } else if (mode === 'continue') {
          const idx = songs.findIndex((s) => s.id === currentId);
          next = songs[(idx + 1) % songs.length] || null;
        }
      }
      if (next) {
        ps.setCurrentSong(next);
        ps.setPlaying(true);
      } else {
        ps.setPlaying(false);
      }
    };
    return () => { audioEngine.onRequestNext = null; };
  }, []);
}
