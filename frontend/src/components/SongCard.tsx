import { useState } from 'react';
import { motion } from 'framer-motion';
import { Play, Music2 } from 'lucide-react';
import type { Song } from '../types';
import { api } from '../api';
import { usePlayerStore } from '../stores/playerStore';
import { cn } from '../lib/cn';

const STEM_COLORS: Record<string, string> = {
  vocals: 'bg-stem-vocals',
  drums: 'bg-stem-drums',
  bass: 'bg-stem-bass',
  guitar: 'bg-stem-guitar',
  piano: 'bg-stem-piano',
  other: 'bg-stem-other',
};

export function SongCard({ song }: { song: Song }) {
  const setCurrentSong = usePlayerStore(s => s.setCurrentSong);
  const [imgError, setImgError] = useState(false);
  const thumb = song.thumbnail_url || api.thumbnailUrl(song.id);
  const mins = Math.floor(song.duration / 60);
  const secs = Math.floor(song.duration % 60);
  const durationStr = `${mins}:${secs.toString().padStart(2, '0')}`;

  return (
    <motion.button
      type="button"
      onClick={() => setCurrentSong(song)}
      whileHover={{ y: -4 }}
      whileTap={{ scale: 0.98 }}
      transition={{ type: 'spring', stiffness: 400, damping: 28 }}
      className="group text-left card-elevated rounded-xl overflow-hidden hover:border-primary/40 hover:shadow-[0_12px_40px_-12px_var(--primary-glow)] focus-visible:border-primary/60 w-full"
    >
      <div className="aspect-video relative bg-bg-elevated overflow-hidden">
        {!imgError ? (
          <img
            src={thumb}
            alt=""
            loading="lazy"
            className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-[1.04]"
            onError={() => setImgError(true)}
          />
        ) : (
          <div className="w-full h-full grid place-items-center bg-gradient-to-br from-bg-elevated to-bg-deepest">
            <Music2 className="w-8 h-8 text-text-muted" />
          </div>
        )}

        {/* Bottom gradient + pills */}
        <div className="absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-black/85 via-black/40 to-transparent" />
        <div className="absolute bottom-2 left-2 right-2 flex gap-1.5 flex-wrap">
          <span className="rounded-md bg-black/55 backdrop-blur-sm border border-white/10 px-1.5 py-0.5 text-[10px] font-mono text-text-primary">
            ♩ {song.bpm}
          </span>
          <span className="rounded-md bg-black/55 backdrop-blur-sm border border-white/10 px-1.5 py-0.5 text-[10px] font-mono text-text-primary">
            {song.key}
          </span>
        </div>

        {/* Play overlay on hover */}
        <div className="absolute inset-0 grid place-items-center bg-black/0 group-hover:bg-black/30 transition-colors duration-200">
          <motion.span
            initial={false}
            animate={{ opacity: 0, scale: 0.85 }}
            whileHover={{ opacity: 1, scale: 1 }}
            className="grid place-items-center w-12 h-12 rounded-full bg-primary text-white shadow-[0_8px_30px_-6px_rgba(108,99,255,0.7)] opacity-0 group-hover:opacity-100 transition-opacity"
          >
            <Play className="w-5 h-5 fill-current translate-x-px" />
          </motion.span>
        </div>
      </div>

      <div className="p-3.5">
        <h3 className="font-semibold text-sm text-text-primary truncate">{song.title}</h3>
        <p className="text-xs text-text-secondary truncate mt-0.5">{song.artist}</p>
        <div className="flex items-center justify-between mt-2.5">
          <div className="flex gap-1" aria-label="Available stems">
            {(song.stems || []).slice(0, 6).map(name => (
              <span
                key={name}
                className={cn('w-1.5 h-1.5 rounded-full', STEM_COLORS[name] || 'bg-stem-other')}
                title={name}
              />
            ))}
          </div>
          <span className="text-[10px] text-text-muted font-mono tabular-nums">{durationStr}</span>
        </div>
      </div>
    </motion.button>
  );
}
