/**
 * stores/internals.ts
 *
 * Market internals data store.
 * Breadth indicators: NYSE TICK, TRIN, A/D Line, New Highs/Lows,
 * Up/Down volume ratio, McClellan Oscillator, % above 20/50/200 MA.
 */

import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';

export interface TickSample {
  timestamp: number;
  value:     number;
}

export interface InternalsSnapshot {
  timestamp:         number;
  nyse_tick:         number;          // current NYSE TICK reading
  trin:              number;          // ARMS index
  advance_count:     number;
  decline_count:     number;
  ad_line:           number;          // cumulative A/D
  new_highs_52w:     number;
  new_lows_52w:      number;
  up_volume:         number;
  down_volume:       number;
  up_down_vol_ratio: number;
  mclellan_oscillator:  number;
  mclellan_summation:   number;
  pct_above_20ma:    number;
  pct_above_50ma:    number;
  pct_above_200ma:   number;
  divergence_flag:   boolean;         // price new high + breadth declining
}

export type InternalsStatus = 'idle' | 'loading' | 'live' | 'error';

interface InternalsState {
  snapshot:     InternalsSnapshot | null;
  tick_history: TickSample[];           // last 390 TICK samples (1 per minute)
  ad_history:   number[];               // cumulative A/D line values
  status:       InternalsStatus;
  lastFetch:    number;
  error:        string | null;

  setSnapshot:     (snap: InternalsSnapshot) => void;
  appendTick:      (sample: TickSample) => void;
  appendAD:        (value: number) => void;
  setStatus:       (s: InternalsStatus) => void;
  setError:        (e: string | null) => void;
  setLastFetch:    (ts: number) => void;
}

export const useInternalsStore = create<InternalsState>()(
  immer((set) => ({
    snapshot:    null,
    tick_history: [],
    ad_history:   [],
    status:      'idle',
    lastFetch:   0,
    error:       null,

    setSnapshot:  (snap)  => set((s) => { s.snapshot = snap; }),
    appendTick:   (sample) => set((s) => {
      s.tick_history.push(sample);
      if (s.tick_history.length > 390) s.tick_history.shift();
    }),
    appendAD:     (value) => set((s) => {
      s.ad_history.push(value);
      if (s.ad_history.length > 252) s.ad_history.shift();
    }),
    setStatus:    (status) => set((s) => { s.status = status; }),
    setError:     (error)  => set((s) => { s.error = error; }),
    setLastFetch: (ts)     => set((s) => { s.lastFetch = ts; }),
  })),
);
