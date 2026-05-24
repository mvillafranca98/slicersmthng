const BASE = '/api/v1';

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options?.headers },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((err as { error?: string }).error || res.statusText);
  }
  return res.json() as Promise<T>;
}

export const api = {
  importUrl: (url: string, model: string, format: string) =>
    request<{ job_id: string }>('/import', {
      method: 'POST',
      body: JSON.stringify({ url, model, format }),
    }),
  jobStatus: (jobId: string) =>
    request<{ status: string; stage?: string; percent?: number; message?: string; result?: import('./types').Song; error?: string }>(`/jobs/${jobId}`),
  songs: () =>
    request<{ songs: import('./types').Song[] }>('/songs').then(r => r.songs),
  song: (id: string) =>
    request<import('./types').Song>(`/songs/${id}`),
  deleteSong: (id: string) =>
    request<{ ok: boolean }>(`/songs/${id}`, { method: 'DELETE' }),
  stemUrl: (songId: string, stem: string) => `${BASE}/songs/${songId}/stems/${stem}`,
  thumbnailUrl: (songId: string) => `${BASE}/songs/${songId}/thumbnail`,
  saveSnapshot: (songId: string, snapshot: import('./types').MixSnapshot) =>
    request<{ ok: boolean }>(`/songs/${songId}/snapshots`, {
      method: 'POST',
      body: JSON.stringify(snapshot),
    }),
  getSnapshot: (songId: string) =>
    request<{ snapshot: import('./types').MixSnapshot | null }>(`/songs/${songId}/snapshots`).then(r => r.snapshot),
  saveNotes: (songId: string, notes: string) =>
    request<{ ok: boolean }>(`/songs/${songId}/notes`, {
      method: 'PUT',
      body: JSON.stringify({ notes }),
    }),
  setlists: () =>
    request<{ setlists: import('./types').Setlist[] }>('/setlists').then(r => r.setlists),
  createSetlist: (name: string, color: string) =>
    request<import('./types').Setlist>('/setlists', {
      method: 'POST',
      body: JSON.stringify({ name, color }),
    }),
  updateSetlist: (id: string, data: { name?: string; color?: string; songs?: import('./types').SetlistEntry[] }) =>
    request<import('./types').Setlist>(`/setlists/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),
  deleteSetlist: (id: string) =>
    request<{ ok: boolean }>(`/setlists/${id}`, { method: 'DELETE' }),
};
