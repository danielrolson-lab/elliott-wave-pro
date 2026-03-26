import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import type { WaveCount, WavePosterior } from '@elliott-wave-pro/wave-engine';

export type ScanStatus = 'idle' | 'scanning' | 'complete' | 'error';

export interface WaveCountState {
  // Top 4 valid wave counts per `${ticker}_${timeframe}` key
  counts: Record<string, WaveCount[]>;

  // The user-pinned (selected) count id per key
  pinnedCountId: Record<string, string>;

  // Deep scan status per ticker
  deepScanStatus: Record<string, ScanStatus>;

  // Posteriors keyed by countId
  posteriors: Record<string, WavePosterior>;

  // Actions
  setCounts: (key: string, counts: WaveCount[]) => void;
  updatePosterior: (countId: string, posterior: WavePosterior) => void;
  pinCount: (key: string, countId: string) => void;
  setDeepScanStatus: (ticker: string, status: ScanStatus) => void;
  invalidateCount: (countId: string, reason: string) => void;
  clearTicker: (ticker: string) => void;
}

export const useWaveCountStore = create<WaveCountState>()(
  immer((set) => ({
    counts: {},
    pinnedCountId: {},
    deepScanStatus: {},
    posteriors: {},

    setCounts: (key, counts) =>
      set((state) => {
        state.counts[key] = counts;
        // Seed posteriors for any new counts
        for (const count of counts) {
          if (!state.posteriors[count.id]) {
            state.posteriors[count.id] = count.posterior;
          }
        }
      }),

    updatePosterior: (countId, posterior) =>
      set((state) => {
        state.posteriors[countId] = posterior;
        // Mirror into counts array
        for (const key of Object.keys(state.counts)) {
          const countIdx = state.counts[key].findIndex((c) => c.id === countId);
          if (countIdx !== -1) {
            state.counts[key][countIdx].posterior = posterior;
            state.counts[key][countIdx].updatedAt = Date.now();
          }
        }
      }),

    pinCount: (key, countId) =>
      set((state) => {
        state.pinnedCountId[key] = countId;
      }),

    setDeepScanStatus: (ticker, status) =>
      set((state) => {
        state.deepScanStatus[ticker] = status;
      }),

    invalidateCount: (countId, _reason) =>
      set((state) => {
        for (const key of Object.keys(state.counts)) {
          const countIdx = state.counts[key].findIndex((c) => c.id === countId);
          if (countIdx !== -1) {
            state.counts[key][countIdx].isValid = false;
          }
        }
      }),

    clearTicker: (ticker) =>
      set((state) => {
        const keys = Object.keys(state.counts).filter((k) => k.startsWith(`${ticker}_`));
        for (const key of keys) {
          const countsForKey = state.counts[key];
          for (const count of countsForKey) {
            delete state.posteriors[count.id];
          }
          delete state.counts[key];
          delete state.pinnedCountId[key];
        }
        delete state.deepScanStatus[ticker];
      }),
  })),
);
