/**
 * stores/correlation.ts
 *
 * Holds the current and prior correlation matrices for the watchlist.
 */

import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import type { CorrelationMatrix } from '../utils/correlationEngine';

export type CorrelationStatus = 'idle' | 'loading' | 'success' | 'error';

interface CorrelationState {
  current:  CorrelationMatrix | null;
  prior:    CorrelationMatrix | null;   // 40-day window (for breakdown detection)
  status:   CorrelationStatus;
  error:    string | null;
  lastComputed: number;

  setCurrent:     (m: CorrelationMatrix) => void;
  setPrior:       (m: CorrelationMatrix) => void;
  setStatus:      (s: CorrelationStatus) => void;
  setError:       (e: string | null) => void;
  setLastComputed:(ts: number) => void;
}

export const useCorrelationStore = create<CorrelationState>()(
  immer((set) => ({
    current:      null,
    prior:        null,
    status:       'idle',
    error:        null,
    lastComputed: 0,

    setCurrent:      (m)  => set((s) => { s.current = m; }),
    setPrior:        (m)  => set((s) => { s.prior   = m; }),
    setStatus:       (st) => set((s) => { s.status  = st; }),
    setError:        (e)  => set((s) => { s.error   = e; }),
    setLastComputed: (ts) => set((s) => { s.lastComputed = ts; }),
  })),
);
