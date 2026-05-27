import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { CheckCircle2, Circle, Loader2, X, AlertCircle, Sparkles } from 'lucide-react';
import { useJobStore } from '../stores/jobStore';
import { cn } from '../lib/cn';

// Backend stages from backend/jobs.py — keep in sync.
const STAGES: { key: string; label: string }[] = [
  { key: 'validating', label: 'Validating URL' },
  { key: 'downloading', label: 'Fetching audio' },
  { key: 'uploading', label: 'Uploading to GPU' },
  { key: 'separating', label: 'AI separating stems' },
  { key: 'organizing', label: 'Downloading stems' },
  { key: 'analyzing', label: 'Analyzing BPM' },
  { key: 'finalizing', label: 'Finalizing' },
];

const STEM_BANDS = ['#FF6B8A', '#FFB347', '#00E5C3', '#5BDB6B', '#C47FFF', '#8899AA'];

export function ProcessingModal() {
  const jobs = useJobStore(s => s.jobs);
  const removeJob = useJobStore(s => s.removeJob);
  const dismissJob = useJobStore(s => s.dismissJob);

  // Skip jobs the user has explicitly dismissed in every state — once you
  // close the modal, it stays closed. The pending card in the library shows
  // continuing progress / errors; toasts confirm completion.
  const running = Object.entries(jobs).find(([, j]) =>
    (j.status === 'running' || j.status === 'pending') && !j.dismissed
  );
  const lastError = Object.entries(jobs).find(([, j]) => j.status === 'error' && !j.dismissed);
  const lastDone = Object.entries(jobs).find(([, j]) => j.status === 'done' && !j.dismissed);

  // Show running > error > done. Auto-dismiss "done" after 2.5s.
  const [showDone, setShowDone] = useState<string | null>(null);
  useEffect(() => {
    if (lastDone && !running && !lastError) {
      setShowDone(lastDone[0]);
      const t = setTimeout(() => setShowDone(null), 2500);
      return () => clearTimeout(t);
    }
  }, [lastDone, running, lastError]);

  const active = running ?? (lastError as typeof running) ?? (showDone ? lastDone : undefined);
  if (!active) return null;
  const [jobId, job] = active;
  const isRunning = job.status === 'running' || job.status === 'pending';
  const isError = job.status === 'error';
  const isDone = job.status === 'done' && showDone === jobId;

  const stageIdx = (() => {
    const i = STAGES.findIndex(s => s.key === (job.stage || '').toLowerCase());
    return i === -1 ? 0 : i;
  })();
  const percent = Math.max(0, Math.min(100, job.percent ?? 0));

  return (
    <AnimatePresence>
      <motion.div
        key="backdrop"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.18 }}
        className="fixed inset-0 z-[200] grid place-items-center bg-black/70 backdrop-blur-md p-4"
        role="dialog"
        aria-label="Processing"
      >
        <motion.div
          key="card"
          initial={{ opacity: 0, scale: 0.96, y: 8 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.96, y: 8 }}
          transition={{ duration: 0.22, ease: [0.34, 1.56, 0.64, 1] }}
          className="card-elevated rounded-2xl w-full max-w-md overflow-hidden"
        >
          <StemBandsHeader active={isRunning} progress={percent} />

          <div className="p-6">
            {isError && (
              <ErrorView
                error={job.error || 'Something went wrong.'}
                onDismiss={() => removeJob(jobId)}
              />
            )}

            {isDone && (
              <SuccessView onDismiss={() => { removeJob(jobId); setShowDone(null); }} />
            )}

            {isRunning && (
              <RunningView
                stageIdx={stageIdx}
                percent={percent}
                message={job.message || ''}
                onDismiss={() => dismissJob(jobId)}
              />
            )}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

function StemBandsHeader({ active, progress }: { active: boolean; progress: number }) {
  return (
    <div className="relative h-20 overflow-hidden bg-bg-deepest">
      <div className="absolute inset-0 flex">
        {STEM_BANDS.map((color, i) => (
          <motion.div
            key={color}
            className="flex-1 origin-center"
            style={{ background: `linear-gradient(180deg, ${color}66, ${color}11 70%, transparent)` }}
            animate={
              active
                ? {
                    scaleY: [0.4, 1, 0.4],
                    opacity: [0.6, 1, 0.6],
                  }
                : { scaleY: 1, opacity: 0.85 }
            }
            transition={
              active
                ? {
                    duration: 1.6,
                    repeat: Infinity,
                    delay: i * 0.12,
                    ease: 'easeInOut',
                  }
                : { duration: 0.3 }
            }
          />
        ))}
      </div>
      <div className="absolute inset-x-0 bottom-0 h-px bg-white/10" />
      <div
        className="absolute inset-x-0 bottom-0 h-px progress-fill transition-[width] duration-500"
        style={{ width: `${progress}%` }}
      />
    </div>
  );
}

function RunningView({ stageIdx, percent, message, onDismiss }: {
  stageIdx: number; percent: number; message: string; onDismiss: () => void;
}) {
  return (
    <>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold text-text-primary">Slicing…</h3>
          <p className="text-text-secondary text-sm mt-1">{message || 'Processing your track on a cloud GPU.'}</p>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss — keep slicing in the background"
          title="Dismiss — slicing continues, watch progress in the library"
          className="-mt-1 -mr-1 h-8 w-8 grid place-items-center rounded-md text-text-muted hover:text-text-primary hover:bg-white/[0.04]"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <ol className="mt-5 space-y-1.5">
        {STAGES.map((stage, i) => {
          const state =
            i < stageIdx ? 'done' :
            i === stageIdx ? 'active' :
            'pending';
          return (
            <li key={stage.key} className="flex items-center gap-2.5 text-sm">
              {state === 'done' && <CheckCircle2 className="w-4 h-4 text-accent-cyan shrink-0" strokeWidth={2.5} />}
              {state === 'active' && <Loader2 className="w-4 h-4 text-primary shrink-0 animate-spin" strokeWidth={2.5} />}
              {state === 'pending' && <Circle className="w-4 h-4 text-text-muted shrink-0" />}
              <span className={cn(
                state === 'done' && 'text-text-secondary',
                state === 'active' && 'text-text-primary font-medium',
                state === 'pending' && 'text-text-muted',
              )}>
                {stage.label}
              </span>
            </li>
          );
        })}
      </ol>

      <div className="mt-5 flex items-center justify-between text-xs font-mono text-text-muted">
        <span>{percent.toFixed(0)}%</span>
        <span className="text-text-secondary">~30 sec separation + ~10 sec analysis</span>
      </div>
    </>
  );
}

function SuccessView({ onDismiss }: { onDismiss: () => void }) {
  return (
    <div className="text-center py-2">
      <motion.div
        initial={{ scale: 0, rotate: -180 }}
        animate={{ scale: 1, rotate: 0 }}
        transition={{ type: 'spring', stiffness: 260, damping: 18 }}
        className="mx-auto w-14 h-14 rounded-full bg-gradient-to-br from-primary to-accent-cyan grid place-items-center shadow-[0_8px_30px_-6px_rgba(108,99,255,0.6)]"
      >
        <Sparkles className="w-6 h-6 text-white" strokeWidth={2.5} />
      </motion.div>
      <h3 className="mt-4 text-lg font-semibold text-text-primary">Sliced!</h3>
      <p className="mt-1 text-sm text-text-secondary">Your song is in the library and loaded in the player.</p>
      <button
        type="button"
        onClick={onDismiss}
        className="mt-4 text-xs text-text-muted hover:text-text-primary"
      >
        Dismiss
      </button>
    </div>
  );
}

function ErrorView({ error, onDismiss }: { error: string; onDismiss: () => void }) {
  return (
    <>
      <div className="flex items-start gap-3">
        <span className="grid place-items-center w-9 h-9 shrink-0 rounded-full bg-accent-red/15 border border-accent-red/40">
          <AlertCircle className="w-4 h-4 text-accent-red" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-base font-semibold text-text-primary">Slicing failed</h3>
          <p className="mt-1 text-sm text-text-secondary break-words">{error}</p>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className="text-text-muted hover:text-text-primary"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
      {error.toLowerCase().includes('replicate_api_token') && (
        <div className="mt-4 p-3 rounded-lg bg-bg-elevated border border-white/5 text-xs text-text-secondary">
          Set the env var before starting the server:
          <code className="block mt-1 font-mono text-text-primary">export REPLICATE_API_TOKEN=r8_…</code>
          Get one at{' '}
          <a
            href="https://replicate.com/account/api-tokens"
            target="_blank"
            rel="noreferrer"
            className="text-primary hover:underline"
          >
            replicate.com/account/api-tokens
          </a>
          .
        </div>
      )}
    </>
  );
}
