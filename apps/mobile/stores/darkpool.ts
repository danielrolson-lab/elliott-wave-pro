/**
 * stores/darkpool.ts
 *
 * FINRA OTC / dark pool trade print store.
 * Ring buffer of 200 prints with wave-count context.
 */

import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';

export interface DarkPoolPrint {
  id:           string;
  timestamp:    number;
  ticker:       string;
  price:        number;
  size:         number;         // shares
  notional:     number;         // price × size
  venue:        string;         // e.g. "FINRA ATS", "NYSE TRF", "CBOE TRF"
  pct_of_adv:   number;         // % of avg daily volume
  large_flag:   boolean;        // > 40% of daily vol
  wave_label:   string | null;  // current wave count at time of print
  wave_posterior: number | null;
  wave_context: string | null;  // e.g. "Wave 2 retrace — potential accumulation"
}

export type DarkPoolStatus = 'idle' | 'loading' | 'live' | 'error';

interface DarkPoolState {
  prints:     DarkPoolPrint[];
  status:     DarkPoolStatus;
  lastFetch:  number;
  error:      string | null;
  filter: {
    minNotional: number;
    largeOnly:   boolean;
    ticker:      string | null;
  };

  addPrint:      (print: DarkPoolPrint) => void;
  setStatus:     (s: DarkPoolStatus) => void;
  setError:      (e: string | null) => void;
  setLastFetch:  (ts: number) => void;
  setFilter:     (patch: Partial<DarkPoolState['filter']>) => void;
}

const MAX_PRINTS = 200;

export const useDarkPoolStore = create<DarkPoolState>()(
  immer((set) => ({
    prints:    [],
    status:    'idle',
    lastFetch: 0,
    error:     null,
    filter: {
      minNotional: 500_000,
      largeOnly:   false,
      ticker:      null,
    },

    addPrint: (print) =>
      set((s) => {
        // dedup by id
        if (s.prints.some((p) => p.id === print.id)) return;
        s.prints.unshift(print);
        if (s.prints.length > MAX_PRINTS) s.prints.pop();
      }),

    setStatus:    (status)  => set((s) => { s.status = status; }),
    setError:     (error)   => set((s) => { s.error = error; }),
    setLastFetch: (ts)      => set((s) => { s.lastFetch = ts; }),
    setFilter:    (patch)   => set((s) => { Object.assign(s.filter, patch); }),
  })),
);

export function applyDarkPoolFilter(
  prints: DarkPoolPrint[],
  filter: DarkPoolState['filter'],
): DarkPoolPrint[] {
  return prints.filter((p) => {
    if (p.notional < filter.minNotional) return false;
    if (filter.largeOnly && !p.large_flag) return false;
    if (filter.ticker && p.ticker !== filter.ticker) return false;
    return true;
  });
}
