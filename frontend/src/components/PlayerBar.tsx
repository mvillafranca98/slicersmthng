import { ChevronsUp, Pause, Play, Repeat, Rewind, FastForward, SkipBack, SkipForward, Volume2 } from 'lucide-react';
import { usePlayerStore } from '../stores/playerStore';
import { useAudioEngine } from '../hooks/useAudioEngine';
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
    seek,
  } = usePlayerStore();
  useAudioEngine();

  if (!currentSong) {
    return (
      <div className="fixed bottom-0 inset-x-0 h-20 glass border-t border-white/5 flex items-center justify-center text-text-muted text-sm z-[100]">
        No song loaded. Paste a YouTube link above to add your first song.
      </div>
    );
  }

  const thumb = currentSong.thumbnail_url || api.thumbnailUrl(currentSong.id);
  const progressPct = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div className="fixed bottom-0 inset-x-0 h-20 glass border-t border-white/5 flex items-center gap-4 px-4 z-[100]">
      <div className="flex items-center gap-3 w-64 shrink-0 min-w-0">
        <img src={thumb} alt="" className="w-12 h-12 rounded-lg object-cover ring-1 ring-white/10" />
        <div className="min-w-0">
          <p className="font-medium text-text-primary truncate text-sm">{currentSong.title}</p>
          <p className="text-xs text-text-secondary truncate">{currentSong.artist}</p>
          <div className="flex gap-1.5 mt-1">
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
          <TransportButton aria-label="Previous"><SkipBack className="w-4 h-4" /></TransportButton>
          <TransportButton aria-label="Rewind 10 seconds" onClick={() => seek(Math.max(0, currentTime - 10))}>
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
          <TransportButton aria-label="Forward 10 seconds" onClick={() => seek(Math.min(duration, currentTime + 10))}>
            <FastForward className="w-4 h-4" />
          </TransportButton>
          <TransportButton aria-label="Next"><SkipForward className="w-4 h-4" /></TransportButton>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-mono text-text-muted w-10 text-right tabular-nums">{formatTime(currentTime)}</span>
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
          <span className="text-[11px] font-mono text-text-muted w-10 tabular-nums">{formatTime(duration)}</span>
        </div>
      </div>

      <div className="flex items-center gap-2 w-56 shrink-0 justify-end">
        <button
          type="button"
          onClick={() => setLoopActive(!loopActive)}
          aria-pressed={loopActive}
          aria-label="Toggle loop"
          className={cn(
            'h-9 px-3 inline-flex items-center gap-1.5 rounded-lg text-xs font-medium transition-colors',
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
          className="h-9 w-9 grid place-items-center rounded-lg bg-white/[0.03] border border-white/5 text-text-secondary hover:text-text-primary transition-colors"
        >
          <ChevronsUp className="w-4 h-4" />
        </button>
        <div className="flex items-center gap-2 flex-1 max-w-[8rem]">
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
  ...rest
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
