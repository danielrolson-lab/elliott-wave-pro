/**
 * stores/gex.ts
 *
 * Zustand store for dealer GEX levels keyed by ticker.
 * Written by useGEXLevels hook; read by GEXOverlayLayer.
 */

import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import type { GEXLevels } from '../utils/gexCalculator';

interface GEXState {
  /** GEX levels per ticker. null = fetch attempted but data unavailable. */
  levels: Record<string, GEXLevels | null>;

  setLevels(ticker: string, levels: GEXLevels | null): void;
  clearLevels(ticker: string): void;
}

export const useGEXStore = create<GEXState>()(
  immer((set) => ({
    levels: {},

    setLevels(ticker, levels) {
      set((s) => {
        s.levels[ticker] = levels;
      });
    },

    clearLevels(ticker) {
      set((s) => {
        delete s.levels[ticker];
      });
    },
  })),
);
