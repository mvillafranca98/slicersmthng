import { useEffect, useRef, useState } from 'react';
import { usePlayerStore } from '../stores/playerStore';
import { audioEngine } from '../lib/audioEngine';

/**
 * Multi-stem colored waveform overlay.
 *
 * Replaces the previous single-WaveSurfer view with a custom canvas drawing
 * ALL stems on top of each other, each in its semantic color (vocals=coral,
 * drums=amber, bass=teal, guitar=green, piano=violet, other=grey). Mute/solo
 * fade individual stems in/out via opacity in real time.
 *
 * Architecture:
 *   - Static canvas: waveforms + beat grid + loop region
 *     (redrawn only when song / mute-solo / loop changes)
 *   - Dynamic canvas: just the playhead cursor (redrawn every animation frame)
 */

const STEM_COLORS: Record<string, string> = {
  vocals: '#FF6B8A',
  drums: '#FFB347',
  bass: '#00E5C3',
  guitar: '#5BDB6B',
  piano: '#C47FFF',
  other: '#8899AA',
  mytake: '#FFD166',
};

/** Order stems are stacked. Earlier in the list = drawn first (underneath). */
const STEM_DRAW_ORDER = ['other', 'piano', 'bass', 'drums', 'guitar', 'vocals'];

interface Peaks { min: Float32Array; max: Float32Array; }

function computePeaks(buffer: AudioBuffer, buckets: number): Peaks {
  const data = buffer.getChannelData(0);
  const samplesPerBucket = Math.max(1, Math.floor(data.length / buckets));
  const min = new Float32Array(buckets);
  const max = new Float32Array(buckets);
  for (let i = 0; i < buckets; i++) {
    let mn = 0, mx = 0;
    const start = i * samplesPerBucket;
    const end = Math.min(start + samplesPerBucket, data.length);
    for (let j = start; j < end; j++) {
      const v = data[j];
      if (v < mn) mn = v;
      if (v > mx) mx = v;
    }
    min[i] = mn;
    max[i] = mx;
  }
  return { min, max };
}

export function WaveformView({ height = 110 }: { height?: number; showBeatGrid?: boolean }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const staticCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const dynamicCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const peaksRef = useRef<Map<string, Peaks>>(new Map());
  const [width, setWidth] = useState(0);
  const [peaksReady, setPeaksReady] = useState(false);

  const currentSong = usePlayerStore((s) => s.currentSong);
  const currentTime = usePlayerStore((s) => s.currentTime);
  const duration = usePlayerStore((s) => s.duration);
  const stems = usePlayerStore((s) => s.stems);
  const loopA = usePlayerStore((s) => s.loopA);
  const loopB = usePlayerStore((s) => s.loopB);
  const loopActive = usePlayerStore((s) => s.loopActive);

  // Resize observer keeps the canvases sized to their container
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const obs = new ResizeObserver((entries) => {
      const w = Math.floor(entries[0].contentRect.width);
      if (w > 0) setWidth(w);
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  // Compute per-stem peaks when the song changes. Retries until the audio
  // engine has finished decoding the stems (loadSong runs async).
  useEffect(() => {
    setPeaksReady(false);
    peaksRef.current.clear();
    if (!currentSong) return;

    let cancelled = false;
    let attempts = 0;
    const tryCompute = () => {
      if (cancelled) return;
      const buffers = audioEngine.getStemBuffers();
      if (buffers.size === 0) {
        if (attempts++ < 60) setTimeout(tryCompute, 300);
        return;
      }
      buffers.forEach((buf, name) => {
        peaksRef.current.set(name, computePeaks(buf, 2400));
      });
      setPeaksReady(true);
    };
    tryCompute();
    return () => { cancelled = true; };
  }, [currentSong?.id]);

  // Static layer: waveforms + beat grid + loop region
  useEffect(() => {
    if (!peaksReady || !width) return;
    const canvas = staticCanvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const state = usePlayerStore.getState();
    const anySolo = Object.values(state.stems).some((s) => s.solo);
    const centerY = height / 2;
    const halfH = (height / 2) * 0.9;

    // Draw each stem in defined order (so vocals sits on top, etc.)
    for (const name of [...STEM_DRAW_ORDER, ...Array.from(peaksRef.current.keys()).filter((n) => !STEM_DRAW_ORDER.includes(n))]) {
      const peaks = peaksRef.current.get(name);
      if (!peaks) continue;
      const st = state.stems[name];
      const color = STEM_COLORS[name] || '#8899AA';
      // Opacity: faded when muted, OR when something else is soloed
      let opacity = 0.55;
      if (st?.muted) opacity = 0.08;
      else if (anySolo && !st?.solo) opacity = 0.08;
      else if (st?.solo) opacity = 0.85;

      ctx.fillStyle = color;
      ctx.globalAlpha = opacity;

      const peakCount = peaks.min.length;
      for (let x = 0; x < width; x++) {
        const i = Math.floor((x / width) * peakCount);
        const minV = peaks.min[i] || 0;
        const maxV = peaks.max[i] || 0;
        const y1 = centerY - maxV * halfH;
        const yh = Math.max(1, (maxV - minV) * halfH);
        ctx.fillRect(x, y1, 1, yh);
      }
    }
    ctx.globalAlpha = 1;

    // Beat grid (every 4th = bar, brighter)
    if (currentSong && duration > 0) {
      const bpm = Math.max(40, Math.min(240, currentSong.bpm || 120));
      const secondsPerBeat = 60 / bpm;
      const beats = Math.min(2000, Math.floor(duration / secondsPerBeat));
      for (let i = 1; i <= beats; i++) {
        const x = (i * secondsPerBeat / duration) * width;
        const isBar = i % 4 === 0;
        ctx.fillStyle = isBar ? 'rgba(255,255,255,0.10)' : 'rgba(255,255,255,0.04)';
        ctx.fillRect(Math.round(x), 0, 1, height);
      }
    }

    // Loop region tint + borders
    if (loopA != null && loopB != null && duration > 0 && loopB > loopA) {
      const x1 = (loopA / duration) * width;
      const x2 = (loopB / duration) * width;
      ctx.fillStyle = loopActive ? 'rgba(255,169,77,0.18)' : 'rgba(255,169,77,0.08)';
      ctx.fillRect(x1, 0, x2 - x1, height);
      ctx.strokeStyle = loopActive ? 'rgba(255,169,77,0.7)' : 'rgba(255,169,77,0.35)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x1 + 0.5, 0); ctx.lineTo(x1 + 0.5, height);
      ctx.moveTo(x2 - 0.5, 0); ctx.lineTo(x2 - 0.5, height);
      ctx.stroke();
    }
  }, [peaksReady, width, height, stems, loopA, loopB, loopActive, currentSong?.bpm, currentSong?.id, duration]);

  // Dynamic layer: just the playhead cursor
  useEffect(() => {
    const canvas = dynamicCanvasRef.current;
    if (!canvas || !width || !duration) return;
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    const x = (currentTime / duration) * width;
    // Soft glow + crisp line
    ctx.strokeStyle = 'rgba(0,229,255,0.35)';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(x, 0); ctx.lineTo(x, height);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(0,229,255,0.95)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x, 0); ctx.lineTo(x, height);
    ctx.stroke();
  }, [currentTime, width, height, duration]);

  const onSeek = (e: React.MouseEvent) => {
    if (!duration) return;
    const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
    const x = e.clientX - rect.left;
    const t = (x / rect.width) * duration;
    audioEngine.seek(t);
  };

  if (!currentSong) return null;

  // Compute A/B label positions for the overlay chips
  const aPct = loopA != null && duration > 0 ? (loopA / duration) * 100 : null;
  const bPct = loopB != null && duration > 0 ? (loopB / duration) * 100 : null;

  return (
    <div
      ref={containerRef}
      className="relative w-full cursor-pointer select-none"
      style={{ height }}
      onClick={onSeek}
    >
      <canvas ref={staticCanvasRef} className="absolute inset-0" />
      <canvas ref={dynamicCanvasRef} className="absolute inset-0 pointer-events-none" />
      {aPct != null && (
        <div
          className="absolute -top-0.5 px-1 text-[9px] font-mono font-bold text-bg-deepest bg-primary rounded-sm pointer-events-none"
          style={{ left: `${aPct}%`, transform: 'translateX(-50%)' }}
        >A</div>
      )}
      {bPct != null && (
        <div
          className="absolute -top-0.5 px-1 text-[9px] font-mono font-bold text-bg-deepest bg-primary rounded-sm pointer-events-none"
          style={{ left: `${bPct}%`, transform: 'translateX(-50%)' }}
        >B</div>
      )}
      {!peaksReady && (
        <div className="absolute inset-0 grid place-items-center text-[11px] text-text-muted bg-bg-card/40 rounded-md">
          Loading waveforms…
        </div>
      )}
    </div>
  );
}
