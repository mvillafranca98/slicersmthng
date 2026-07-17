import { useEffect, useRef, useState } from 'react';
import { usePlayerStore, resolveTempoSegments, activeSegmentIndex } from '../stores/playerStore';
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
  const alignMode = usePlayerStore((s) => s.alignMode);
  const bpmOverride = usePlayerStore((s) => s.bpmOverride);
  const beatOffsetSec = usePlayerStore((s) => s.beatOffsetSec);
  const tempoSegments = usePlayerStore((s) => s.tempoSegments);

  // Drag state for align-mode grid nudging. Refs (not state) so the pointer
  // handlers don't re-render mid-drag. segIndex is the RESOLVED-list index
  // of the region being dragged (0 = base tempo).
  const dragRef = useRef<{ startX: number; startVal: number; segIndex: number; moved: boolean } | null>(null);

  // Zoom for precise alignment. zoom=1 shows the whole song; higher zoom
  // shows a `duration/zoom`-second window centered on viewCenter. All
  // time↔pixel mapping goes through the view window below so waveform,
  // grid, playhead, loop and drag all agree.
  const [zoom, setZoom] = useState(1);
  const [viewCenter, setViewCenter] = useState(0);
  const span = zoom <= 1 || !duration ? (duration || 1) : duration / zoom;
  const maxStart = Math.max(0, (duration || 0) - span);
  const viewStart = duration ? Math.min(maxStart, Math.max(0, viewCenter - span / 2)) : 0;
  const timeToX = (t: number) => ((t - viewStart) / span) * width;
  const xToTime = (x: number) => viewStart + (x / (width || 1)) * span;

  // Reset zoom when the song changes.
  useEffect(() => { setZoom(1); setViewCenter(0); }, [currentSong?.id]);

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
        // Higher bucket count so the waveform stays sharp when zoomed in
        // for metronome alignment (a slice of these buckets is stretched
        // across the full width at high zoom).
        peaksRef.current.set(name, computePeaks(buf, 6000));
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
      // Opacity: faded when muted, OR when something else is soloed.
      // In align mode ALL stems drop to a uniform grey so the metronome
      // grid is the only colored thing on screen.
      let opacity = 0.55;
      if (alignMode) opacity = 0.14;
      else if (st?.muted) opacity = 0.08;
      else if (anySolo && !st?.solo) opacity = 0.08;
      else if (st?.solo) opacity = 0.85;

      ctx.fillStyle = alignMode ? '#8899AA' : color;
      ctx.globalAlpha = opacity;

      const peakCount = peaks.min.length;
      for (let x = 0; x < width; x++) {
        // Map each pixel to a song-time via the view window, then to a peak
        // bucket. At zoom=1 this is the whole song; when zoomed, only the
        // visible slice of buckets is stretched across the width.
        const t = duration ? viewStart + (x / width) * span : 0;
        const i = Math.floor((t / (duration || 1)) * peakCount);
        if (i < 0 || i >= peakCount) continue;
        const minV = peaks.min[i] || 0;
        const maxV = peaks.max[i] || 0;
        const y1 = centerY - maxV * halfH;
        const yh = Math.max(1, (maxV - minV) * halfH);
        ctx.fillRect(x, y1, 1, yh);
      }
    }
    ctx.globalAlpha = 1;

    // Beat grid — draws every tempo region using the same resolved map the
    // audio engine clicks on, so the lines you see are exactly where the
    // clicks land. Each region's grid is anchored at its start and stops at
    // the next region's start. Accent every 4th beat (bar 1). In align mode
    // the grid is bright amber with taller caps on downbeats; the active
    // region (playhead's) is brightest so you know what a drag will move.
    if (currentSong && duration > 0) {
      const segs = resolveTempoSegments(bpmOverride, beatOffsetSec, tempoSegments, currentSong.bpm ?? 120);
      const activeIdx = alignMode ? activeSegmentIndex(segs, currentTime) : -1;
      for (let si = 0; si < segs.length; si++) {
        const seg = segs[si];
        const secondsPerBeat = 60 / seg.bpm;
        const regionEnd = si + 1 < segs.length ? Math.min(segs[si + 1].start, duration) : duration;
        // Base region (si=0) extends backward to 0; added regions start at
        // their anchor (a tempo change begins on its downbeat).
        const regionStart = si === 0 ? 0 : seg.start;
        const firstN = Math.ceil((regionStart - seg.start) / secondsPerBeat);
        const lastN = Math.floor((regionEnd - seg.start) / secondsPerBeat);
        if (lastN - firstN > 3000) continue;  // guard absurd BPM/duration
        const isActive = si === activeIdx;
        for (let n = firstN; n <= lastN; n++) {
          const t = seg.start + n * secondsPerBeat;
          if (t < 0 || t > duration) continue;
          const x = timeToX(t);
          if (x < -4 || x > width + 4) continue;  // outside the zoom window
          const isBar = (((n % 4) + 4) % 4) === 0;
          if (alignMode) {
            const base = isActive ? 1 : 0.4;
            ctx.fillStyle = isBar ? `rgba(255,169,77,${base})` : `rgba(255,169,77,${base * 0.5})`;
            ctx.fillRect(Math.round(x), 0, isBar ? 2 : 1, height);
            if (isBar) {
              ctx.fillStyle = `rgba(255,169,77,${base})`;
              ctx.fillRect(Math.round(x) - 2, 0, 5, 5);
              ctx.fillRect(Math.round(x) - 2, height - 5, 5, 5);
            }
          } else {
            ctx.fillStyle = isBar ? 'rgba(255,255,255,0.10)' : 'rgba(255,255,255,0.04)';
            ctx.fillRect(Math.round(x), 0, 1, height);
          }
        }
        // Region boundary marker (cyan flag) for added regions.
        if (si > 0) {
          const bx = timeToX(seg.start);
          if (bx >= -4 && bx <= width + 4) {
            ctx.fillStyle = 'rgba(0,229,255,0.9)';
            ctx.fillRect(Math.round(bx), 0, 2, height);
            ctx.fillRect(Math.round(bx), 0, 10, 5);
          }
        }
      }
    }

    // Loop region tint + borders
    if (loopA != null && loopB != null && duration > 0 && loopB > loopA) {
      const x1 = timeToX(loopA);
      const x2 = timeToX(loopB);
      ctx.fillStyle = loopActive ? 'rgba(255,169,77,0.18)' : 'rgba(255,169,77,0.08)';
      ctx.fillRect(x1, 0, x2 - x1, height);
      ctx.strokeStyle = loopActive ? 'rgba(255,169,77,0.7)' : 'rgba(255,169,77,0.35)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x1 + 0.5, 0); ctx.lineTo(x1 + 0.5, height);
      ctx.moveTo(x2 - 0.5, 0); ctx.lineTo(x2 - 0.5, height);
      ctx.stroke();
    }
  }, [peaksReady, width, height, stems, loopA, loopB, loopActive, currentSong?.bpm, currentSong?.id, duration, alignMode, bpmOverride, beatOffsetSec, tempoSegments, currentTime, zoom, viewCenter]);

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
    const x = timeToX(currentTime);
    if (x >= 0 && x <= width) {
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
    }
  }, [currentTime, width, height, duration, zoom, viewCenter]);

  // Auto-follow: when zoomed and playing (and not mid-drag), keep the
  // playhead in view by recentering once it drifts out of the middle 80%.
  // Discrete recenters (not every frame) keep the heavy static redraw rare.
  useEffect(() => {
    if (zoom <= 1 || !duration || dragRef.current) return;
    const rel = (currentTime - viewStart) / span;  // 0..1 within the window
    if (rel < 0.1 || rel > 0.9) setViewCenter(currentTime);
  }, [currentTime, zoom, duration, viewStart, span]);

  const onSeek = (e: React.MouseEvent) => {
    if (!duration) return;
    const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
    const x = e.clientX - rect.left;
    audioEngine.seek(xToTime(x));
  };

  // ---- Align-mode drag: slide the active region's grid to line it up ----
  // The region being dragged is the one the PLAYHEAD is currently in (its
  // grid is drawn brightest). Dragging shifts that region's start by the
  // drag's time-equivalent (dx/width*duration). For the base region (index
  // 0) that's beatOffsetSec; for an added region it's that segment's start.
  // A click that doesn't move still seeks, so the user can jump to a
  // section and then align it.
  const onPointerDown = (e: React.PointerEvent) => {
    if (!alignMode || !duration) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const st = usePlayerStore.getState();
    const segs = resolveTempoSegments(st.bpmOverride, st.beatOffsetSec, st.tempoSegments, currentSong?.bpm ?? 120);
    const segIndex = activeSegmentIndex(segs, st.currentTime);
    dragRef.current = {
      startX: e.clientX,
      startVal: segs[segIndex].start,
      segIndex,
      moved: false,
    };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag || !alignMode || !duration) return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const dx = e.clientX - drag.startX;
    if (Math.abs(dx) > 2) drag.moved = true;
    // dt uses the VISIBLE span, not the full duration — so at higher zoom
    // the same pixel drag moves the grid by a smaller time delta (finer).
    const dt = (dx / rect.width) * span;
    const newStart = drag.startVal + dt;
    const st = usePlayerStore.getState();
    if (drag.segIndex === 0) {
      st.setBeatOffsetSec(newStart);
    } else {
      // Added regions are indexed 1..N in the resolved list, which maps to
      // tempoSegments[segIndex-1] (base is index 0). Clamp handled in store.
      st.updateTempoSegment(drag.segIndex - 1, { start: newStart });
    }
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (!alignMode || !duration) return;
    // A pure click (no drag) seeks so the user can reposition the playhead.
    if (drag && !drag.moved) onSeek(e as unknown as React.MouseEvent);
  };

  if (!currentSong) return null;

  // A/B chip positions in the current view window (pixels → %).
  const aX = loopA != null && duration > 0 ? timeToX(loopA) : null;
  const bX = loopB != null && duration > 0 ? timeToX(loopB) : null;
  const inView = (x: number | null) => x != null && x >= 0 && x <= width;

  const zoomIn = () => { setViewCenter(currentTime); setZoom((z) => Math.min(32, z * 2)); };
  const zoomOut = () => { setViewCenter(currentTime); setZoom((z) => Math.max(1, z / 2)); };

  return (
    <div
      ref={containerRef}
      className={`relative w-full select-none ${alignMode ? 'cursor-ew-resize ring-1 ring-primary/50 rounded-md' : 'cursor-pointer'}`}
      style={{ height }}
      onClick={alignMode ? undefined : onSeek}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      <canvas ref={staticCanvasRef} className="absolute inset-0" />
      <canvas ref={dynamicCanvasRef} className="absolute inset-0 pointer-events-none" />
      {alignMode && (
        <div className="absolute top-1 left-1/2 -translate-x-1/2 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-primary text-bg-deepest pointer-events-none shadow">
          ← drag to align the beat grid →
        </div>
      )}

      {/* Zoom controls — shown in align mode for precise dragging. */}
      {alignMode && (
        <div className="absolute bottom-1 right-1 flex items-center gap-1">
          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); zoomOut(); }}
            disabled={zoom <= 1}
            aria-label="Zoom out"
            className="h-6 w-6 grid place-items-center rounded bg-bg-deepest/80 border border-white/10 text-text-secondary hover:text-text-primary disabled:opacity-30 text-sm leading-none"
          >−</button>
          <span className="px-1.5 h-6 grid place-items-center rounded bg-bg-deepest/80 border border-white/10 text-[10px] font-mono text-text-primary tabular-nums">
            {zoom}×
          </span>
          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); zoomIn(); }}
            disabled={zoom >= 32}
            aria-label="Zoom in"
            className="h-6 w-6 grid place-items-center rounded bg-bg-deepest/80 border border-white/10 text-text-secondary hover:text-text-primary disabled:opacity-30 text-sm leading-none"
          >+</button>
        </div>
      )}

      {inView(aX) && (
        <div
          className="absolute -top-0.5 px-1 text-[9px] font-mono font-bold text-bg-deepest bg-primary rounded-sm pointer-events-none"
          style={{ left: `${aX}px`, transform: 'translateX(-50%)' }}
        >A</div>
      )}
      {inView(bX) && (
        <div
          className="absolute -top-0.5 px-1 text-[9px] font-mono font-bold text-bg-deepest bg-primary rounded-sm pointer-events-none"
          style={{ left: `${bX}px`, transform: 'translateX(-50%)' }}
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
