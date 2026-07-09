import { useEffect } from 'react';
import { usePlayerStore } from '../stores/playerStore';
import { useLibraryStore } from '../stores/libraryStore';
import { audioEngine } from '../lib/audioEngine';
import type { Song } from '../types';

// Track URLs we've already prefetched in this session so we don't pull
// the same multi-MB blob over the wire repeatedly when navigating around.
const prefetched = new Set<string>();
const prefetchInFlight = new Map<string, AbortController>();

/** Pull each stem URL via fetch() so the FULL bytes land in the browser's
 *  HTTP cache. When the user navigates to that song, audioEngine.loadSong
 *  does its own fetch() against the same URL and gets a cache hit
 *  (effectively instant start).
 *
 *  Why not <audio preload="auto">: that only buffers the first few hundred
 *  KB for playback, not the whole file — so the second navigation still
 *  Range-requests the rest, losing the prefetch win. */
function prefetchStems(song: Song | undefined | null) {
  if (!song || typeof window === 'undefined') return;
  for (const name of song.stems || []) {
    const url = `/api/v1/songs/${song.id}/stems/${name}`;
    if (prefetched.has(url) || prefetchInFlight.has(url)) continue;
    const ac = new AbortController();
    prefetchInFlight.set(url, ac);
    fetch(url, { signal: ac.signal, credentials: 'same-origin' })
      .then((r) => r.ok ? r.blob() : null)
      .then(() => {
        prefetched.add(url);
        prefetchInFlight.delete(url);
      })
      .catch(() => {
        prefetchInFlight.delete(url);
      });
  }
}

/** Resolve the next/prev song relative to the active setlist or library. */
function neighborSong(direction: 'next' | 'prev'): Song | null {
  const ps = usePlayerStore.getState();
  const songs = useLibraryStore.getState().songs;
  const currentId = ps.currentSong?.id;
  if (ps.activeSetlist && ps.activeSetlist.songs.length > 0) {
    const idx = ps.queueIndex + (direction === 'next' ? 1 : -1);
    if (idx >= 0 && idx < ps.activeSetlist.songs.length) {
      const entry = ps.activeSetlist.songs[idx];
      const s = songs.find((x) => x.id === entry.song_id);
      if (s) return s;
    }
    return null;
  }
  if (songs.length < 2 || !currentId) return null;
  const i = songs.findIndex((s) => s.id === currentId);
  if (i < 0) return null;
  const j = (direction === 'next')
    ? (i + 1) % songs.length
    : (i - 1 + songs.length) % songs.length;
  return songs[j] || null;
}

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
  // After load, if isPlaying is still true (user was playing, song
  // changed via Next button or end-of-song auto-advance), resume playback
  // automatically so they don't have to click Play between every track.
  useEffect(() => {
    let cancelled = false;
    if (!currentSong) {
      audioEngine.loadSong('', []);
      return;
    }
    const resumeIfStillPlaying = () => {
      if (cancelled) return;
      if (usePlayerStore.getState().isPlaying) {
        // No count-in on auto-advance — the user is mid-flow, don't
        // make them wait 4 beats every track.
        audioEngine.play({ countInBeats: 0 });
      }
    };
    if (audioEngine.isReady(currentSong.id)) {
      resumeIfStillPlaying();
      return;
    }
    audioEngine.loadSong(currentSong.id, currentSong.stems || [])
      .then(resumeIfStillPlaying)
      .catch((err) => {
        if (cancelled) return;
        console.error('audioEngine.loadSong failed', err);
      });
    return () => { cancelled = true; };
  }, [currentSong?.id, currentSong?.stems?.join(',')]);

  // Prefetch the next + prev song's stem URLs so navigation is instant.
  // Fires immediately on song change — by the time the user finishes a
  // 3-4 minute song, the next one's bytes are fully in the HTTP cache, so
  // audioEngine.loadSong gets a cache hit and resumes within a frame.
  useEffect(() => {
    if (!currentSong) return;
    prefetchStems(neighborSong('next'));
    prefetchStems(neighborSong('prev'));
  }, [currentSong?.id]);

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
      // Race guard: if the store's currentSong is already different from
      // what the engine has loaded, a click has already moved us to a
      // different song. Skip the auto-advance — otherwise a stray
      // end-of-song RAF tick would override the user's click with the
      // "next" song from the setlist they just activated.
      if (audioEngine.currentLoadedSongId != null
          && ps.currentSong?.id !== audioEngine.currentLoadedSongId) {
        return;
      }
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
