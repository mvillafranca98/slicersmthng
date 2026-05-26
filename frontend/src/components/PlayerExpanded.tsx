import { useCallback, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import {
  ChevronDown,
  Pause,
  Play,
  Repeat,
  Rewind,
  FastForward,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
  Magnet,
} from 'lucide-react';
import { usePlayerStore } from '../stores/playerStore';
import { audioEngine } from '../lib/audioEngine';
import { api } from '../api';
import { cn } from '../lib/cn';
import { WaveformView } from './WaveformView';
import { ChordStrip } from './ChordStrip';

const STEM_COLORS: Record<string, string> = {
  vocals: '#FF6B8A',
  drums: '#FFB347',
  bass: '#00E5C3',
  guitar: '#5BDB6B',
  piano: '#C47FFF',
  other: '#8899AA',
  mytake: '#FFD166',
};

function formatTime(s: number) {
  if (!isFinite(s) || s < 0) return '0:00';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

export function PlayerExpanded() {
  const {
    currentSong,
    isPlaying,
    setPlaying,
    currentTime,
    duration,
    stems,
    setStem,
    setExpanded,
    loopA,
    loopB,
    loopActive,
    setLoopA,
    setLoopB,
    setLoopActive,
    tempoPercent,
    setTempoPercent,
  } = usePlayerStore();
  const [snapToBeat, setSnapToBeat] = useState(true);

  if (!currentSong) return null;

  const thumb = currentSong.thumbnail_url || api.thumbnailUrl(currentSong.id);
  const bpm = Math.max(40, Math.min(240, currentSong.bpm || 120));
  const secondsPerBeat = 60 / bpm;
  const secondsPerBar = 4 * secondsPerBeat;

  // Snap a time to the nearest beat (skip when snap disabled).
  const snap = useCallback((t: number) => {
    if (!snapToBeat) return t;
    return Math.round(t / secondsPerBeat) * secondsPerBeat;
  }, [snapToBeat, secondsPerBeat]);

  // Loop duration in bars (if both markers set)
  const loopBars = useMemo(() => {
    if (loopA == null || loopB == null || loopB <= loopA) return null;
    return (loopB - loopA) / secondsPerBar;
  }, [loopA, loopB, secondsPerBar]);

  const seek = (t: number) => audioEngine.seek(t);

  return (
    <motion.div
      initial={{ y: '100%' }}
      animate={{ y: 0 }}
      exit={{ y: '100%' }}
      transition={{ type: 'spring', stiffness: 360, damping: 40 }}
      className="fixed bottom-0 inset-x-0 z-[150] glass border-t border-white/10 flex flex-col"
      style={{ height: '78vh' }}
    >
      {/* ----- Header: song info + transport + collapse ----- */}
      <div className="shrink-0 px-5 py-4 border-b border-white/5 flex items-center gap-4">
        <img src={thumb} alt="" className="w-14 h-14 rounded-lg object-cover ring-1 ring-white/10 shrink-0" />
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold text-text-primary truncate">{currentSong.title}</h2>
          <p className="text-sm text-text-secondary truncate">{currentSong.artist}</p>
          <div className="flex gap-1.5 mt-1">
            <span className="text-[10px] font-mono text-text-primary bg-white/[0.04] border border-white/5 rounded px-1.5 py-px">
              ♩ {Math.round(bpm)}
            </span>
            <span className="text-[10px] font-mono text-text-primary bg-white/[0.04] border border-white/5 rounded px-1.5 py-px">
              {currentSong.key}
            </span>
            {tempoPercent !== 100 && (
              <span className="text-[10px] font-mono text-primary bg-primary/15 border border-primary/30 rounded px-1.5 py-px">
                {tempoPercent}%
              </span>
            )}
          </div>
        </div>

        {/* Transport */}
        <div className="flex items-center gap-1 shrink-0">
          <TransportButton aria-label="Previous"><SkipBack className="w-4 h-4" /></TransportButton>
          <TransportButton aria-label="Rewind 10s" onClick={() => seek(Math.max(0, currentTime - 10))}>
            <Rewind className="w-4 h-4" />
          </TransportButton>
          <button
            type="button"
            onClick={() => setPlaying(!isPlaying)}
            aria-label={isPlaying ? 'Pause' : 'Play'}
            className="w-11 h-11 rounded-full bg-primary hover:bg-primary-hover grid place-items-center text-white shadow-[0_4px_20px_-4px_rgba(255,169,77,0.7)] transition-transform active:scale-95"
          >
            {isPlaying ? <Pause className="w-4 h-4 fill-current" /> : <Play className="w-4 h-4 fill-current translate-x-px" />}
          </button>
          <TransportButton aria-label="Forward 10s" onClick={() => seek(Math.min(duration, currentTime + 10))}>
            <FastForward className="w-4 h-4" />
          </TransportButton>
          <TransportButton aria-label="Next"><SkipForward className="w-4 h-4" /></TransportButton>
        </div>

        <button
          type="button"
          onClick={() => setExpanded(false)}
          aria-label="Collapse player"
          className="ml-2 h-9 w-9 grid place-items-center rounded-lg bg-white/[0.04] border border-white/5 text-text-secondary hover:text-text-primary transition-colors shrink-0"
        >
          <ChevronDown className="w-4 h-4" />
        </button>
      </div>

      {/* ----- Waveform + time readout ----- */}
      <div className="shrink-0 px-5 pt-3 pb-2 border-b border-white/5 space-y-2">
        <WaveformView height={96} />
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-mono text-text-muted tabular-nums">{formatTime(currentTime)}</span>
          <span className="text-[10px] text-text-muted">
            Click the waveform to seek · faint vertical lines mark beats (every 4th = bar)
          </span>
          <span className="text-[11px] font-mono text-text-muted tabular-nums">{formatTime(duration)}</span>
        </div>
      </div>

      {/* ----- Body: chord + mixer + controls ----- */}
      <div className="flex-1 overflow-auto px-5 py-4 space-y-5">

        {/* Chord timeline (real detection lands with task #13 on Modal) */}
        <section>
          <div className="text-[10px] uppercase tracking-[0.12em] text-text-muted mb-1.5">Chord</div>
          <ChordStrip />
        </section>

        {/* Stem mixer */}
        <section>
          <div className="text-[10px] uppercase tracking-[0.12em] text-text-muted mb-1.5">Stem mixer</div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {(currentSong.stems || []).map((name) => {
              const st = stems[name] || { volume: 1, muted: false, solo: false };
              const color = STEM_COLORS[name] || '#8899AA';
              const dimmed = st.muted;
              return (
                <div
                  key={name}
                  className={cn(
                    'rounded-xl bg-bg-card border border-white/5 p-3 flex flex-col gap-2 transition-opacity',
                    dimmed && 'opacity-50',
                  )}
                  style={{ borderLeftWidth: 3, borderLeftColor: color }}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-text-primary capitalize truncate">{name}</span>
                    <span className="text-[10px] font-mono text-text-muted tabular-nums">{Math.round(st.volume * 100)}%</span>
                  </div>
                  <div className="flex gap-1">
                    <button
                      type="button"
                      onClick={() => setStem(name, { solo: !st.solo, muted: false })}
                      aria-pressed={st.solo}
                      className={cn(
                        'flex-1 h-7 rounded text-xs font-semibold transition-colors',
                        st.solo
                          ? 'text-bg-deepest'
                          : 'bg-white/[0.04] text-text-secondary hover:text-text-primary',
                      )}
                      style={st.solo ? { background: color } : undefined}
                    >
                      S
                    </button>
                    <button
                      type="button"
                      onClick={() => setStem(name, { muted: !st.muted, solo: false })}
                      aria-pressed={st.muted}
                      className={cn(
                        'flex-1 h-7 rounded text-xs font-semibold transition-colors',
                        st.muted
                          ? 'bg-accent-red text-white'
                          : 'bg-white/[0.04] text-text-secondary hover:text-text-primary',
                      )}
                    >
                      M
                    </button>
                  </div>
                  <div className="flex items-center gap-2">
                    {st.volume === 0 ? <VolumeX className="w-3.5 h-3.5 text-text-muted shrink-0" /> : <Volume2 className="w-3.5 h-3.5 text-text-muted shrink-0" />}
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.01}
                      value={st.volume}
                      onChange={(e) => setStem(name, { volume: Number(e.target.value) })}
                      aria-label={`${name} volume`}
                      className="flex-1"
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* Tempo + Loop */}
        <section className="grid md:grid-cols-2 gap-5">

          {/* Tempo */}
          <div>
            <div className="text-[10px] uppercase tracking-[0.12em] text-text-muted mb-1.5">Tempo</div>
            <div className="flex gap-1.5 flex-wrap">
              {[50, 75, 90, 100].map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setTempoPercent(p)}
                  className={cn(
                    'h-9 px-3 rounded-lg text-sm font-medium transition-colors',
                    tempoPercent === p
                      ? 'bg-primary/20 text-primary border border-primary/40'
                      : 'bg-white/[0.04] text-text-secondary border border-white/5 hover:text-text-primary',
                  )}
                >
                  {p}%
                </button>
              ))}
            </div>
            <p className="mt-2 text-[11px] text-text-muted">Pitch shifts with speed (clean pitch-neutral stretch arrives with the waveform).</p>
          </div>

          {/* Loop */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <div className="text-[10px] uppercase tracking-[0.12em] text-text-muted">A/B loop</div>
              <button
                type="button"
                onClick={() => setSnapToBeat(!snapToBeat)}
                aria-pressed={snapToBeat}
                title={snapToBeat ? 'Snap-to-beat ON — markers align with the BPM grid' : 'Snap-to-beat OFF — markers go where you click'}
                className={cn(
                  'h-6 px-2 rounded text-[10px] inline-flex items-center gap-1 transition-colors',
                  snapToBeat
                    ? 'bg-primary/15 text-primary border border-primary/30'
                    : 'bg-white/[0.04] text-text-secondary border border-white/5 hover:text-text-primary',
                )}
              >
                <Magnet className="w-3 h-3" />
                Snap to beat
              </button>
            </div>

            <div className="flex flex-wrap gap-1.5 items-center">
              <button
                type="button"
                onClick={() => setLoopA(snap(currentTime))}
                className="h-9 px-3 rounded-lg text-xs font-mono bg-white/[0.04] border border-white/5 text-text-secondary hover:text-text-primary transition-colors"
              >
                Set A
              </button>
              <button
                type="button"
                onClick={() => setLoopB(snap(currentTime))}
                className="h-9 px-3 rounded-lg text-xs font-mono bg-white/[0.04] border border-white/5 text-text-secondary hover:text-text-primary transition-colors"
              >
                Set B
              </button>

              {/* +/- 1 bar fine-tune for B */}
              {loopA != null && loopB != null && (
                <>
                  <button
                    type="button"
                    onClick={() => setLoopB(Math.max(loopA + secondsPerBar / 4, loopB - secondsPerBar))}
                    aria-label="Shrink loop by 1 bar"
                    title="Shrink loop end by 1 bar"
                    className="h-9 w-9 grid place-items-center rounded-lg text-xs font-mono bg-white/[0.04] border border-white/5 text-text-secondary hover:text-text-primary"
                  >
                    −1
                  </button>
                  <button
                    type="button"
                    onClick={() => setLoopB(Math.min(duration, loopB + secondsPerBar))}
                    aria-label="Extend loop by 1 bar"
                    title="Extend loop end by 1 bar"
                    className="h-9 w-9 grid place-items-center rounded-lg text-xs font-mono bg-white/[0.04] border border-white/5 text-text-secondary hover:text-text-primary"
                  >
                    +1
                  </button>
                </>
              )}

              <button
                type="button"
                onClick={() => setLoopActive(!loopActive)}
                aria-pressed={loopActive}
                className={cn(
                  'h-9 px-3 inline-flex items-center gap-1.5 rounded-lg text-xs font-medium transition-colors',
                  loopActive
                    ? 'bg-primary/20 text-primary border border-primary/40'
                    : 'bg-white/[0.04] text-text-secondary border border-white/5 hover:text-text-primary',
                )}
              >
                <Repeat className="w-3.5 h-3.5" />
                {loopActive ? 'Looping' : 'Loop off'}
              </button>

              {(loopA != null || loopB != null) && (
                <button
                  type="button"
                  onClick={() => { setLoopA(null); setLoopB(null); setLoopActive(false); }}
                  className="h-9 px-2 rounded-lg text-[11px] text-text-muted hover:text-text-primary"
                >
                  clear
                </button>
              )}
            </div>

            <div className="mt-2 text-[11px] font-mono text-text-secondary">
              {loopA == null ? <span className="text-text-muted">A: –</span> : <>A: {formatTime(loopA)}</>}
              <span className="text-text-muted mx-2">·</span>
              {loopB == null ? <span className="text-text-muted">B: –</span> : <>B: {formatTime(loopB)}</>}
              {loopBars != null && (
                <>
                  <span className="text-text-muted mx-2">·</span>
                  <span className="text-text-primary">
                    {loopBars.toFixed(2)} bars
                    <span className="text-text-muted"> ({(loopB! - loopA!).toFixed(1)}s)</span>
                  </span>
                </>
              )}
            </div>
          </div>
        </section>
      </div>
    </motion.div>
  );
}

function TransportButton({
  children, onClick, ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="h-9 w-9 grid place-items-center rounded-lg text-text-secondary hover:text-text-primary hover:bg-white/[0.04] transition-colors"
      {...rest}
    >
      {children}
    </button>
  );
}
