/**
 * stores/earnings.ts
 *
 * Earnings data and analysis per ticker.
 */

import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import type { EarningsAnalysis, EarningsEvent } from '../utils/earningsEngine';

export type EarningsStatus = 'idle' | 'loading' | 'success' | 'error';

interface EarningsState {
  analyses: Record<string, EarningsAnalysis>;
  upcoming: EarningsEvent[];
  status:   Record<string, EarningsStatus>;
  error:    Record<string, string>;

  setAnalysis: (ticker: string, analysis: EarningsAnalysis) => void;
  setUpcoming: (events: EarningsEvent[]) => void;
  setStatus:   (ticker: string, status: EarningsStatus) => void;
  setError:    (ticker: string, error: string) => void;
}

export const useEarningsStore = create<EarningsState>()(
  immer((set) => ({
    analyses: {},
    upcoming: [],
    status:   {},
    error:    {},

    setAnalysis: (ticker, analysis) =>
      set((s) => { s.analyses[ticker] = analysis; }),

    setUpcoming: (events) =>
      set((s) => { s.upcoming = events; }),

    setStatus: (ticker, status) =>
      set((s) => { s.status[ticker] = status; }),

    setError: (ticker, error) =>
      set((s) => { s.error[ticker] = error; }),
  })),
);
