import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useSetlistStore } from '../stores/setlistStore';

export function Setlists() {
  const setlists = useSetlistStore(s => s.setlists);
  const fetchSetlists = useSetlistStore(s => s.fetchSetlists);
  const createSetlist = useSetlistStore(s => s.createSetlist);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');

  useEffect(() => {
    fetchSetlists();
  }, [fetchSetlists]);

  const handleCreate = async () => {
    if (!newName.trim()) return;
    await createSetlist(newName.trim(), '#6C63FF');
    setNewName('');
    setCreating(false);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-text-primary">Setlists</h2>
        {!creating ? (
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="rounded-lg bg-primary hover:bg-primary-hover px-4 py-2 text-sm font-medium text-white"
          >
            New setlist
          </button>
        ) : (
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="Setlist name"
              value={newName}
              onChange={e => setNewName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleCreate()}
              className="rounded-lg bg-bg-card border border-white/10 px-3 py-2 text-text-primary"
            />
            <button type="button" onClick={handleCreate} className="rounded-lg bg-primary px-4 py-2 text-sm text-white">
              Create
            </button>
            <button type="button" onClick={() => { setCreating(false); setNewName(''); }} className="rounded-lg bg-bg-elevated px-4 py-2 text-sm text-text-secondary">
              Cancel
            </button>
          </div>
        )}
      </div>
      {setlists.length === 0 && !creating ? (
        <p className="text-text-muted">No setlists. Create one to group songs for a gig or practice session.</p>
      ) : (
        <div className="grid gap-3">
          {setlists.map(sl => (
            <Link
              key={sl.id}
              to={`/setlists/${sl.id}`}
              className="rounded-xl bg-bg-card border border-white/10 p-4 flex items-center gap-4 hover:border-primary/50 transition-colors"
              style={{ borderLeftColor: sl.color, borderLeftWidth: 4 }}
            >
              <span className="font-medium text-text-primary">{sl.name}</span>
              <span className="text-text-muted text-sm">{(sl.songs || []).length} songs</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
