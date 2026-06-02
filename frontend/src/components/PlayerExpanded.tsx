import { useCallback, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { toast } from 'sonner';
import {
  ChevronDown,
  Check,
  Music2,
  Pause,
  Pencil,
  Play,
  Repeat,
  Repeat1,
  Rewind,
  FastForward,
  Shuffle,
  SkipBack,
  SkipForward,
  Square,
  Volume2,
  VolumeX,
  Magnet,
  Timer,
  X,
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
    bpmOverride,
    setBpmOverride,
    beatOffsetSec,
    setBeatOffsetSec,
    playMode,
    setPlayMode,
  } = usePlayerStore();
  const librarySongs = useLibraryStore((s) => s.songs);
  const fetchSongs = useLibraryStore((s) => s.fetchSongs);
  const [snapToBeat, setSnapToBeat] = useState(true);
  const [imgError, setImgError] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editArtist, setEditArtist] = useState('');
  // Tap-Tempo state. Wall-clock taps measure tempo (intervals match
  // playback intervals at 100% speed); the last tap's song-time sets
  // phase so the click grid passes through the user's tap.
  const tapTimesRef = useRef<{ wall: number; song: number }[]>([]);
  const tapResetTimerRef = useRef<number | null>(null);
  const [tapCount, setTapCount] = useState(0); // drives the button label

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
  // Prev: >3s in = rewind to start. Else setlist prev, then library prev, then rewind.
  // Next: setlist next, then library next. Wraps library at end.
  const goToPrev = () => {
    if (currentTime > 3) { seek(0); return; }
    if (activeSetlist && queueIndex > 0) {
      const prevEntry = activeSetlist.songs[queueIndex - 1];
      const song = librarySongs.find((s) => s.id === prevEntry?.song_id);
      if (song) { setActiveSetlist(activeSetlist, queueIndex - 1); setCurrentSong(song); return; }
    }
    if (librarySongs.length > 1) {
      const idx = librarySongs.findIndex((s) => s.id === currentSong.id);
      if (idx > 0) { setCurrentSong(librarySongs[idx - 1]); return; }
    }
    seek(0);
  };
  const goToNext = () => {
    if (activeSetlist && queueIndex < activeSetlist.songs.length - 1) {
      const nextEntry = activeSetlist.songs[queueIndex + 1];
      const song = librarySongs.find((s) => s.id === nextEntry?.song_id);
      if (song) { setActiveSetlist(activeSetlist, queueIndex + 1); setCurrentSong(song); return; }
    }
    if (librarySongs.length > 1) {
      const idx = librarySongs.findIndex((s) => s.id === currentSong.id);
      const next = librarySongs[(idx + 1) % librarySongs.length];
      if (next) setCurrentSong(next);
    }
  };
  const hasPrev = currentTime > 3 || (activeSetlist != null && queueIndex > 0)
    || (librarySongs.length > 1 && librarySongs.findIndex((s) => s.id === currentSong.id) > 0);
  const hasNext = (activeSetlist != null && queueIndex < (activeSetlist.songs.length - 1))
    || (librarySongs.length > 1);

  // ---- Play mode cycle ----
  const PLAY_MODE_ORDER: Array<typeof playMode> = ['continue', 'repeat', 'shuffle', 'stop'];
  const PLAY_MODE_META: Record<typeof playMode, { icon: typeof Repeat; label: string; title: string }> = {
    continue: { icon: Repeat, label: 'Continue', title: 'When the song ends, play the next one' },
    repeat: { icon: Repeat1, label: 'Repeat', title: 'When the song ends, play it again' },
    shuffle: { icon: Shuffle, label: 'Shuffle', title: 'When the song ends, pick a random next song' },
    stop: { icon: Square, label: 'Stop', title: 'When the song ends, stop playback' },
  };
  // Fall back to 'continue' if playMode somehow doesn't match — prevents render crash
  // from a stale or corrupted localStorage value.
  const playModeMeta = PLAY_MODE_META[playMode] || PLAY_MODE_META.continue;
  const PlayModeIcon = playModeMeta.icon;
  const cyclePlayMode = () => {
    const idx = PLAY_MODE_ORDER.indexOf(playMode);
    setPlayMode(PLAY_MODE_ORDER[(idx + 1) % PLAY_MODE_ORDER.length]);
  };

  // ---- Title / artist edit ----
  const beginEdit = () => {
    setEditTitle(currentSong.title || '');
    setEditArtist(currentSong.artist || '');
    setEditing(true);
  };
  const cancelEdit = () => setEditing(false);
  const saveEdit = async () => {
    const newTitle = editTitle.trim();
    if (!newTitle) return;
    try {
      const updated = await api.updateSongMeta(currentSong.id, newTitle, editArtist.trim());
      setCurrentSong({ ...currentSong, title: updated.title, artist: updated.artist, cover_url: updated.cover_url });
      fetchSongs();
      toast.success(`Updated to ${updated.artist} — ${updated.title}`, {
        description: 'Lyrics + cover art will refresh when you click them.',
      });
      setImgError(false);  // give cover a chance to reload
    } catch (e) {
      toast.error('Failed to update metadata', { description: (e as Error).message });
    }
    setEditing(false);
  };

  // ---- Tap Tempo ----
  // Click 4+ times in time with the music; we average the inter-tap
  // intervals to set BPM and align the click grid to the most recent tap.
  // Drops the buffer after 2s of inactivity so a new set of taps starts fresh.
  const handleTap = () => {
    const wall = performance.now() / 1000;
    const song = currentTime;
    const taps = tapTimesRef.current;
    const lastWall = taps.length ? taps[taps.length - 1].wall : 0;
    const next = (taps.length && wall - lastWall > 2)
      ? [{ wall, song }]                       // gap too big → restart
      : [...taps, { wall, song }].slice(-8);    // keep the last 8
    tapTimesRef.current = next;
    setTapCount(next.length);

    if (next.length >= 4) {
      let totalGap = 0;
      for (let i = 1; i < next.length; i++) totalGap += next[i].wall - next[i - 1].wall;
      const avg = totalGap / (next.length - 1);
      if (avg > 0.2 && avg < 2.0) {
        const tappedBpm = Math.round(60 / avg);
        setBpmOverride(tappedBpm);
        // Phase: shift the click grid so a click lands on the last tap's
        // song-time. Modulo into [0, beatPeriod) then map to [-2, +2]
        // by subtracting beatPeriod when the offset is closer to the
        // next beat than the previous one (keeps slider value visible).
        const beatPeriod = 60 / tappedBpm;
        let phase = next[next.length - 1].song % beatPeriod;
        if (phase > beatPeriod / 2) phase -= beatPeriod;
        setBeatOffsetSec(phase);
      }
    }

    if (tapResetTimerRef.current) window.clearTimeout(tapResetTimerRef.current);
    tapResetTimerRef.current = window.setTimeout(() => {
      tapTimesRef.current = [];
      setTapCount(0);
    }, 3000);
  };

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
      style={{ height: '100vh' }}
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
          {!editing ? (
            <>
              <div className="flex items-center gap-2 min-w-0">
                <h2 className="text-base font-semibold text-text-primary truncate">{currentSong.title}</h2>
                <button
                  type="button"
                  onClick={beginEdit}
                  aria-label="Edit title + artist"
                  title="Edit title + artist (re-fetches lyrics + cover art)"
                  className="h-6 w-6 grid place-items-center rounded text-text-muted hover:text-text-primary hover:bg-white/[0.04] shrink-0"
                >
                  <Pencil className="w-3 h-3" />
                </button>
              </div>
              <p className="text-sm text-text-secondary truncate">{currentSong.artist}</p>
            </>
          ) : (
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-1.5">
                <input
                  type="text"
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') saveEdit(); if (e.key === 'Escape') cancelEdit(); }}
                  placeholder="Title"
                  autoFocus
                  className="flex-1 min-w-0 rounded bg-bg-card border border-primary/40 px-2 py-1 text-sm text-text-primary focus:outline-none focus:ring-1 focus:ring-primary"
                />
                <button
                  type="button"
                  onClick={saveEdit}
                  aria-label="Save"
                  className="h-7 w-7 grid place-items-center rounded bg-primary text-bg-deepest"
                >
                  <Check className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={cancelEdit}
                  aria-label="Cancel"
                  className="h-7 w-7 grid place-items-center rounded bg-white/[0.04] text-text-secondary hover:text-text-primary"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
              <input
                type="text"
                value={editArtist}
                onChange={(e) => setEditArtist(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') saveEdit(); if (e.key === 'Escape') cancelEdit(); }}
                placeholder="Artist"
                className="rounded bg-bg-card border border-white/10 px-2 py-1 text-xs text-text-secondary focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
          )}
          {!editing && (
            <div className="flex gap-1.5 mt-1">
              <span className="text-[10px] font-mono text-text-primary bg-white/[0.04] border border-white/5 rounded px-1.5 py-px">
                ♩ {Math.round(bpmOverride ?? bpm)}{bpmOverride != null && <span className="text-primary"> ✎</span>}
              </span>
              <span className="text-[10px] font-mono text-text-primary bg-white/[0.04] border border-white/5 rounded px-1.5 py-px">
                {currentSong.key || 'Unknown'}
              </span>
              {tempoPercent !== 100 && (
                <span className="text-[10px] font-mono text-primary bg-primary/15 border border-primary/30 rounded px-1.5 py-px">
                  {tempoPercent}%
                </span>
              )}
            </div>
          )}
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
            title="Next song"
            disabled={!hasNext}
            onClick={goToNext}
          >
            <SkipForward className="w-4 h-4" />
          </TransportButton>
          <TransportButton
            aria-label={`Play mode: ${playModeMeta.label}`}
            title={playModeMeta.title}
            onClick={cyclePlayMode}
            className={cn(
              playMode === 'stop'
                ? 'text-text-muted'
                : 'text-primary hover:text-primary',
            )}
          >
            <PlayModeIcon className="w-4 h-4" />
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

            {/* BPM override + beat phase offset */}
            <div className="mt-4 rounded-xl bg-bg-card/60 border border-white/5 p-3">
              <div className="flex items-center justify-between mb-2">
                <div className="text-[10px] uppercase tracking-[0.12em] text-text-muted">BPM</div>
                <button
                  type="button"
                  onClick={() => { setBpmOverride(null); setBeatOffsetSec(0); }}
                  disabled={bpmOverride == null && beatOffsetSec === 0}
                  className="text-[10px] text-text-muted hover:text-text-primary disabled:opacity-30"
                >
                  reset
                </button>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={30}
                  max={300}
                  step={1}
                  value={bpmOverride ?? Math.round(bpm)}
                  onChange={(e) => setBpmOverride(Number(e.target.value))}
                  aria-label="BPM override"
                  className="w-16 rounded bg-bg-card border border-white/10 px-2 py-1 text-xs font-mono text-text-primary text-center focus:outline-none focus:ring-1 focus:ring-primary"
                />
                <button
                  type="button"
                  onClick={() => bpmOverride && setBpmOverride(bpmOverride * 2)}
                  title="Double — fix half-time detection"
                  className="h-7 px-2 rounded text-[10px] font-mono bg-white/[0.04] border border-white/5 text-text-secondary hover:text-text-primary"
                >×2</button>
                <button
                  type="button"
                  onClick={() => bpmOverride && setBpmOverride(bpmOverride / 2)}
                  title="Halve — fix double-time detection"
                  className="h-7 px-2 rounded text-[10px] font-mono bg-white/[0.04] border border-white/5 text-text-secondary hover:text-text-primary"
                >÷2</button>
                <button
                  type="button"
                  onClick={handleTap}
                  title="Tap 4+ times in time with the music to set BPM + phase"
                  className={cn(
                    'h-7 px-2 rounded text-[10px] font-mono border transition-colors',
                    tapCount >= 4
                      ? 'bg-primary/20 text-primary border-primary/40'
                      : tapCount > 0
                        ? 'bg-primary/10 text-primary border-primary/20'
                        : 'bg-white/[0.04] text-text-secondary border-white/5 hover:text-text-primary',
                  )}
                >
                  Tap{tapCount > 0 ? ` ${tapCount}` : ''}
                </button>
                <div className="flex-1 ml-2">
                  <label className="block text-[9px] text-text-muted mb-0.5">Phase {beatOffsetSec.toFixed(2)}s</label>
                  <input
                    type="range"
                    min={-2}
                    max={2}
                    step={0.01}
                    value={beatOffsetSec}
                    onChange={(e) => setBeatOffsetSec(Number(e.target.value))}
                    aria-label="Beat phase offset"
                    className="w-full"
                  />
                </div>
              </div>
              <p className="mt-1 text-[10px] text-text-muted">If the metronome is off, try ×2 / ÷2 or <strong>Tap</strong> 4+ times in time with the music. Phase slider for fine-tuning.</p>
            </div>

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
