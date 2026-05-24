import { create } from 'zustand';
import type { Song } from '../types';
import { api } from '../api';

interface LibraryState {
  songs: Song[];
  isLoading: boolean;
  searchQuery: string;
  viewMode: 'grid' | 'list';
  fetchSongs: () => Promise<void>;
  setSearchQuery: (q: string) => void;
  setViewMode: (m: 'grid' | 'list') => void;
  filteredSongs: () => Song[];
}

export const useLibraryStore = create<LibraryState>((set, get) => ({
  songs: [],
  isLoading: false,
  searchQuery: '',
  viewMode: 'grid',
  async fetchSongs() {
    set({ isLoading: true });
    try {
      const songs = await api.songs();
      set({ songs, isLoading: false });
    } catch {
      set({ isLoading: false });
    }
  },
  setSearchQuery: (q) => set({ searchQuery: q }),
  setViewMode: (m) => set({ viewMode: m }),
  filteredSongs() {
    const { songs, searchQuery } = get();
    if (!searchQuery.trim()) return songs;
    const q = searchQuery.toLowerCase();
    return songs.filter(s => s.title.toLowerCase().includes(q) || (s.artist || '').toLowerCase().includes(q));
  },
}));
