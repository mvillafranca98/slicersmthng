import { useEffect, useRef, useState } from 'react';
import WaveSurfer from 'wavesurfer.js';
import { usePlayerStore } from '../stores/playerStore';
import { audioEngine } from '../lib/audioEngine';
import { api } from '../api';

interface Props {
  height?: number;
  showBeatGrid?: boolean;
}

/**
 * Visual-only waveform. Audio playback is handled by the multi-stem
 * AudioContext engine elsewhere — this component just renders the shape
 * of one stem (we pick "other" or the loudest available) and synchronizes
 * a cursor + loop overlays to the engine's currentTime.
 *
 * Click anywhere in the waveform to seek. The A/B loop region + per-beat
 * grid (derived from the song's detected BPM) are drawn as overlays on
 * top of the WaveSurfer canvas.
 */
export function WaveformView({ height = 96, showBeatGrid = true }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const wsRef = useRef<WaveSurfer | null>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  const currentSong = usePlayerStore((s) => s.currentSong);
  const currentTime = usePlayerStore((s) => s.currentTime);
  const duration = usePlayerStore((s) => s.duration);
  const loopA = usePlayerStore((s) => s.loopA);
  const loopB = usePlayerStore((s) => s.loopB);
  const loopActive = usePlayerStore((s) => s.loopActive);

  // Create / destroy WaveSurfer on song change.
  useEffect(() => {
    if (!currentSong || !containerRef.current) return;
    const stemList = currentSong.stems || [];
    if (!stemList.length) return;

    // Prefer "other" (richest spectrum) → fallback to first stem.
    const stem = stemList.includes('other') ? 'other' : stemList[0];

    setReady(false);
    setFailed(false);

    let cancelled = false;
    const ws = WaveSurfer.create({
      container: containerRef.current,
      url: api.stemUrl(currentSong.id, stem),
      waveColor: 'rgba(255, 169, 77, 0.35)',     // Studio Amber primary tint
      progressColor: 'rgba(255, 169, 77, 0.75)', // brighter for played region
      cursorColor: 'rgba(0, 229, 255, 0.95)',    // cyan accent
      cursorWidth: 2,
      height,
      barWidth: 2,
      barGap: 1,
      barRadius: 1,
      normalize: true,
      interact: true,
    });
    wsRef.current = ws;

    ws.on('ready', () => {
      if (cancelled) return;
      setReady(true);
    });
    ws.on('error', () => {
      if (cancelled) return;
      setFailed(true);
    });
    ws.on('interaction', (newTime: number) => {
      // WaveSurfer fires this on click; route it through our audio engine.
      audioEngine.seek(newTime);
    });

    return () => {
      cancelled = true;
      try { ws.destroy(); } catch { /* ignore */ }
      wsRef.current = null;
    };
  }, [currentSong?.id, height]);

  // Sync cursor to the engine's playback position.
  useEffect(() => {
    const ws = wsRef.current;
    if (!ws || !ready || !duration) return;
    try { ws.setTime(currentTime); } catch { /* setTime errors during teardown */ }
  }, [currentTime, ready, duration]);

  // ---- overlays (loop region, beat grid, A/B markers) ----
  const beatLines = (() => {
    if (!showBeatGrid || !currentSong || !duration) return [] as { left: string; emphasized: boolean }[];
    const bpm = Math.max(40, Math.min(240, currentSong.bpm || 120));
    const secondsPerBeat = 60 / bpm;
    const beats = Math.min(2000, Math.floor(duration / secondsPerBeat)); // safety cap
    const out: { left: string; emphasized: boolean }[] = [];
    for (let i = 1; i <= beats; i++) {
      out.push({
        left: `${((i * secondsPerBeat) / duration) * 100}%`,
        emphasized: i % 4 === 0, // every 4th beat = barline (assuming 4/4)
      });
    }
    return out;
  })();

  const loopTint = (loopA != null && loopB != null && duration > 0 && loopB > loopA)
    ? {
        left: `${(loopA / duration) * 100}%`,
        width: `${((loopB - loopA) / duration) * 100}%`,
      }
    : null;

  return (
    <div className="relative w-full" style={{ height }}>
      {/* WaveSurfer canvas */}
      <div ref={containerRef} className="absolute inset-0" />

      {/* Beat grid */}
      {beatLines.length > 0 && (
        <div className="absolute inset-0 pointer-events-none">
          {beatLines.map((b, i) => (
            <div
              key={i}
              className="absolute top-0 bottom-0 w-px"
              style={{
                left: b.left,
                background: b.emphasized ? 'rgba(255,255,255,0.10)' : 'rgba(255,255,255,0.04)',
              }}
            />
          ))}
        </div>
      )}

      {/* Loop region tint */}
      {loopTint && (
        <div
          className={`absolute top-0 bottom-0 pointer-events-none border-l border-r ${
            loopActive ? 'bg-primary/20 border-primary/60' : 'bg-primary/10 border-primary/30'
          }`}
          style={loopTint}
        />
      )}

      {/* A/B marker labels */}
      {loopA != null && duration > 0 && (
        <div
          className="absolute -top-0.5 px-1 text-[9px] font-mono font-bold text-bg-deepest bg-primary rounded-sm pointer-events-none"
          style={{ left: `${(loopA / duration) * 100}%`, transform: 'translateX(-50%)' }}
        >
          A
        </div>
      )}
      {loopB != null && duration > 0 && (
        <div
          className="absolute -top-0.5 px-1 text-[9px] font-mono font-bold text-bg-deepest bg-primary rounded-sm pointer-events-none"
          style={{ left: `${(loopB / duration) * 100}%`, transform: 'translateX(-50%)' }}
        >
          B
        </div>
      )}

      {/* States overlaid on top of the waveform */}
      {!ready && !failed && (
        <div className="absolute inset-0 grid place-items-center text-[11px] text-text-muted bg-bg-card/40 rounded-md">
          Loading waveform…
        </div>
      )}
      {failed && (
        <div className="absolute inset-0 grid place-items-center text-[11px] text-text-muted bg-bg-card/40 rounded-md">
          Waveform unavailable
        </div>
      )}
    </div>
  );
}
