import { create } from 'zustand';
import type { Job, Song } from '../types';

interface JobState {
  jobs: Record<string, Job>;
  /** Add a new job. Optional title is shown in the library's pending card. */
  addJob: (jobId: string, title?: string) => void;
  updateJob: (jobId: string, patch: Partial<Job>) => void;
  completeJob: (jobId: string, song: Song) => void;
  failJob: (jobId: string, error: string) => void;
  getJob: (jobId: string) => Job | undefined;
  removeJob: (jobId: string) => void;
  /** Mark the job as dismissed by the user (modal hides; job keeps running). */
  dismissJob: (jobId: string) => void;
}

export const useJobStore = create<JobState>((set, get) => ({
  jobs: {},
  addJob: (jobId, title) =>
    set((s) => ({
      jobs: { ...s.jobs, [jobId]: { job_id: jobId, status: 'pending', title } },
    })),
  updateJob: (jobId, patch) => set(s => ({
    jobs: { ...s.jobs, [jobId]: { ...s.jobs[jobId], ...patch } as Job },
  })),
  completeJob: (jobId, song) => set(s => ({
    jobs: { ...s.jobs, [jobId]: { ...s.jobs[jobId], status: 'done', result: song, percent: 100 } as Job },
  })),
  failJob: (jobId, error) => set(s => ({
    jobs: { ...s.jobs, [jobId]: { ...s.jobs[jobId], status: 'error', error } as Job },
  })),
  getJob: (jobId) => get().jobs[jobId],
  removeJob: (jobId) => set(s => {
    const next = { ...s.jobs };
    delete next[jobId];
    return { jobs: next };
  }),
  dismissJob: (jobId) => set(s => {
    const j = s.jobs[jobId];
    if (!j) return s;
    return { jobs: { ...s.jobs, [jobId]: { ...j, dismissed: true } } };
  }),
}));
