/**
 * Global current-track store.
 *
 * Holds the song that the layout-level PlayerBar is currently displaying
 * and playing. Updated when any component dispatches `pazzera:play`.
 * Persisted to localStorage so reloading the page keeps the same song
 * playing in the bottom bar.
 */
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

export interface CurrentTrack {
  id: string;
  slug: string;
  title: string;
  artistName: string;
  artistUsername: string;
  coverUrl: string;
  audioUrl: string;
  durationSeconds: number;
  publishedPriceUsdc: string;
}

interface CurrentTrackStore {
  track: CurrentTrack | null;
  isPlaying: boolean;
  setTrack: (t: CurrentTrack) => void;
  setIsPlaying: (p: boolean) => void;
  clear: () => void;
}

export const useCurrentTrack = create<CurrentTrackStore>()(
  persist(
    (set) => ({
      track: null,
      isPlaying: false,
      setTrack: (t) => set({ track: t }),
      setIsPlaying: (p) => set({ isPlaying: p }),
      clear: () => set({ track: null, isPlaying: false }),
    }),
    {
      name: 'pazzera:current-track:v1',
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ track: s.track }),
    },
  ),
);
