import { useState, useCallback } from 'react';
import { useLibraryStore } from '../stores/libraryStore';
import { useJobStore } from '../stores/jobStore';
import { usePlayerStore } from '../stores/playerStore';
import { api } from '../api';
import { io } from 'socket.io-client';

const API_BASE = import.meta.env.DEV ? '' : (window.location.origin);
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
  const fetchSongs = useLibraryStore(s => s.fetchSongs);
  const addJob = useJobStore(s => s.addJob);
  const updateJob = useJobStore(s => s.updateJob);
  const completeJob = useJobStore(s => s.completeJob);
  const failJob = useJobStore(s => s.failJob);

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const t = (e.clipboardData?.getData('text') || '').trim();
    if (t && (t.includes('youtube.com') || t.includes('youtu.be'))) {
      e.preventDefault();
      setUrl(t);
    }
  }, []);

  const handleImport = useCallback(async () => {
    const u = url.trim();
    if (!u || !u.includes('youtube')) return;
    setImporting(true);
    try {
      const { job_id } = await api.importUrl(u, model, format);
      addJob(job_id);
      const s = getSocket();
      s.on('job:progress', (data: { job_id: string; stage: string; percent: number; message: string }) => {
        if (data.job_id === job_id) updateJob(job_id, { status: 'running', stage: data.stage, percent: data.percent, message: data.message });
      });
      s.on('job:complete', (data: { job_id: string; song: import('../types').Song }) => {
        if (data.job_id === job_id) {
          completeJob(job_id, data.song);
          fetchSongs();
          usePlayerStore.getState().setCurrentSong(data.song);
        }
      });
      s.on('job:error', (data: { job_id: string; error: string }) => {
        if (data.job_id === job_id) failJob(job_id, data.error);
      });
      const poll = setInterval(async () => {
        const status = await api.jobStatus(job_id);
        if (status.status === 'done' && status.result) {
          clearInterval(poll);
          completeJob(job_id, status.result);
          fetchSongs();
          usePlayerStore.getState().setCurrentSong(status.result);
        } else if (status.status === 'error') {
          clearInterval(poll);
          failJob(job_id, status.error || 'Unknown error');
        } else {
          updateJob(job_id, { stage: status.stage, percent: status.percent, message: status.message });
        }
      }, 1500);
    } catch (e) {
      failJob(Object.keys(useJobStore.getState().jobs)[0] || 'unknown', (e as Error).message);
    } finally {
      setImporting(false);
    }
  }, [url, model, format, addJob, updateJob, completeJob, failJob, fetchSongs]);

  return (
    <div className="flex flex-col gap-2 w-full max-w-2xl">
      <div className="flex gap-2 items-center">
        <input
          type="text"
          placeholder="Paste YouTube URL (Cmd+V)"
          value={url}
          onChange={e => setUrl(e.target.value)}
          onPaste={handlePaste}
          className="flex-1 rounded-lg bg-bg-card border border-white/10 px-4 py-2.5 text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-primary"
        />
        <button
          type="button"
          onClick={() => setShowOptions(!showOptions)}
          className="rounded-lg bg-bg-elevated px-3 py-2.5 text-sm text-text-secondary"
        >
          Options
        </button>
        <button
          type="button"
          onClick={handleImport}
          disabled={!url.trim() || importing}
          className="rounded-lg bg-primary hover:bg-primary-hover px-6 py-2.5 font-semibold text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {importing ? 'Slicing…' : 'Slice It'}
        </button>
      </div>
      {showOptions && (
        <div className="flex gap-4 text-sm">
          <label className="flex items-center gap-2 text-text-secondary">
            Model
            <select
              value={model}
              onChange={e => setModel(e.target.value)}
              className="rounded bg-bg-card border border-white/10 px-2 py-1 text-text-primary"
            >
              <option value="htdemucs">htdemucs (fast, 4 stems)</option>
              <option value="htdemucs_ft">htdemucs_ft (best, 4 stems)</option>
              <option value="htdemucs_6s">htdemucs_6s (6 stems)</option>
            </select>
          </label>
          <label className="flex items-center gap-2 text-text-secondary">
            Format
            <select
              value={format}
              onChange={e => setFormat(e.target.value)}
              className="rounded bg-bg-card border border-white/10 px-2 py-1 text-text-primary"
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
