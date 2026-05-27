import { useCallback, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import {
  ChevronDown,
  Music2,
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
  Timer,
} from 'lucide-react';
import { usePlayerStore } from '../stores/playerStore';
import { useLibraryStore } from '../stores/libraryStore';
import { audioEngine } from '../lib/audioEngine';
import { api } from '../api';
import { cn } from '../lib/cn';
import { WaveformView } from './WaveformView';
import { ChordStrip } from './ChordStrip';
import { LyricsPanel } from './LyricsPanel';

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
    pitchSemitones,
    setPitchSemitones,
    metronomeEnabled,
    setMetronomeEnabled,
    metronomeVolume,
    setMetronomeVolume,
    metronomeCountIn,
    setMetronomeCountIn,
    activeSetlist,
    queueIndex,
    setActiveSetlist,
    setCurrentSong,
  } = usePlayerStore();
  const librarySongs = useLibraryStore((s) => s.songs);
  const [snapToBeat, setSnapToBeat] = useState(true);
  const [imgError, setImgError] = useState(false);

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

  // ---- Prev / Next navigation ----
  // Prev: if we're >3s in, rewind to start. Else, go to previous setlist song.
  // Next: go to next setlist song. No-op if no setlist active or at end.
  const goToPrev = () => {
    if (currentTime > 3) { seek(0); return; }
    if (!activeSetlist || queueIndex <= 0) { seek(0); return; }
    const prevEntry = activeSetlist.songs[queueIndex - 1];
    const song = librarySongs.find((s) => s.id === prevEntry?.song_id);
    if (song) {
      setActiveSetlist(activeSetlist, queueIndex - 1);
      setCurrentSong(song);
    } else {
      seek(0);
    }
  };
  const goToNext = () => {
    if (!activeSetlist || queueIndex >= (activeSetlist.songs.length - 1)) return;
    const nextEntry = activeSetlist.songs[queueIndex + 1];
    const song = librarySongs.find((s) => s.id === nextEntry?.song_id);
    if (song) {
      setActiveSetlist(activeSetlist, queueIndex + 1);
      setCurrentSong(song);
    }
  };
  const hasPrev = currentTime > 3 || (activeSetlist != null && queueIndex > 0);
  const hasNext = activeSetlist != null && queueIndex < (activeSetlist.songs.length - 1);

  // ---- Loop in bars ----
  const setLoopLengthBars = (bars: number) => {
    if (loopA == null || bars <= 0) return;
    const newB = Math.min(duration, loopA + bars * secondsPerBar);
    setLoopB(newB);
  };

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
        {!imgError ? (
          <img
            src={thumb}
            alt=""
            className="w-14 h-14 rounded-lg object-cover ring-1 ring-white/10 shrink-0"
            onError={() => setImgError(true)}
          />
        ) : (
          <div className="w-14 h-14 rounded-lg ring-1 ring-white/10 shrink-0 grid place-items-center bg-gradient-to-br from-bg-elevated to-bg-deepest">
            <Music2 className="w-6 h-6 text-text-muted" />
          </div>
        )}
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
          <TransportButton
            aria-label={currentTime > 3 ? 'Restart song' : 'Previous song'}
            title={currentTime > 3 ? 'Restart current song' : 'Previous in setlist'}
            disabled={!hasPrev}
            onClick={goToPrev}
          >
            <SkipBack className="w-4 h-4" />
          </TransportButton>
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
          <TransportButton
            aria-label="Next song"
            title="Next in setlist"
            disabled={!hasNext}
            onClick={goToNext}
          >
            <SkipForward className="w-4 h-4" />
          </TransportButton>
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

        {/* Lyrics (lazy-fetched from LRCLib) */}
        <section>
          <LyricsPanel />
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

          {/* Tempo + metronome */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <div className="text-[10px] uppercase tracking-[0.12em] text-text-muted">Tempo</div>
            </div>
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
            <p className="mt-2 text-[11px] text-text-muted">Pitch-neutral — slowing down keeps the original key.</p>

            {/* Pitch shift (independent of tempo) */}
            <div className="mt-4">
              <div className="flex items-center justify-between mb-1.5">
                <div className="text-[10px] uppercase tracking-[0.12em] text-text-muted">Pitch (key)</div>
                <button
                  type="button"
                  onClick={() => setPitchSemitones(0)}
                  disabled={pitchSemitones === 0}
                  className="text-[10px] text-text-muted hover:text-text-primary disabled:opacity-30"
                >
                  reset
                </button>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setPitchSemitones(pitchSemitones - 1)}
                  className="h-8 w-8 grid place-items-center rounded-lg bg-white/[0.04] border border-white/5 text-text-secondary hover:text-text-primary font-mono"
                  aria-label="Pitch down 1 semitone"
                >
                  −
                </button>
                <input
                  type="range"
                  min={-12}
                  max={12}
                  step={1}
                  value={pitchSemitones}
                  onChange={(e) => setPitchSemitones(Number(e.target.value))}
                  aria-label="Pitch in semitones"
                  className="flex-1"
                />
                <button
                  type="button"
                  onClick={() => setPitchSemitones(pitchSemitones + 1)}
                  className="h-8 w-8 grid place-items-center rounded-lg bg-white/[0.04] border border-white/5 text-text-secondary hover:text-text-primary font-mono"
                  aria-label="Pitch up 1 semitone"
                >
                  +
                </button>
                <span className="text-xs font-mono text-text-primary w-12 text-right tabular-nums">
                  {pitchSemitones > 0 ? `+${pitchSemitones}` : pitchSemitones} st
                </span>
              </div>
              <p className="mt-1 text-[10px] text-text-muted">±12 semitones = ±1 octave. Quality starts to degrade past ±6.</p>
            </div>

            {/* Metronome controls */}
            <div className="mt-4 rounded-xl bg-bg-card/60 border border-white/5 p-3">
              <div className="flex items-center justify-between mb-2">
                <div className="text-[10px] uppercase tracking-[0.12em] text-text-muted inline-flex items-center gap-1.5">
                  <Timer className="w-3 h-3" />
                  Metronome
                </div>
                <div className="flex gap-1">
                  <button
                    type="button"
                    onClick={() => setMetronomeCountIn(!metronomeCountIn)}
                    aria-pressed={metronomeCountIn}
                    title="Play 4 count-in clicks before the song starts"
                    className={cn(
                      'h-6 px-2 rounded text-[10px] inline-flex items-center gap-1 transition-colors',
                      metronomeCountIn
                        ? 'bg-primary/15 text-primary border border-primary/30'
                        : 'bg-white/[0.04] text-text-secondary border border-white/5 hover:text-text-primary',
                    )}
                  >
                    Count-in
                  </button>
                  <button
                    type="button"
                    onClick={() => setMetronomeEnabled(!metronomeEnabled)}
                    aria-pressed={metronomeEnabled}
                    title={metronomeEnabled
                      ? 'Click while playing'
                      : 'Click on every beat (accent every 4th)'}
                    className={cn(
                      'h-6 px-2 rounded text-[10px] font-bold uppercase tracking-wider inline-flex items-center gap-1 transition-colors',
                      metronomeEnabled
                        ? 'bg-primary text-bg-deepest border border-primary'
                        : 'bg-white/[0.04] text-text-secondary border border-white/5 hover:text-text-primary',
                    )}
                  >
                    {metronomeEnabled ? 'ON' : 'OFF'}
                  </button>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {metronomeVolume === 0
                  ? <VolumeX className="w-3.5 h-3.5 text-text-muted shrink-0" />
                  : <Volume2 className="w-3.5 h-3.5 text-text-muted shrink-0" />}
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={metronomeVolume}
                  onChange={(e) => setMetronomeVolume(Number(e.target.value))}
                  aria-label="Metronome volume"
                  className="flex-1"
                />
                <span className="text-[10px] font-mono text-text-muted w-8 text-right tabular-nums">
                  {Math.round(metronomeVolume * 100)}%
                </span>
              </div>
            </div>
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

              {/* "Loop X bars" input — sets B exactly N bars after A */}
              {loopA != null && (
                <label className="inline-flex items-center gap-1 h-9 px-2 rounded-lg bg-white/[0.04] border border-white/5 text-[11px] text-text-secondary">
                  <span>Length:</span>
                  <input
                    type="number"
                    min={1}
                    max={64}
                    step={1}
                    defaultValue={loopBars != null ? Math.max(1, Math.round(loopBars)) : 4}
                    onChange={(e) => setLoopLengthBars(Number(e.target.value))}
                    aria-label="Loop length in bars"
                    className="w-12 bg-transparent text-text-primary font-mono text-xs text-right focus:outline-none"
                  />
                  <span>bars</span>
                </label>
              )}

              <button
                type="button"
                onClick={() => setLoopActive(!loopActive)}
                aria-pressed={loopActive}
                title={loopActive
                  ? 'Loop is ON — click to turn off'
                  : 'Click to start looping between A and B (set both first)'}
                disabled={!loopActive && (loopA == null || loopB == null)}
                className={cn(
                  'h-9 px-3 inline-flex items-center gap-1.5 rounded-lg text-xs font-bold uppercase tracking-wider transition-colors',
                  loopActive
                    ? 'bg-primary text-bg-deepest border border-primary shadow-[0_0_0_3px_rgba(255,169,77,0.25)]'
                    : 'bg-white/[0.04] text-text-secondary border border-white/5 hover:text-text-primary',
                  !loopActive && (loopA == null || loopB == null) && 'opacity-40 cursor-not-allowed hover:text-text-secondary',
                )}
              >
                <Repeat className="w-3.5 h-3.5" />
                {loopActive ? 'Loop · ON' : 'Loop · off'}
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
  children, onClick, disabled, className, ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'h-9 w-9 grid place-items-center rounded-lg text-text-secondary hover:text-text-primary hover:bg-white/[0.04] transition-colors',
        disabled && 'opacity-30 cursor-not-allowed hover:bg-transparent hover:text-text-secondary',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}
