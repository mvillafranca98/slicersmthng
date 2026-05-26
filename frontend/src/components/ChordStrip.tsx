import { useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { usePlayerStore } from '../stores/playerStore';
import { audioEngine } from '../lib/audioEngine';
import { cn } from '../lib/cn';

/**
 * Horizontally-scrolling chord strip. Current chord is centered + large,
 * adjacent chords fade out toward the edges. Click any chord to seek.
 *
 * Real chord detection is not yet wired (it needs a heavier model that
 * doesn't fit on Render free tier — task #13 moves it to Modal). Until
 * then this component degrades gracefully: shows a friendly placeholder
 * when the song's chord array is empty.
 */
export function ChordStrip() {
  const currentSong = usePlayerStore((s) => s.currentSong);
  const currentTime = usePlayerStore((s) => s.currentTime);

  const chords = currentSong?.chords || [];

  const windowed = useMemo(() => {
    if (!chords.length) return { items: [], activeIdx: -1 };
    let activeIdx = -1;
    for (let i = 0; i < chords.length; i++) {
      const next = chords[i + 1]?.time ?? Infinity;
      if (chords[i].time <= currentTime && next > currentTime) {
        activeIdx = i;
        break;
      }
    }
    if (activeIdx === -1) activeIdx = currentTime < (chords[0]?.time ?? 0) ? -1 : chords.length - 1;
    const span = 3;
    const start = Math.max(0, activeIdx - span);
    const end = Math.min(chords.length, activeIdx + span + 1);
    return {
      items: chords.slice(start, end).map((c, i) => ({ ...c, idxInWindow: i, absIdx: start + i })),
      activeIdx,
    };
  }, [chords, currentTime]);

  if (!currentSong) return null;

  if (!chords.length) {
    return (
      <div className="h-12 rounded-xl bg-bg-card border border-white/5 grid place-items-center">
        <span className="text-[11px] text-text-muted">
          Chord detection not run for this song.
          <span className="text-text-secondary"> (Coming when the chord model lands on Modal.)</span>
        </span>
      </div>
    );
  }

  return (
    <div className="relative h-14 rounded-xl bg-bg-card border border-white/5 overflow-hidden">
      {/* Edge fades to suggest scroll */}
      <div className="absolute inset-y-0 left-0 w-12 bg-gradient-to-r from-bg-card to-transparent z-10 pointer-events-none" />
      <div className="absolute inset-y-0 right-0 w-12 bg-gradient-to-l from-bg-card to-transparent z-10 pointer-events-none" />

      {/* Strip */}
      <div className="absolute inset-0 flex items-center justify-center gap-4 px-12">
        <AnimatePresence initial={false}>
          {windowed.items.map((c) => {
            const isActive = c.absIdx === windowed.activeIdx;
            const distance = Math.abs(c.absIdx - windowed.activeIdx);
            const opacity = isActive ? 1 : Math.max(0.25, 1 - distance * 0.28);
            return (
              <motion.button
                key={`${c.absIdx}-${c.chord}`}
                type="button"
                layoutId={`chord-${c.absIdx}`}
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity, scale: isActive ? 1 : 0.85 }}
                exit={{ opacity: 0, scale: 0.85 }}
                transition={{ type: 'spring', stiffness: 320, damping: 32 }}
                onClick={() => audioEngine.seek(c.time)}
                className={cn(
                  'font-mono leading-none transition-colors shrink-0',
                  isActive
                    ? 'text-3xl font-bold text-text-primary'
                    : 'text-base text-text-secondary hover:text-text-primary',
                )}
              >
                {c.chord}
              </motion.button>
            );
          })}
        </AnimatePresence>
      </div>
    </div>
  );
}
