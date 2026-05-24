import { create } from 'zustand';
import type { Job, Song } from '../types';

interface JobState {
  jobs: Record<string, Job>;
  addJob: (jobId: string) => void;
  updateJob: (jobId: string, patch: Partial<Job>) => void;
  completeJob: (jobId: string, song: Song) => void;
  failJob: (jobId: string, error: string) => void;
  getJob: (jobId: string) => Job | undefined;
  removeJob: (jobId: string) => void;
}

export const useJobStore = create<JobState>((set, get) => ({
  jobs: {},
  addJob: (jobId) => set(s => ({ jobs: { ...s.jobs, [jobId]: { job_id: jobId, status: 'pending' } } })),
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
}));
