import { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Music, Search } from 'lucide-react';
import { toast } from 'sonner';
import { usePlayerStore } from '../stores/playerStore';
import { useLibraryStore } from '../stores/libraryStore';
import { audioEngine } from '../lib/audioEngine';
import { api } from '../api';
import { cn } from '../lib/cn';

interface LyricLine { time: number; text: string; }

/** Parse LRC-format synced lyrics into [time, text] pairs. */
function parseLRC(synced: string): LyricLine[] {
  const out: LyricLine[] = [];
  const re = /\[(\d+):(\d+)(?:\.(\d+))?\](.*)/;
  for (const raw of synced.split('\n')) {
    const m = raw.match(re);
    if (!m) continue;
    const min = parseInt(m[1], 10);
    const sec = parseInt(m[2], 10);
    const csStr = m[3] || '';
    const cs = csStr ? parseInt(csStr, 10) / Math.pow(10, csStr.length) : 0;
    const text = (m[4] || '').trim();
    if (text) out.push({ time: min * 60 + sec + cs, text });
  }
  return out.sort((a, b) => a.time - b.time);
}

/**
 * Synced or plain lyrics for the current song. Lazy-fetched from LRCLib
 * via our backend (which caches the response on R2).
 */
export function LyricsPanel() {
  const currentSong = usePlayerStore((s) => s.currentSong);
  const currentTime = usePlayerStore((s) => s.currentTime);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<Awaited<ReturnType<typeof api.lyrics>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  // ref attaches to the active lyric line (a <button>), so this must be
  // an HTMLButtonElement — production tsc -b catches the type mismatch.
  const activeRef = useRef<HTMLButtonElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Reset state when the song changes
  useEffect(() => {
    setData(null);
    setError(null);
    setLoading(false);
  }, [currentSong?.id]);

  const fetchLyrics = async () => {
    if (!currentSong || loading) return;
    setLoading(true);
    setError(null);
    try {
      const res = await api.lyrics(currentSong.id);
      setData(res);
      // Backend may have auto-corrected the song's title/artist via MusicBrainz
      // as a side effect. If so, update the player display and refresh the
      // library so the card shows the right name everywhere.
      const newTitle = (res as { title?: string }).title;
      const newArtist = (res as { artist?: string }).artist;
      if (newTitle && (newTitle !== currentSong.title || newArtist !== currentSong.artist)) {
        usePlayerStore.getState().setCurrentSong({ ...currentSong, title: newTitle, artist: newArtist || currentSong.artist });
        useLibraryStore.getState().fetchSongs();
        toast.success('Title corrected', {
          description: `${newArtist || currentSong.artist} — ${newTitle}`,
        });
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  // Parse synced lyrics + find active line
  const syncedLines = useMemo(
    () => (data?.synced ? parseLRC(data.synced) : []),
    [data?.synced],
  );
  const activeIdx = useMemo(() => {
    if (!syncedLines.length) return -1;
    let i = -1;
    for (let j = 0; j < syncedLines.length; j++) {
      if (syncedLines[j].time <= currentTime) i = j; else break;
    }
    return i;
  }, [syncedLines, currentTime]);

  // Auto-scroll active line so it stays centered as it advances.
  useEffect(() => {
    const el = activeRef.current;
    if (!el) return;
    // scrollIntoView with block:'center' is the most reliable cross-browser way
    // to keep an element vertically centered in its scrolling ancestor.
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [activeIdx]);

  if (!currentSong) return null;

  // ----- States -----
  if (!data && !loading && !error) {
    return (
      <div className="card-elevated rounded-xl p-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[10px] uppercase tracking-[0.12em] text-text-muted mb-0.5">Lyrics</div>
            <div className="text-sm text-text-secondary">No lyrics loaded yet for this song.</div>
          </div>
          <button
            type="button"
            onClick={fetchLyrics}
            className="h-9 px-3 inline-flex items-center gap-1.5 rounded-lg text-xs font-medium bg-primary/15 text-primary border border-primary/30 hover:bg-primary/25 transition-colors"
          >
            <Search className="w-3.5 h-3.5" />
            Find lyrics
          </button>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="card-elevated rounded-xl p-4 text-sm text-text-secondary">
        Searching LRCLib for synced lyrics…
      </div>
    );
  }

  if (error) {
    return (
      <div className="card-elevated rounded-xl p-4 text-sm text-accent-red">
        Failed to fetch lyrics: {error}
      </div>
    );
  }

  if (data?.instrumental) {
    return (
      <div className="card-elevated rounded-xl p-4 flex items-center gap-3 text-sm text-text-secondary">
        <Music className="w-4 h-4" />
        Marked as instrumental — no lyrics for this track.
      </div>
    );
  }

  if (data?.not_found || (!data?.synced && !data?.plain)) {
    return (
      <div className="card-elevated rounded-xl p-4 flex items-center justify-between">
        <span className="text-sm text-text-secondary">
          No lyrics found on LRCLib for this song.
        </span>
        <button
          type="button"
          onClick={fetchLyrics}
          className="h-8 px-3 rounded-lg text-xs text-text-secondary hover:text-text-primary bg-white/[0.04] border border-white/5"
        >
          Try again
        </button>
      </div>
    );
  }

  // ----- Synced lyrics (the magic case) -----
  if (syncedLines.length > 0) {
    return (
      <div className="card-elevated rounded-xl overflow-hidden">
        <div className="px-4 py-2 border-b border-white/5 flex items-center justify-between">
          <span className="text-[10px] uppercase tracking-[0.12em] text-text-muted">Lyrics · synced</span>
          <span className="text-[10px] text-text-muted">click a line to jump</span>
        </div>
        <div
          ref={containerRef}
          className="relative max-h-[280px] overflow-y-auto px-6 py-6 scroll-smooth"
          style={{
            maskImage: 'linear-gradient(to bottom, transparent, black 12%, black 88%, transparent)',
          }}
        >
          {syncedLines.map((line, i) => {
            const isActive = i === activeIdx;
            const distance = Math.abs(i - activeIdx);
            const opacity = activeIdx === -1
              ? 0.5
              : isActive ? 1 : Math.max(0.25, 1 - distance * 0.12);
            return (
              <motion.button
                key={`${line.time}-${i}`}
                ref={isActive ? activeRef : null}
                type="button"
                onClick={() => audioEngine.seek(line.time)}
                animate={{ opacity, scale: isActive ? 1.05 : 1 }}
                transition={{ duration: 0.22 }}
                className={cn(
                  'block w-full text-center py-1.5 transition-colors',
                  isActive
                    ? 'text-text-primary text-lg font-semibold'
                    : 'text-text-secondary text-sm hover:text-text-primary',
                )}
              >
                {line.text}
              </motion.button>
            );
          })}
        </div>
      </div>
    );
  }

  // ----- Plain lyrics fallback -----
  return (
    <div className="card-elevated rounded-xl overflow-hidden">
      <div className="px-4 py-2 border-b border-white/5 flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-[0.12em] text-text-muted">Lyrics · plain (not synced)</span>
      </div>
      <pre className="px-6 py-4 max-h-[280px] overflow-y-auto whitespace-pre-wrap font-sans text-sm text-text-secondary leading-relaxed">
        {data?.plain}
      </pre>
    </div>
  );
}
