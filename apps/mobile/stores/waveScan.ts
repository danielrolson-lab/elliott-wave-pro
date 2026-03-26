/**
 * stores/waveScan.ts
 *
 * Zustand store for historical wave scanner results.
 * Holds scan results per `${ticker}_${timeframe}_${waveType}` key.
 */

import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';

export interface OHLCVBar {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

export interface ForwardReturns {
  '1d':  number | null;
  '3d':  number | null;
  '5d':  number | null;
  '10d': number | null;
  '20d': number | null;
}

export interface WaveScanInstance {
  entry_date:  string;
  entry_price: number;
  wave_label:  string;
  wave_structure: string;
  degree:      string;
  posterior:   number;
  forward_returns: ForwardReturns;
  min_drawdown_before_target: number;
  mini_candles: OHLCVBar[];
}

export interface WaveScanStats {
  sample_count:               number;
  win_rate_5d:                number;
  median_return_5d:           number;
  avg_return_5d:              number;
  max_drawdown_before_target: number;
  best_return:                number;
  worst_return:               number;
}

export interface WaveScanResult {
  ticker:    string;
  timeframe: string;
  wave_type: string;
  instances: WaveScanInstance[];
  stats:     WaveScanStats;
  fetchedAt: number;
}

export type ScanStatus = 'idle' | 'loading' | 'success' | 'error';

interface WaveScanState {
  results: Record<string, WaveScanResult>;
  status:  Record<string, ScanStatus>;
  error:   Record<string, string>;
  selectedInstanceIdx: number | null;

  setResult:           (key: string, result: WaveScanResult) => void;
  setStatus:           (key: string, status: ScanStatus) => void;
  setError:            (key: string, error: string) => void;
  selectInstance:      (idx: number | null) => void;
}

export const useWaveScanStore = create<WaveScanState>()(
  immer((set) => ({
    results:              {},
    status:               {},
    error:                {},
    selectedInstanceIdx:  null,

    setResult: (key, result) =>
      set((s) => { s.results[key] = result; }),

    setStatus: (key, status) =>
      set((s) => { s.status[key] = status; }),

    setError: (key, error) =>
      set((s) => { s.error[key] = error; }),

    selectInstance: (idx) =>
      set((s) => { s.selectedInstanceIdx = idx; }),
  })),
);
