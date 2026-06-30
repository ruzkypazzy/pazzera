/**
 * Phase 8 — Client-side player queue store.
 *
 * Features:
 *   - queue + previous / next
 *   - repeat: off / one / all
 *   - shuffle (Fisher-Yates, persisted for the session)
 *   - auto-advance when the current song ends
 *   - persisted to localStorage for reload survival
 */
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

export type RepeatMode = 'off' | 'one' | 'all';

export interface QueuedSong {
  id: string;
  slug: string;
  title: string;
  artistName: string;
  artistUsername: string;
  coverUrl: string;
  audioUrl: string;
  durationSeconds: number;
  publishedPriceUsdc: string;
  /** Optional waveform peaks JSON (from Phase 6). */
  waveformPeaks?: { min: number[]; max: number[] } | null;
}

interface QueueStore {
  queue: QueuedSong[];
  currentIndex: number;
  repeat: RepeatMode;
  shuffle: boolean;
  shuffledIndices: number[];
  // Actions
  enqueue: (songs: QueuedSong[]) => void;
  enqueueNext: (song: QueuedSong) => void;
  removeAt: (idx: number) => void;
  clear: () => void;
  setCurrentById: (id: string) => void;
  next: () => QueuedSong | null;
  prev: () => QueuedSong | null;
  jumpTo: (idx: number) => void;
  toggleShuffle: () => void;
  cycleRepeat: () => void;
}

const fisherYates = (n: number): number[] => {
  const out = Array.from({ length: n }, (_, i) => i);
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
};

export const usePlayerQueue = create<QueueStore>()(
  persist(
    (set, get) => ({
      queue: [],
      currentIndex: -1,
      repeat: 'off',
      shuffle: false,
      shuffledIndices: [],
      enqueue: (songs) => {
        if (songs.length === 0) return;
        const state = get();
        set({
          queue: [...state.queue, ...songs],
          currentIndex: state.queue.length === 0 ? 0 : state.currentIndex,
          shuffledIndices: state.shuffle ? fisherYates(state.queue.length + songs.length) : state.shuffledIndices,
        });
      },
      enqueueNext: (song) => {
        const state = get();
        const newQueue = [...state.queue];
        const insertAt = state.currentIndex >= 0 ? state.currentIndex + 1 : newQueue.length;
        newQueue.splice(insertAt, 0, song);
        set({
          queue: newQueue,
          currentIndex: state.currentIndex === -1 ? 0 : state.currentIndex,
        });
      },
      removeAt: (idx) => {
        const state = get();
        if (idx < 0 || idx >= state.queue.length) return;
        const newQueue = state.queue.filter((_, i) => i !== idx);
        let newCurrent = state.currentIndex;
        if (idx < state.currentIndex) newCurrent -= 1;
        if (newQueue.length === 0) newCurrent = -1;
        set({ queue: newQueue, currentIndex: newCurrent });
      },
      clear: () => set({ queue: [], currentIndex: -1, shuffledIndices: [] }),
      setCurrentById: (id) => {
        const state = get();
        const idx = state.queue.findIndex((s) => s.id === id);
        if (idx >= 0) set({ currentIndex: idx });
      },
      next: () => {
        const state = get();
        if (state.queue.length === 0) return null;
        const order = state.shuffle ? state.shuffledIndices : state.queue.map((_, i) => i);
        const pos = order.indexOf(state.currentIndex);
        if (state.repeat === 'one') {
          return state.queue[state.currentIndex] ?? null;
        }
        const nextPos = pos + 1;
        if (nextPos >= order.length) {
          if (state.repeat === 'all') {
            const target = order[0]!;
            set({ currentIndex: target });
            return state.queue[target] ?? null;
          }
          return null; // repeat off + end of queue
        }
        const target = order[nextPos]!;
        set({ currentIndex: target });
        return state.queue[target] ?? null;
      },
      prev: () => {
        const state = get();
        if (state.queue.length === 0) return null;
        const order = state.shuffle ? state.shuffledIndices : state.queue.map((_, i) => i);
        const pos = order.indexOf(state.currentIndex);
        const prevPos = pos - 1;
        if (prevPos < 0) {
          if (state.repeat === 'all') {
            const target = order[order.length - 1]!;
            set({ currentIndex: target });
            return state.queue[target] ?? null;
          }
          return state.queue[state.currentIndex] ?? null;
        }
        const target = order[prevPos]!;
        set({ currentIndex: target });
        return state.queue[target] ?? null;
      },
      jumpTo: (idx) => {
        const state = get();
        if (idx >= 0 && idx < state.queue.length) set({ currentIndex: idx });
      },
      toggleShuffle: () => {
        const state = get();
        const nextShuffle = !state.shuffle;
        set({
          shuffle: nextShuffle,
          shuffledIndices: nextShuffle ? fisherYates(state.queue.length) : [],
        });
      },
      cycleRepeat: () => {
        const state = get();
        const order: RepeatMode[] = ['off', 'all', 'one'];
        const next = order[(order.indexOf(state.repeat) + 1) % order.length]!;
        set({ repeat: next });
      },
    }),
    {
      name: 'pazzera:player-queue:v1',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        queue: state.queue,
        currentIndex: state.currentIndex,
        repeat: state.repeat,
        shuffle: state.shuffle,
        shuffledIndices: state.shuffledIndices,
      }),
    },
  ),
);
