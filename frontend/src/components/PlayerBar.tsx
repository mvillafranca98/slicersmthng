import { useState } from 'react';
import { ChevronsUp, Music2, Pause, Play, Repeat, Rewind, FastForward, SkipBack, SkipForward, Volume2 } from 'lucide-react';
import { usePlayerStore } from '../stores/playerStore';
import { useLibraryStore } from '../stores/libraryStore';
import { useAudioEngine } from '../hooks/useAudioEngine';
import { audioEngine } from '../lib/audioEngine';
import { api } from '../api';
import { cn } from '../lib/cn';

function formatTime(s: number) {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

export function PlayerBar() {
  const {
    currentSong,
    isPlaying,
    currentTime,
    duration,
    masterVolume,
    setMasterVolume,
    setPlaying,
    setExpanded,
    loopActive,
    setLoopActive,
    activeSetlist,
    queueIndex,
    setActiveSetlist,
    setCurrentSong,
  } = usePlayerStore();
  const librarySongs = useLibraryStore((s) => s.songs);
  const [imgError, setImgError] = useState(false);
  useAudioEngine();

  if (!currentSong) {
    return (
      <div className="fixed bottom-0 inset-x-0 h-20 glass border-t border-white/5 flex items-center justify-center text-text-muted text-sm z-[100]">
        No song loaded. Paste a YouTube link above to add your first song.
      </div>
    );
  }

  // currentSong is non-null past this point — safe to dereference.
  const seek = (t: number) => audioEngine.seek(t);

  const goToPrev = () => {
    if (currentTime > 3) { seek(0); return; }
    if (activeSetlist && queueIndex > 0) {
      const prevEntry = activeSetlist.songs[queueIndex - 1];
      const song = librarySongs.find((s) => s.id === prevEntry?.song_id);
      if (song) { setActiveSetlist(activeSetlist, queueIndex - 1); setCurrentSong(song); setPlaying(true); return; }
    }
    if (librarySongs.length > 1) {
      const idx = librarySongs.findIndex((s) => s.id === currentSong.id);
      if (idx > 0) { setCurrentSong(librarySongs[idx - 1]); setPlaying(true); return; }
    }
    seek(0);
  };
  const goToNext = () => {
    if (activeSetlist && queueIndex < activeSetlist.songs.length - 1) {
      const nextEntry = activeSetlist.songs[queueIndex + 1];
      const song = librarySongs.find((s) => s.id === nextEntry?.song_id);
      if (song) { setActiveSetlist(activeSetlist, queueIndex + 1); setCurrentSong(song); setPlaying(true); return; }
    }
    if (librarySongs.length > 1) {
      const idx = librarySongs.findIndex((s) => s.id === currentSong.id);
      const next = librarySongs[(idx + 1) % librarySongs.length];
      if (next) { setCurrentSong(next); setPlaying(true); }
    }
  };
  const hasPrev = currentTime > 3 || (activeSetlist != null && queueIndex > 0)
    || (librarySongs.length > 1 && librarySongs.findIndex((s) => s.id === currentSong.id) > 0);
  const hasNext = (activeSetlist != null && queueIndex < (activeSetlist.songs.length - 1))
    || (librarySongs.length > 1);

  const thumb = currentSong.thumbnail_url || api.thumbnailUrl(currentSong.id);
  const progressPct = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div className="fixed bottom-0 inset-x-0 h-20 glass border-t border-white/5 flex items-center gap-2 sm:gap-4 px-2 sm:px-4 z-[100]">
      {/* Song info: tight on mobile, 256px-wide column on desktop. BPM/key
          pills hidden on mobile to keep the row from wrapping. */}
      <div className="flex items-center gap-2 sm:gap-3 sm:w-64 shrink min-w-0">
        {!imgError ? (
          <img
            src={thumb}
            alt=""
            className="w-11 h-11 sm:w-12 sm:h-12 rounded-lg object-cover ring-1 ring-white/10 shrink-0"
            onError={() => setImgError(true)}
          />
        ) : (
          <div className="w-11 h-11 sm:w-12 sm:h-12 rounded-lg ring-1 ring-white/10 grid place-items-center bg-gradient-to-br from-bg-elevated to-bg-deepest shrink-0">
            <Music2 className="w-5 h-5 text-text-muted" />
          </div>
        )}
        <div className="min-w-0">
          <p className="font-medium text-text-primary truncate text-sm">{currentSong.title}</p>
          <p className="text-xs text-text-secondary truncate">{currentSong.artist}</p>
          <div className="hidden sm:flex gap-1.5 mt-1">
            <span className="text-[10px] font-mono text-text-primary bg-white/[0.04] border border-white/5 rounded px-1.5 py-px">
              ♩ {currentSong.bpm}
            </span>
            <span className="text-[10px] font-mono text-text-primary bg-white/[0.04] border border-white/5 rounded px-1.5 py-px">
              {currentSong.key}
            </span>
          </div>
        </div>
      </div>

      <div className="flex-1 flex flex-col gap-1.5 min-w-0 max-w-3xl mx-auto">
        <div className="flex items-center justify-center gap-1">
          <TransportButton
            aria-label={currentTime > 3 ? 'Restart song' : 'Previous song'}
            disabled={!hasPrev}
            onClick={goToPrev}
          >
            <SkipBack className="w-4 h-4" />
          </TransportButton>
          {/* Rewind / forward 10s hidden on mobile — saves room for the
              essentials (prev / play / next). Available in expanded player. */}
          <TransportButton aria-label="Rewind 10 seconds" onClick={() => seek(Math.max(0, currentTime - 10))} className="hidden sm:grid">
            <Rewind className="w-4 h-4" />
          </TransportButton>
          <button
            type="button"
            onClick={() => setPlaying(!isPlaying)}
            aria-label={isPlaying ? 'Pause' : 'Play'}
            className="w-11 h-11 rounded-full bg-primary hover:bg-primary-hover text-white grid place-items-center shadow-[0_4px_20px_-4px_rgba(108,99,255,0.6)] transition-transform active:scale-95"
          >
            {isPlaying ? <Pause className="w-4 h-4 fill-current" /> : <Play className="w-4 h-4 fill-current translate-x-px" />}
          </button>
          <TransportButton aria-label="Forward 10 seconds" onClick={() => seek(Math.min(duration, currentTime + 10))} className="hidden sm:grid">
            <FastForward className="w-4 h-4" />
          </TransportButton>
          <TransportButton aria-label="Next song" disabled={!hasNext} onClick={goToNext}>
            <SkipForward className="w-4 h-4" />
          </TransportButton>
        </div>
        {/* Progress bar — full-width even on mobile. Time labels hide on
            very narrow screens (<xs would be nice, but sm is the breakpoint). */}
        <div className="flex items-center gap-2">
          <span className="hidden sm:inline text-[11px] font-mono text-text-muted w-10 text-right tabular-nums">{formatTime(currentTime)}</span>
          <div className="relative flex-1 h-1.5 group">
            <div className="absolute inset-0 rounded-full bg-white/[0.06]" />
            <div className="absolute inset-y-0 left-0 rounded-full progress-fill" style={{ width: `${progressPct}%` }} />
            <input
              type="range"
              min={0}
              max={duration || 100}
              value={currentTime}
              onChange={e => seek(Number(e.target.value))}
              aria-label="Seek"
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
            />
          </div>
          <span className="hidden sm:inline text-[11px] font-mono text-text-muted w-10 tabular-nums">{formatTime(duration)}</span>
        </div>
      </div>

      {/* Right column — Loop + Volume hidden on mobile (they live in the
          expanded player anyway). Expand button stays so mobile users can
          still reach all controls. */}
      <div className="flex items-center gap-2 sm:w-56 shrink-0 justify-end">
        <button
          type="button"
          onClick={() => setLoopActive(!loopActive)}
          aria-pressed={loopActive}
          aria-label="Toggle loop"
          className={cn(
            'hidden md:inline-flex h-9 px-3 items-center gap-1.5 rounded-lg text-xs font-medium transition-colors',
            loopActive
              ? 'bg-primary/20 text-primary border border-primary/40'
              : 'bg-white/[0.03] text-text-secondary border border-white/5 hover:text-text-primary'
          )}
        >
          <Repeat className="w-3.5 h-3.5" />
          Loop
        </button>
        <button
          type="button"
          onClick={() => setExpanded(true)}
          aria-label="Expand player"
          className="h-9 w-9 grid place-items-center rounded-lg bg-white/[0.03] border border-white/5 text-text-secondary hover:text-text-primary transition-colors shrink-0"
        >
          <ChevronsUp className="w-4 h-4" />
        </button>
        <div className="hidden md:flex items-center gap-2 flex-1 max-w-[8rem]">
          <Volume2 className="w-4 h-4 text-text-muted" />
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={masterVolume}
            onChange={e => setMasterVolume(Number(e.target.value))}
            aria-label="Master volume"
            className="flex-1"
          />
        </div>
      </div>
    </div>
  );
}

function TransportButton({
  children,
  onClick,
  disabled,
  className,
  ...rest
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
