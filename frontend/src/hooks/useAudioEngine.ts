import { useEffect, useRef, useCallback } from 'react';
import { usePlayerStore } from '../stores/playerStore';
import { api } from '../api';

/** Single-audio engine: one HTMLAudioElement (first stem). Multi-stem mix can be added via Web Audio later. */
export function useAudioEngine() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const {
    currentSong,
    isPlaying,
    setCurrentTime,
    setDuration,
    masterVolume,
    loopA,
    loopB,
    loopActive,
  } = usePlayerStore();

  useEffect(() => {
    if (!currentSong?.stems?.length) {
      setDuration(0);
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.src = '';
      }
      return;
    }
    const audio = new Audio(api.stemUrl(currentSong.id, currentSong.stems[0]));
    audio.volume = masterVolume;
    audio.onloadedmetadata = () => setDuration(audio.duration);
    audio.onended = () => usePlayerStore.getState().setPlaying(false);
    audioRef.current = audio;
    return () => {
      audio.pause();
      audio.src = '';
      audioRef.current = null;
    };
  }, [currentSong?.id]);

  useEffect(() => {
    const a = audioRef.current;
    if (a) a.volume = masterVolume;
  }, [masterVolume, currentSong?.id]);

  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    if (isPlaying) a.play().catch(() => {});
    else a.pause();
  }, [isPlaying, currentSong?.id]);

  useEffect(() => {
    const interval = setInterval(() => {
      const a = audioRef.current;
      if (!a || isNaN(a.currentTime)) return;
      let t = a.currentTime;
      if (loopActive && loopA != null && loopB != null && t >= loopB) {
        a.currentTime = loopA;
        t = loopA;
      }
      setCurrentTime(t);
    }, 150);
    return () => clearInterval(interval);
  }, [currentSong?.id, loopActive, loopA, loopB, setCurrentTime]);

  const seek = useCallback((t: number) => {
    const a = audioRef.current;
    if (a) a.currentTime = t;
    setCurrentTime(t);
  }, [setCurrentTime]);

  return { seek };
}
