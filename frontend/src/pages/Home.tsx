import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ListMusic, Plus, Disc3 } from 'lucide-react';
import { SongCard } from '../components/SongCard';
import { useLibraryStore } from '../stores/libraryStore';
import { useSetlistStore } from '../stores/setlistStore';

const STEM_COLORS = ['#FF6B8A', '#FFB347', '#00E5C3', '#5BDB6B', '#C47FFF', '#8899AA'];

export function Home() {
  const songs = useLibraryStore(s => s.songs);
  const fetchSongs = useLibraryStore(s => s.fetchSongs);
  const setlists = useSetlistStore(s => s.setlists);
  const fetchSetlists = useSetlistStore(s => s.fetchSetlists);

  useEffect(() => {
    fetchSongs();
    fetchSetlists();
  }, [fetchSongs, fetchSetlists]);

  const recent = songs.slice(0, 5);

  return (
    <div className="space-y-10 max-w-7xl">
      <section>
        <SectionHeader title="Recent songs" subtitle="Your last 5 imports" />
        {recent.length === 0 ? (
          <EmptyLibrary />
        ) : (
          <motion.div
            initial="hidden"
            animate="show"
            variants={{ hidden: {}, show: { transition: { staggerChildren: 0.05 } } }}
            className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4"
          >
            {recent.map(song => (
              <motion.div
                key={song.id}
                variants={{ hidden: { opacity: 0, y: 8 }, show: { opacity: 1, y: 0 } }}
                transition={{ duration: 0.25 }}
              >
                <SongCard song={song} />
              </motion.div>
            ))}
          </motion.div>
        )}
      </section>

      <section>
        <SectionHeader
          title="Setlists"
          subtitle="Practice your gig from start to finish"
          action={
            <Link
              to="/setlists"
              className="inline-flex items-center gap-1.5 text-xs font-medium text-text-secondary hover:text-text-primary transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              New setlist
            </Link>
          }
        />
        {setlists.length === 0 ? (
          <EmptySetlists />
        ) : (
          <div className="flex flex-wrap gap-3">
            {setlists.map(sl => (
              <Link
                key={sl.id}
                to={`/setlists/${sl.id}`}
                className="card-elevated rounded-xl px-4 py-3 hover:border-primary/40 transition-colors"
                style={{ borderLeftColor: sl.color, borderLeftWidth: 3 }}
              >
                <div className="flex items-center gap-2">
                  <ListMusic className="w-4 h-4 text-text-secondary" />
                  <span className="font-medium text-sm text-text-primary">{sl.name}</span>
                  <span className="text-text-muted text-xs">{(sl.songs || []).length} songs</span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function SectionHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-end justify-between mb-4">
      <div>
        <h2 className="text-lg font-semibold tracking-tight text-text-primary">{title}</h2>
        {subtitle && <p className="text-xs text-text-muted mt-0.5">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

function EmptyLibrary() {
  return (
    <div className="card-elevated rounded-2xl px-6 py-12 grid place-items-center text-center">
      <div className="relative w-20 h-20 grid place-items-center mb-5">
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ duration: 14, ease: 'linear', repeat: Infinity }}
          className="absolute inset-0 rounded-full border border-white/10"
        />
        <Disc3 className="w-10 h-10 text-text-secondary" strokeWidth={1.5} />
        <div className="absolute -inset-2 flex">
          {STEM_COLORS.map((color, i) => (
            <motion.span
              key={color}
              animate={{ opacity: [0.3, 1, 0.3] }}
              transition={{ duration: 2.2, repeat: Infinity, delay: i * 0.18, ease: 'easeInOut' }}
              className="absolute w-1.5 h-1.5 rounded-full"
              style={{
                background: color,
                top: '50%',
                left: '50%',
                transform: `rotate(${i * 60}deg) translate(48px) translate(-50%, -50%)`,
              }}
            />
          ))}
        </div>
      </div>
      <h3 className="text-base font-semibold text-text-primary">Start your practice library</h3>
      <p className="text-sm text-text-secondary mt-1 max-w-xs">
        Paste a YouTube link in the bar above and click <span className="text-text-primary font-medium">Slice It</span>.
        Stems land here in about 30 seconds.
      </p>
    </div>
  );
}

function EmptySetlists() {
  return (
    <div className="rounded-xl border border-dashed border-white/10 px-5 py-6 text-sm text-text-secondary">
      <Link to="/setlists" className="text-primary hover:underline font-medium">
        Create a setlist
      </Link>{' '}
      to group songs for a gig or practice session. Mixes are saved per song so you can pick up where you left off.
    </div>
  );
}
