import { motion } from 'framer-motion';
import { Loader2, AlertCircle, X, RefreshCw } from 'lucide-react';
import type { Job } from '../types';
import { useJobStore } from '../stores/jobStore';
import { cn } from '../lib/cn';

/** A library card stand-in for a song that's still being sliced (or failed).
 *  Renders next to real SongCards in Home / Library while jobs are running. */
export function PendingCard({ job }: { job: Job }) {
  const removeJob = useJobStore((s) => s.removeJob);
  const isError = job.status === 'error';
  const pct = Math.max(0, Math.min(100, job.percent ?? 0));
  const stage = (job.stage || '').replace(/_/g, ' ');

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.96 }}
      transition={{ duration: 0.22 }}
      className={cn(
        'card-elevated rounded-xl overflow-hidden min-w-[220px] relative',
        isError ? 'border-accent-red/40' : 'border-primary/30',
      )}
    >
      {/* Top: spinner / error icon + dismiss */}
      <div className="aspect-video relative grid place-items-center bg-gradient-to-br from-bg-elevated to-bg-deepest">
        {isError ? (
          <span className="grid place-items-center w-14 h-14 rounded-full bg-accent-red/15 border border-accent-red/40">
            <AlertCircle className="w-6 h-6 text-accent-red" />
          </span>
        ) : (
          <motion.span
            animate={{ rotate: 360 }}
            transition={{ duration: 1.2, ease: 'linear', repeat: Infinity }}
            className="grid place-items-center w-14 h-14 rounded-full border-2 border-primary/30 border-t-primary"
          >
            <Loader2 className="w-5 h-5 text-primary" />
          </motion.span>
        )}
        {/* Top-right dismiss (only on error, so users can clear failed entries) */}
        {isError && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); removeJob(job.job_id); }}
            aria-label="Dismiss failed import"
            className="absolute top-2 right-2 h-7 w-7 grid place-items-center rounded-md bg-black/40 text-text-secondary hover:text-text-primary backdrop-blur-sm"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Progress bar (only while running) */}
      {!isError && (
        <div className="absolute top-0 left-0 right-0 h-0.5 bg-white/[0.04]">
          <motion.div
            className="h-full progress-fill"
            animate={{ width: `${pct}%` }}
            transition={{ duration: 0.4, ease: 'easeOut' }}
          />
        </div>
      )}

      <div className="p-3.5">
        <h3 className="font-semibold text-sm text-text-primary truncate" title={job.title || job.job_id}>
          {job.title || 'Untitled import'}
        </h3>
        {isError ? (
          <p className="mt-1 text-xs text-accent-red line-clamp-2" title={job.error || ''}>
            {(job.error || 'Failed').slice(0, 80)}
          </p>
        ) : (
          <p className="mt-1 text-xs text-text-secondary truncate capitalize">
            {stage || 'Queued'}{stage ? ` · ${pct.toFixed(0)}%` : ''}
          </p>
        )}

        {/* Retry hint on error */}
        {isError && (
          <div className="mt-2 flex items-center gap-1 text-[10px] text-text-muted">
            <RefreshCw className="w-3 h-3" />
            Re-upload the file to try again
          </div>
        )}
      </div>
    </motion.div>
  );
}
