import { create } from 'zustand';
import type { Setlist } from '../types';
import { api } from '../api';

interface SetlistState {
  setlists: Setlist[];
  isLoading: boolean;
  fetchSetlists: () => Promise<void>;
  createSetlist: (name: string, color: string) => Promise<Setlist>;
  updateSetlist: (id: string, data: { name?: string; color?: string; songs?: Setlist['songs'] }) => Promise<void>;
  deleteSetlist: (id: string) => Promise<void>;
}

export const useSetlistStore = create<SetlistState>((set) => ({
  setlists: [],
  isLoading: false,
  async fetchSetlists() {
    set({ isLoading: true });
    try {
      const setlists = await api.setlists();
      set({ setlists, isLoading: false });
    } catch {
      set({ isLoading: false });
    }
  },
  async createSetlist(name, color) {
    const created = await api.createSetlist(name, color);
    set(s => ({ setlists: [...s.setlists, { ...created, songs: created.songs || [] }] }));
    return created;
  },
  async updateSetlist(id, data) {
    await api.updateSetlist(id, data);
    const setlists = await api.setlists();
    set({ setlists });
  },
  async deleteSetlist(id) {
    await api.deleteSetlist(id);
    set(s => ({ setlists: s.setlists.filter(l => l.id !== id) }));
  },
}));
