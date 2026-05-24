import { useEffect } from 'react';
import { SongCard } from '../components/SongCard';
import { useLibraryStore } from '../stores/libraryStore';
import { usePlayerStore } from '../stores/playerStore';

export function Library() {
  const { filteredSongs, fetchSongs, isLoading, searchQuery, setSearchQuery, viewMode, setViewMode } = useLibraryStore();

  useEffect(() => {
    fetchSongs();
  }, [fetchSongs]);

  const songs = filteredSongs();

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-4">
        <input
          type="search"
          placeholder="Search by title or artist…"
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          className="rounded-lg bg-bg-card border border-white/10 px-4 py-2 w-72 text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-primary"
        />
        <div className="flex gap-1">
          <button
            type="button"
            onClick={() => setViewMode('grid')}
            className={`px-3 py-1.5 rounded-lg text-sm ${viewMode === 'grid' ? 'bg-primary text-white' : 'bg-bg-elevated text-text-secondary'}`}
          >
            Grid
          </button>
          <button
            type="button"
            onClick={() => setViewMode('list')}
            className={`px-3 py-1.5 rounded-lg text-sm ${viewMode === 'list' ? 'bg-primary text-white' : 'bg-bg-elevated text-text-secondary'}`}
          >
            List
          </button>
        </div>
      </div>
      {isLoading ? (
        <p className="text-text-muted">Loading library…</p>
      ) : songs.length === 0 ? (
        <p className="text-text-muted">No songs yet. Import from YouTube using the bar above.</p>
      ) : viewMode === 'list' ? (
        <div className="rounded-xl bg-bg-card border border-white/10 overflow-hidden">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-white/10 text-text-secondary text-sm">
                <th className="p-3 font-medium">Title</th>
                <th className="p-3 font-medium">Artist</th>
                <th className="p-3 font-medium">Duration</th>
                <th className="p-3 font-medium">BPM</th>
                <th className="p-3 font-medium">Key</th>
              </tr>
            </thead>
            <tbody>
              {songs.map(song => (
                <tr
                  key={song.id}
                  className="border-b border-white/5 hover:bg-bg-elevated/50 cursor-pointer"
                  onClick={() => usePlayerStore.getState().setCurrentSong(song)}
                >
                  <td className="p-3 font-medium text-text-primary">{song.title}</td>
                  <td className="p-3 text-text-secondary">{song.artist}</td>
                  <td className="p-3 font-mono text-sm text-text-muted">
                    {Math.floor(song.duration / 60)}:{(song.duration % 60).toFixed(0).padStart(2, '0')}
                  </td>
                  <td className="p-3 font-mono text-sm">{song.bpm}</td>
                  <td className="p-3 text-sm">{song.key}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-4">
          {songs.map(song => (
            <SongCard key={song.id} song={song} />
          ))}
        </div>
      )}
    </div>
  );
}
