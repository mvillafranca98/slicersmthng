import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useSetlistStore } from '../stores/setlistStore';
import { useLibraryStore } from '../stores/libraryStore';

export function SetlistDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const setlists = useSetlistStore(s => s.setlists);
  const updateSetlist = useSetlistStore(s => s.updateSetlist);
  const deleteSetlist = useSetlistStore(s => s.deleteSetlist);
  const songs = useLibraryStore(s => s.songs);
  const [showAdd, setShowAdd] = useState(false);
  const [songIdToAdd, setSongIdToAdd] = useState('');

  const setlist = setlists.find(s => s.id === id);
  const songMap = new Map(songs.map(s => [s.id, s]));

  useEffect(() => {
    if (!setlist) return;
  }, [setlist]);

  if (!setlist) {
    return (
      <div>
        <p className="text-text-muted">Setlist not found.</p>
        <button type="button" onClick={() => navigate('/setlists')} className="mt-4 text-primary hover:underline">
          Back to setlists
        </button>
      </div>
    );
  }

  const entries = setlist.songs || [];
  const addSong = () => {
    if (!songIdToAdd) return;
    updateSetlist(setlist.id, { songs: [...entries, { song_id: songIdToAdd, snapshot: null }] });
    setSongIdToAdd('');
    setShowAdd(false);
  };
  const removeSong = (songId: string) => {
    updateSetlist(setlist.id, { songs: entries.filter(e => e.song_id !== songId) });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4">
        <button type="button" onClick={() => navigate('/setlists')} className="text-text-secondary hover:text-text-primary">
          ← Back
        </button>
        <h2 className="text-lg font-semibold text-text-primary" style={{ borderLeftColor: setlist.color, borderLeftWidth: 4, paddingLeft: 12 }}>
          {setlist.name}
        </h2>
        <button
          type="button"
          onClick={() => deleteSetlist(setlist.id).then(() => navigate('/setlists'))}
          className="text-sm text-accent-red hover:underline"
        >
          Delete setlist
        </button>
      </div>
      {!showAdd ? (
        <button type="button" onClick={() => setShowAdd(true)} className="rounded-lg bg-bg-elevated px-4 py-2 text-sm text-text-secondary hover:text-text-primary">
          Add song
        </button>
      ) : (
        <div className="flex gap-2 items-center">
          <select
            value={songIdToAdd}
            onChange={e => setSongIdToAdd(e.target.value)}
            className="rounded-lg bg-bg-card border border-white/10 px-3 py-2 text-text-primary min-w-[200px]"
          >
            <option value="">Select a song…</option>
            {songs.filter(s => !entries.some(e => e.song_id === s.id)).map(s => (
              <option key={s.id} value={s.id}>{s.title} — {s.artist}</option>
            ))}
          </select>
          <button type="button" onClick={addSong} disabled={!songIdToAdd} className="rounded-lg bg-primary px-4 py-2 text-sm text-white disabled:opacity-50">
            Add
          </button>
          <button type="button" onClick={() => { setShowAdd(false); setSongIdToAdd(''); }} className="rounded-lg bg-bg-elevated px-4 py-2 text-sm text-text-secondary">
            Cancel
          </button>
        </div>
      )}
      <ul className="space-y-2">
        {entries.map((e, i) => {
          const song = songMap.get(e.song_id);
          return (
            <li
              key={e.song_id}
              className="flex items-center gap-4 rounded-lg bg-bg-card border border-white/10 px-4 py-2"
            >
              <span className="text-text-muted w-6">{i + 1}</span>
              {song ? (
                <>
                  <span className="font-medium text-text-primary">{song.title}</span>
                  <span className="text-text-secondary text-sm">{song.artist}</span>
                </>
              ) : (
                <span className="text-text-muted">Loading…</span>
              )}
              <button
                type="button"
                onClick={() => removeSong(e.song_id)}
                className="ml-auto text-sm text-accent-red hover:underline"
              >
                Remove
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
