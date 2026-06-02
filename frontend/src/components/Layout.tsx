import { useEffect, useState } from 'react';
import { Outlet, NavLink, useLocation } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Home as HomeIcon, Library as LibraryIcon, ListMusic, Menu, Settings as SettingsIcon, Scissors, X } from 'lucide-react';
import { UrlBar } from './UrlBar';
import { PlayerBar } from './PlayerBar';
import { PlayerExpanded } from './PlayerExpanded';
import { ProcessingModal } from './ProcessingModal';
import { usePlayerStore } from '../stores/playerStore';
import { cn } from '../lib/cn';

const nav = [
  { path: '/', label: 'Home', Icon: HomeIcon, end: true },
  { path: '/library', label: 'Library', Icon: LibraryIcon, end: false },
  { path: '/setlists', label: 'Setlists', Icon: ListMusic, end: false },
  { path: '/settings', label: 'Settings', Icon: SettingsIcon, end: false },
];

export function Layout() {
  const expanded = usePlayerStore(s => s.expanded);
  const location = useLocation();
  // Mobile drawer state. The sidebar is always inline on >=lg viewports;
  // below that it becomes an off-canvas drawer toggled by the hamburger.
  const [menuOpen, setMenuOpen] = useState(false);
  // Close the drawer on every route change so navigating returns to content.
  useEffect(() => { setMenuOpen(false); }, [location.pathname]);

  return (
    <>
      <div className="flex min-h-screen">
        {/* Mobile backdrop — fades the content behind the open drawer */}
        {menuOpen && (
          <div
            className="fixed inset-0 bg-black/60 z-40 lg:hidden"
            onClick={() => setMenuOpen(false)}
            aria-hidden
          />
        )}

        <aside
          className={cn(
            'w-60 shrink-0 border-r border-white/5 bg-bg-deepest/95 backdrop-blur-md flex flex-col',
            // lg+: normal inline sidebar
            'lg:relative lg:translate-x-0',
            // <lg: fixed off-canvas drawer that slides in
            'fixed inset-y-0 left-0 z-50 transition-transform duration-200 ease-out',
            menuOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0',
          )}
        >
          <div className="px-5 py-5 border-b border-white/5 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <span className="grid place-items-center w-9 h-9 rounded-xl bg-gradient-to-br from-primary to-accent-cyan shadow-[0_6px_20px_-4px_rgba(108,99,255,0.5)]">
                <Scissors className="w-[18px] h-[18px] text-white" strokeWidth={2.5} />
              </span>
              <div className="leading-tight">
                <h1 className="text-[15px] font-bold tracking-tight text-text-primary">SlicerSmthng</h1>
                <p className="text-[10px] uppercase tracking-[0.12em] text-text-muted">practice workstation</p>
              </div>
            </div>
            {/* Close-X for the mobile drawer; hidden on desktop */}
            <button
              type="button"
              onClick={() => setMenuOpen(false)}
              aria-label="Close menu"
              className="lg:hidden h-8 w-8 grid place-items-center rounded-lg text-text-muted hover:text-text-primary hover:bg-white/[0.04]"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <nav className="flex-1 px-3 py-3 flex flex-col gap-0.5">
            {nav.map(({ path, label, Icon, end }) => (
              <NavLink
                key={path}
                to={path}
                end={end}
                className={({ isActive }) =>
                  cn(
                    'group relative flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors',
                    isActive
                      ? 'text-text-primary'
                      : 'text-text-secondary hover:text-text-primary hover:bg-white/[0.03]'
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    {isActive && (
                      <motion.span
                        layoutId="nav-active"
                        className="absolute inset-0 rounded-lg bg-primary/15 border border-primary/30 shadow-[0_0_0_1px_rgba(108,99,255,0.15)_inset,0_4px_20px_-6px_rgba(108,99,255,0.5)]"
                        transition={{ type: 'spring', stiffness: 500, damping: 35 }}
                      />
                    )}
                    <Icon className={cn('w-4 h-4 relative z-10', isActive ? 'text-primary' : 'text-current')} />
                    <span className="relative z-10">{label}</span>
                  </>
                )}
              </NavLink>
            ))}
          </nav>

          <div className="px-5 py-4 border-t border-white/5">
            <p className="text-[10px] text-text-muted leading-relaxed">
              Stems by <span className="text-text-secondary">Demucs</span> on Replicate GPU. Local-first library &amp; setlists.
            </p>
          </div>
        </aside>

        <main className="flex-1 flex flex-col min-w-0 pb-24">
          <header className="shrink-0 sticky top-0 z-30 px-4 lg:px-6 py-3 border-b border-white/5 bg-bg-deep/70 backdrop-blur-md flex items-center gap-3">
            {/* Hamburger on mobile, opens the sidebar drawer */}
            <button
              type="button"
              onClick={() => setMenuOpen(true)}
              aria-label="Open menu"
              className="lg:hidden h-9 w-9 shrink-0 grid place-items-center rounded-lg bg-white/[0.04] border border-white/5 text-text-secondary hover:text-text-primary"
            >
              <Menu className="w-4 h-4" />
            </button>
            <div className="flex-1 min-w-0">
              <UrlBar />
            </div>
          </header>
          <div className="flex-1 px-4 lg:px-6 py-4 lg:py-6 overflow-auto">
            <motion.div
              key={location.pathname}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.22, ease: [0.4, 0, 0.2, 1] }}
            >
              <Outlet />
            </motion.div>
          </div>
        </main>
      </div>

      <PlayerBar />
      {expanded && <PlayerExpanded />}
      <ProcessingModal />
    </>
  );
}
