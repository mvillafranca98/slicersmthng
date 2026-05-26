import { useEffect } from 'react';
import { usePlayerStore } from '../stores/playerStore';
import { audioEngine } from '../lib/audioEngine';

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

  // Play/pause
  useEffect(() => {
    if (isPlaying) audioEngine.play();
    else audioEngine.pause();
  }, [isPlaying]);

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
}
