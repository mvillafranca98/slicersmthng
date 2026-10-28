import { Loader2, X } from 'lucide-react';
import type { YouTubeSearchResult } from '../types';

export type SearchState =
  | { status: 'idle' }
  | { status: 'loading'; query: string }
  | { status: 'error'; query: string; message: string }
  | { status: 'done'; query: string; results: YouTubeSearchResult[] };

function formatTime(s: number) {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

interface Props {
  search: Exclude<SearchState, { status: 'idle' }>;
  disabled: boolean;
  onPick: (result: YouTubeSearchResult) => void;
  onClose: () => void;
}

/** Dropdown under the import bar: loading / error / empty / result rows. */
export function YouTubeResults({ search, disabled, onPick, onClose }: Props) {
  return (
    <div className="absolute left-0 right-0 top-full mt-2 z-40 rounded-xl bg-bg-elevated border border-white/10 shadow-2xl overflow-hidden">
      <div className="flex items-center justify-between gap-2 pl-3 pr-1.5 py-1.5 border-b border-white/5">
        <p className="text-xs text-text-secondary truncate" aria-live="polite">
          {search.status === 'loading' ? 'Searching YouTube…' : `YouTube results for “${search.query}”`}
        </p>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close search results"
          className="h-7 w-7 shrink-0 grid place-items-center rounded-md text-text-secondary hover:text-text-primary hover:bg-white/[0.06]"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {search.status === 'loading' && (
        <div className="flex items-center justify-center gap-2 px-3 py-8 text-sm text-text-secondary">
          <Loader2 className="w-4 h-4 animate-spin" />
          Searching…
        </div>
      )}

      {search.status === 'error' && (
        <p className="px-3 py-4 text-sm text-accent-red">Search failed: {search.message}</p>
      )}

      {search.status === 'done' && search.results.length === 0 && (
        <p className="px-3 py-4 text-sm text-text-secondary">No results. Try different words, or paste a link.</p>
      )}

      {search.status === 'done' && search.results.length > 0 && (
        <ul className="max-h-[60vh] overflow-y-auto py-1">
          {search.results.map(r => (
            <li key={r.id}>
              <button
                type="button"
                onClick={() => onPick(r)}
                disabled={disabled}
                className="w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-white/[0.05] focus-visible:bg-white/[0.07] focus-visible:outline-none disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <img
                  src={r.thumbnail}
                  alt=""
                  loading="lazy"
                  className="w-20 h-[45px] shrink-0 rounded object-cover bg-bg-card"
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm text-text-primary line-clamp-2">{r.title}</span>
                  <span className="block text-xs text-text-secondary truncate">
                    {[r.channel, r.duration != null ? formatTime(r.duration) : ''].filter(Boolean).join(' · ')}
                  </span>
                </span>
                <span className="hidden sm:inline shrink-0 text-xs font-medium text-primary">Slice</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
