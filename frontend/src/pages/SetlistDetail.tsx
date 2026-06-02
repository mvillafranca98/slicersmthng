import { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft, GripVertical, Music2, Plus, Trash2, X } from 'lucide-react';
import { useSetlistStore } from '../stores/setlistStore';
import { useLibraryStore } from '../stores/libraryStore';
import { usePlayerStore } from '../stores/playerStore';
import { api } from '../api';
import { cn } from '../lib/cn';
import type { SetlistEntry, Song } from '../types';

function formatDuration(seconds: number) {
  if (!isFinite(seconds) || seconds <= 0) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function SetlistDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const setlists = useSetlistStore(s => s.setlists);
  const updateSetlist = useSetlistStore(s => s.updateSetlist);
  const deleteSetlist = useSetlistStore(s => s.deleteSetlist);
  const songs = useLibraryStore(s => s.songs);
  const [showAdd, setShowAdd] = useState(false);

  const setlist = setlists.find(s => s.id === id);

  // Local optimistic copy of the entries — kept in sync when the store updates,
  // but we mutate it immediately on drag/drop so the UI doesn't wait on the API.
  const [entries, setEntries] = useState<SetlistEntry[]>(setlist?.songs || []);

  // Drag state — null when nothing is being dragged.
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);

  useEffect(() => {
    // Re-sync from the store whenever the underlying setlist changes (e.g. add/remove)
    // but only when we aren't mid-drag so we don't fight the user's gesture.
    if (setlist && dragIndex == null) {
      setEntries(setlist.songs || []);
    }
  }, [setlist, dragIndex]);

  const songMap = useMemo(() => new Map(songs.map(s => [s.id, s])), [songs]);

  if (!setlist) {
    return (
      <div>
        <p className="text-text-muted">Setlist not found.</p>
        <button
          type="button"
          onClick={() => navigate('/setlists')}
          className="mt-4 text-primary hover:underline"
        >
          Back to setlists
        </button>
      </div>
    );
  }

  const persist = (next: SetlistEntry[]) => {
    setEntries(next);
    // Fire-and-forget — store handles errors. Optimistic UI already updated.
    void updateSetlist(setlist.id, { songs: next });
  };

  const addSong = (songId: string) => {
    persist([...entries, { song_id: songId, snapshot: null }]);
  };

  const removeSong = (songId: string) => {
    persist(entries.filter(e => e.song_id !== songId));
  };

  // ----- Drag handlers -----
  const onDragStart = (index: number) => (e: React.DragEvent<HTMLDivElement>) => {
    setDragIndex(index);
    // Required for Firefox to start the drag.
    e.dataTransfer.effectAllowed = 'move';
    try {
      e.dataTransfer.setData('text/plain', String(index));
    } catch {
      // Safari can throw in some edge cases — safe to ignore.
    }
  };

  const onDragOver = (index: number) => (e: React.DragEvent<HTMLDivElement>) => {
    if (dragIndex == null) return;
    e.preventDefault(); // Allow drop.
    e.dataTransfer.dropEffect = 'move';
    if (overIndex !== index) setOverIndex(index);
  };

  const onDrop = (index: number) => (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (dragIndex == null || dragIndex === index) {
      setDragIndex(null);
      setOverIndex(null);
      return;
    }
    const next = [...entries];
    const [moved] = next.splice(dragIndex, 1);
    next.splice(index, 0, moved);
    setDragIndex(null);
    setOverIndex(null);
    persist(next);
  };

  const onDragEnd = () => {
    setDragIndex(null);
    setOverIndex(null);
  };

  // Track click-vs-drag so a drag doesn't accidentally trigger a play.
  // We mark a row as "dragged" when dragstart fires; the click is suppressed
  // until the next pointerdown that isn't followed by a drag.
  const [suppressClick, setSuppressClick] = useState(false);

  const playSong = (song: Song, index: number) => {
    if (suppressClick) {
      setSuppressClick(false);
      return;
    }
    const ps = usePlayerStore.getState();
    // Register the setlist context AS WELL as setting the song. Without
    // this, the Next button in the player navigates by library order
    // instead of setlist order, and the end-of-song auto-advance plays
    // the wrong track. The order of calls also matters: setActiveSetlist
    // first so the queueIndex is correct by the time autoplay fires.
    if (setlist) ps.setActiveSetlist(setlist, index);
    ps.setCurrentSong(song);
    ps.setPlaying(true);
  };

  const availableToAdd = songs.filter(s => !entries.some(e => e.song_id === s.id));

  return (
    <div className="space-y-6 max-w-4xl">
      {/* ----- Header ----- */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => navigate('/setlists')}
          className="h-9 w-9 grid place-items-center rounded-lg text-text-secondary hover:text-text-primary hover:bg-white/[0.04] transition-colors"
          aria-label="Back to setlists"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <h2
          className="text-lg font-semibold text-text-primary"
          style={{ borderLeftColor: setlist.color, borderLeftWidth: 4, paddingLeft: 12 }}
        >
          {setlist.name}
        </h2>
        <span className="text-sm text-text-muted">
          {entries.length} {entries.length === 1 ? 'song' : 'songs'}
        </span>
        <button
          type="button"
          onClick={() => deleteSetlist(setlist.id).then(() => navigate('/setlists'))}
          className="ml-auto inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm text-accent-red hover:bg-accent-red/10 transition-colors"
        >
          <Trash2 className="w-3.5 h-3.5" />
          Delete setlist
        </button>
      </div>

      {/* ----- Setlist rows ----- */}
      {entries.length === 0 ? (
        <div className="card-elevated rounded-xl px-6 py-10 text-center">
          <p className="text-text-secondary">No songs yet. Add one below.</p>
        </div>
      ) : (
        <ul className="space-y-2">
          {entries.map((entry, i) => {
            const song = songMap.get(entry.song_id);
            const isDragging = dragIndex === i;
            const isOver = overIndex === i && dragIndex !== null && dragIndex !== i;
            const showTopBorder = isOver && dragIndex! > i;
            const showBottomBorder = isOver && dragIndex! < i;

            return (
              // Include the index in the key so duplicate song_ids in a
              // setlist (same track added twice) don't collide. With a
              // collision React fuses the two rows' DOM nodes and the click
              // handler on row N actually fires row 0's closure (whose
              // captured `song` is whichever was rendered first). That
              // looked exactly like "clicking row N plays the wrong song."
              <li key={`${entry.song_id}-${i}`}>
                <div
                  draggable
                  onDragStart={(e) => {
                    setSuppressClick(true);
                    onDragStart(i)(e);
                  }}
                  onDragOver={onDragOver(i)}
                  onDrop={onDrop(i)}
                  onDragEnd={onDragEnd}
                  onDragLeave={() => {
                    if (overIndex === i) setOverIndex(null);
                  }}
                  onClick={() => song && playSong(song, i)}
                  className={cn(
                    'card-elevated rounded-xl px-3 py-2.5 flex items-center gap-3 cursor-pointer transition-all',
                    'hover:border-primary/40 hover:shadow-[0_8px_28px_-12px_var(--primary-glow)]',
                    isDragging && 'opacity-50',
                    showTopBorder && 'border-t-2 border-t-primary',
                    showBottomBorder && 'border-b-2 border-b-primary',
                  )}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if ((e.key === 'Enter' || e.key === ' ') && song) {
                      e.preventDefault();
                      playSong(song, i);
                    }
                  }}
                >
                  {/* Drag handle */}
                  <div
                    className="shrink-0 text-text-muted hover:text-text-secondary cursor-grab active:cursor-grabbing"
                    aria-label="Drag to reorder"
                    title="Drag to reorder"
                  >
                    <GripVertical className="w-4 h-4" />
                  </div>

                  {/* Position number */}
                  <span className="shrink-0 w-6 text-center text-xs font-mono text-text-muted tabular-nums">
                    {i + 1}
                  </span>

                  {/* Thumbnail */}
                  <RowThumb song={song} />

                  {/* Title / artist / stems */}
                  <div className="min-w-0 flex-1">
                    {song ? (
                      <>
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-text-primary truncate">{song.title}</span>
                          {song.stems?.length ? (
                            <span className="shrink-0 text-[10px] font-mono text-text-muted bg-white/[0.04] border border-white/5 rounded px-1.5 py-px">
                              {song.stems.length} stems
                            </span>
                          ) : null}
                        </div>
                        <span className="text-xs text-text-secondary truncate block">{song.artist}</span>
                      </>
                    ) : (
                      <span className="text-text-muted text-sm">Loading…</span>
                    )}
                  </div>

                  {/* Duration */}
                  {song && (
                    <span className="shrink-0 text-[11px] font-mono text-text-muted tabular-nums">
                      {formatDuration(song.duration)}
                    </span>
                  )}

                  {/* Remove */}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      removeSong(entry.song_id);
                    }}
                    aria-label={`Remove ${song?.title ?? 'song'} from setlist`}
                    className="shrink-0 h-8 w-8 grid place-items-center rounded-lg text-text-muted hover:text-accent-red hover:bg-accent-red/10 transition-colors"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {/* ----- Add song section ----- */}
      <div className="space-y-3">
        {!showAdd ? (
          <button
            type="button"
            onClick={() => setShowAdd(true)}
            disabled={availableToAdd.length === 0}
            className="inline-flex items-center gap-2 rounded-lg bg-white/[0.04] border border-white/5 px-4 py-2 text-sm text-text-secondary hover:text-text-primary hover:border-primary/40 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <Plus className="w-4 h-4" />
            {availableToAdd.length === 0 ? 'All songs already added' : 'Add song'}
          </button>
        ) : (
          <div className="card-elevated rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="text-[10px] uppercase tracking-[0.12em] text-text-muted">
                Pick a song to add
              </div>
              <button
                type="button"
                onClick={() => setShowAdd(false)}
                className="h-7 w-7 grid place-items-center rounded text-text-muted hover:text-text-primary hover:bg-white/[0.04] transition-colors"
                aria-label="Close add picker"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            {availableToAdd.length === 0 ? (
              <p className="text-sm text-text-muted">Every song in your library is already in this setlist.</p>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2.5">
                <AnimatePresence initial={false}>
                  {availableToAdd.map((s, i) => (
                    <motion.button
                      key={s.id}
                      type="button"
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.96 }}
                      transition={{ duration: 0.18, delay: Math.min(i * 0.015, 0.15) }}
                      whileHover={{ y: -2 }}
                      whileTap={{ scale: 0.97 }}
                      onClick={() => addSong(s.id)}
                      className="text-left card-elevated rounded-lg overflow-hidden hover:border-primary/40 transition-colors group"
                    >
                      <div className="aspect-video relative bg-bg-elevated overflow-hidden">
                        <PickerThumb song={s} />
                        <div className="absolute inset-0 grid place-items-center bg-black/0 group-hover:bg-black/30 transition-colors">
                          <span className="opacity-0 group-hover:opacity-100 grid place-items-center w-9 h-9 rounded-full bg-primary text-white shadow-[0_8px_24px_-6px_var(--primary-glow)] transition-opacity">
                            <Plus className="w-4 h-4" />
                          </span>
                        </div>
                      </div>
                      <div className="p-2.5">
                        <p className="text-xs font-medium text-text-primary truncate">{s.title}</p>
                        <p className="text-[11px] text-text-secondary truncate">{s.artist}</p>
                      </div>
                    </motion.button>
                  ))}
                </AnimatePresence>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ----- Tiny presentational helpers -----

function RowThumb({ song }: { song: Song | undefined }) {
  const [errored, setErrored] = useState(false);
  if (!song) {
    return (
      <div className="shrink-0 w-12 h-12 rounded-md bg-bg-elevated grid place-items-center">
        <Music2 className="w-4 h-4 text-text-muted" />
      </div>
    );
  }
  const src = song.thumbnail_url || api.thumbnailUrl(song.id);
  if (errored) {
    return (
      <div className="shrink-0 w-12 h-12 rounded-md bg-bg-elevated grid place-items-center">
        <Music2 className="w-4 h-4 text-text-muted" />
      </div>
    );
  }
  return (
    <img
      src={src}
      alt=""
      loading="lazy"
      onError={() => setErrored(true)}
      className="shrink-0 w-12 h-12 rounded-md object-cover ring-1 ring-white/10"
    />
  );
}

function PickerThumb({ song }: { song: Song }) {
  const [errored, setErrored] = useState(false);
  const src = song.thumbnail_url || api.thumbnailUrl(song.id);
  if (errored) {
    return (
      <div className="w-full h-full grid place-items-center bg-gradient-to-br from-bg-elevated to-bg-deepest">
        <Music2 className="w-6 h-6 text-text-muted" />
      </div>
    );
  }
  return (
    <img
      src={src}
      alt=""
      loading="lazy"
      onError={() => setErrored(true)}
      className="w-full h-full object-cover"
    />
  );
}
