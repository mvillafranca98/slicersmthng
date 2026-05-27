import { useCallback, useRef, useState } from 'react';
import { Upload, Sparkles } from 'lucide-react';
import { io } from 'socket.io-client';
import { toast } from 'sonner';
import { useLibraryStore } from '../stores/libraryStore';
import { useJobStore } from '../stores/jobStore';
import { usePlayerStore } from '../stores/playerStore';
import { api } from '../api';
import { cn } from '../lib/cn';

const API_BASE = import.meta.env.DEV ? '' : window.location.origin;

/** Pull a display title out of a URL — e.g. "youtube.com/watch?v=..." → "YouTube · ..." */
function prettyUrlTitle(url: string): string {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, '').split('.')[0];
    return `${host.charAt(0).toUpperCase() + host.slice(1)} · ${u.pathname.split('/').pop() || u.searchParams.get('v') || 'track'}`;
  } catch {
    return url.slice(0, 80);
  }
}

/** Trim .mp3 / .wav / etc and use the same "Artist - Title" heuristics as the backend. */
function prettyFileTitle(filename: string): string {
  const stem = filename.replace(/\.[^.]+$/, '');
  return stem.replace(/^\s*\d{1,2}\s*[-.\s]\s*/, '');
}
let socket: ReturnType<typeof io> | null = null;
function getSocket() {
  if (!socket) socket = io(API_BASE, { path: '/socket.io', transports: ['websocket', 'polling'] });
  return socket;
}

export function UrlBar() {
  const [url, setUrl] = useState('');
  const [model, setModel] = useState('htdemucs');
  const [format, setFormat] = useState('mp3');
  const [importing, setImporting] = useState(false);
  const [showOptions, setShowOptions] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const fetchSongs = useLibraryStore(s => s.fetchSongs);
  const addJob = useJobStore(s => s.addJob);
  const updateJob = useJobStore(s => s.updateJob);
  const completeJob = useJobStore(s => s.completeJob);
  const failJob = useJobStore(s => s.failJob);

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const t = (e.clipboardData?.getData('text') || '').trim();
    if (t && (t.startsWith('http://') || t.startsWith('https://'))) {
      e.preventDefault();
      setUrl(t);
    }
  }, []);

  const wireJob = useCallback((jobId: string, opts?: { silent?: boolean; label?: string; title?: string }) => {
    const silent = opts?.silent;
    const label = opts?.label;
    addJob(jobId, opts?.title || label);
    const s = getSocket();
    s.on('job:progress', (data: { job_id: string; stage: string; percent: number; message: string }) => {
      if (data.job_id === jobId) updateJob(jobId, { status: 'running', stage: data.stage, percent: data.percent, message: data.message });
    });
    s.on('job:complete', (data: { job_id: string; song: import('../types').Song }) => {
      if (data.job_id === jobId) {
        completeJob(jobId, data.song);
        fetchSongs();
        // Bulk imports: toast on each completion but don't yank the player to
        // every new song. Single imports: load the song in the player as usual.
        if (silent) {
          toast.success(`Sliced: ${data.song.title}`, {
            description: `${data.song.stems?.length || 0} stems${data.song.bpm ? ` · ${Math.round(data.song.bpm)} BPM` : ''}`,
          });
        } else {
          usePlayerStore.getState().setCurrentSong(data.song);
        }
      }
    });
    s.on('job:error', (data: { job_id: string; error: string }) => {
      if (data.job_id === jobId) {
        failJob(jobId, data.error);
        if (silent) toast.error(`Slice failed: ${label || 'track'}`, { description: data.error.slice(0, 140) });
      }
    });
    // Robust polling: keeps trying through transient errors (Render cold starts,
    // dropped sockets, brief network blips). Hard cap at 30 min so it doesn't
    // poll forever if the job actually died silently.
    let transientErrors = 0;
    const startedAt = Date.now();
    const HARD_CAP_MS = 30 * 60 * 1000;
    const poll = setInterval(async () => {
      if (Date.now() - startedAt > HARD_CAP_MS) {
        clearInterval(poll);
        failJob(jobId, 'Job took longer than 30 minutes. Check the library — it may have finished.');
        return;
      }
      try {
        const status = await api.jobStatus(jobId);
        transientErrors = 0;
        if (status.status === 'done' && status.result) {
          clearInterval(poll);
          completeJob(jobId, status.result);
          fetchSongs();
          if (silent) {
            toast.success(`Sliced: ${status.result.title}`, {
              description: `${status.result.stems?.length || 0} stems${status.result.bpm ? ` · ${Math.round(status.result.bpm)} BPM` : ''}`,
            });
          } else {
            usePlayerStore.getState().setCurrentSong(status.result);
          }
        } else if (status.status === 'error') {
          clearInterval(poll);
          failJob(jobId, status.error || 'Unknown error');
          if (silent) toast.error(`Slice failed: ${label || 'track'}`, { description: (status.error || '').slice(0, 140) });
        } else {
          updateJob(jobId, { stage: status.stage, percent: status.percent, message: status.message });
          // Periodically re-fetch the library so a finished song still appears
          // even if our job-status polling somehow misses the transition.
          if (Math.random() < 0.05) fetchSongs();
        }
      } catch {
        // Transient — don't kill the poll. Allow up to 20 misses (~30s) before
        // giving up and trusting the library refresh to catch the finished song.
        transientErrors++;
        if (transientErrors > 20) {
          clearInterval(poll);
          fetchSongs();
          failJob(jobId, 'Lost connection to job status. If the song appears in your library, it worked.');
        }
      }
    }, 1500);
  }, [addJob, updateJob, completeJob, failJob, fetchSongs]);

  const handleImport = useCallback(async () => {
    const u = url.trim();
    if (!u || !(u.startsWith('http://') || u.startsWith('https://'))) return;
    setImporting(true);
    try {
      const { job_id } = await api.importUrl(u, model, format);
      wireJob(job_id, { title: prettyUrlTitle(u) });
    } catch (e) {
      failJob(Object.keys(useJobStore.getState().jobs)[0] || 'unknown', (e as Error).message);
    } finally {
      setImporting(false);
    }
  }, [url, model, format, wireJob, failJob]);

  const handleFiles = useCallback(async (files: File[]) => {
    if (!files.length) return;
    setImporting(true);
    const bulk = files.length > 1;
    if (bulk) toast.message(`Slicing ${files.length} tracks…`, { description: 'They\'ll land in your library as each one finishes.' });
    try {
      // Kick off all uploads in parallel. Each gets its own job, its own
      // poll loop, its own toast on completion.
      await Promise.all(files.map(async (file) => {
        try {
          const { job_id } = await api.importFile(file, model, format);
          wireJob(job_id, { silent: bulk, label: file.name, title: prettyFileTitle(file.name) });
        } catch (e) {
          if (bulk) {
            toast.error(`Upload failed: ${file.name}`, { description: (e as Error).message.slice(0, 140) });
          } else {
            failJob(Object.keys(useJobStore.getState().jobs)[0] || 'unknown', (e as Error).message);
          }
        }
      }));
    } finally {
      setImporting(false);
    }
  }, [model, format, wireJob, failJob]);

  return (
    <div className="flex flex-col gap-2 w-full max-w-3xl">
      <div className="flex gap-2 items-center">
        <input
          type="text"
          placeholder="Paste a SoundCloud, Bandcamp, YouTube, or direct audio URL"
          value={url}
          onChange={e => setUrl(e.target.value)}
          onPaste={handlePaste}
          onKeyDown={e => { if (e.key === 'Enter') handleImport(); }}
          className="flex-1 rounded-lg bg-bg-card border border-white/10 px-4 py-2.5 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
        />

        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          title="Upload one or more audio files (MP3, WAV, FLAC, M4A) — bulk import is supported"
          className="h-10 w-10 grid place-items-center rounded-lg bg-bg-card border border-white/10 text-text-secondary hover:text-text-primary hover:border-white/20 transition-colors shrink-0"
          aria-label="Upload audio files"
        >
          <Upload className="w-4 h-4" />
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".mp3,.wav,.flac,.m4a,.aac,.ogg,.opus,audio/*"
          multiple
          className="hidden"
          onChange={e => {
            const files = Array.from(e.target.files || []);
            if (files.length) handleFiles(files);
            e.target.value = '';
          }}
        />

        <button
          type="button"
          onClick={() => setShowOptions(!showOptions)}
          aria-expanded={showOptions}
          className="h-10 px-3 rounded-lg bg-bg-card border border-white/10 text-xs text-text-secondary hover:text-text-primary hover:border-white/20 transition-colors shrink-0"
        >
          Options
        </button>

        <button
          type="button"
          onClick={handleImport}
          disabled={!url.trim() || importing}
          className={cn(
            'h-10 px-5 rounded-lg inline-flex items-center gap-1.5 font-medium text-sm text-white transition-all shrink-0',
            'bg-gradient-to-r from-primary to-primary-hover shadow-[0_4px_20px_-6px_rgba(255,169,77,0.7)]',
            'hover:shadow-[0_6px_28px_-6px_rgba(255,169,77,0.9)] active:scale-[0.98]',
            'disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none'
          )}
        >
          <Sparkles className="w-3.5 h-3.5" />
          {importing ? 'Slicing…' : 'Slice It'}
        </button>
      </div>

      {showOptions && (
        <div className="flex gap-4 text-xs px-1">
          <label className="flex items-center gap-2 text-text-secondary">
            Model
            <select
              value={model}
              onChange={e => setModel(e.target.value)}
              className="rounded bg-bg-card border border-white/10 px-2 py-1 text-text-primary focus:outline-none focus:ring-1 focus:ring-primary"
            >
              <option value="htdemucs">htdemucs (fast, 4 stems)</option>
              <option value="htdemucs_ft">htdemucs_ft (best, 4 stems)</option>
              <option value="htdemucs_6s">htdemucs_6s (6 stems + guitar/piano)</option>
            </select>
          </label>
          <label className="flex items-center gap-2 text-text-secondary">
            Format
            <select
              value={format}
              onChange={e => setFormat(e.target.value)}
              className="rounded bg-bg-card border border-white/10 px-2 py-1 text-text-primary focus:outline-none focus:ring-1 focus:ring-primary"
            >
              <option value="mp3">MP3 320kbps</option>
              <option value="flac">FLAC</option>
            </select>
          </label>
        </div>
      )}
    </div>
  );
}
