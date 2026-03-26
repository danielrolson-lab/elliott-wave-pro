/**
 * stores/indicators.ts
 *
 * Holds pre-computed indicator series keyed by `${ticker}_${timeframe}`.
 * Computation happens in hooks/useIndicators.ts — components only read.
 */

import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';

export interface DivergencePoint {
  barIdx: number;
  type:   'bearish' | 'bullish';
}

export interface CrossoverPoint {
  barIdx: number;
  type:   'bullish' | 'bearish';
}

export interface RSISeries {
  values:      readonly number[];
  divergences: readonly DivergencePoint[];
}

export interface MACDSeries {
  macdLine:   readonly number[];
  signalLine: readonly number[];
  histogram:  readonly number[];
  crossovers: readonly CrossoverPoint[];
}

export interface VolumeSeries {
  volumes: readonly number[];
  ma20:    readonly number[];
}

export interface CVDDivergencePoint {
  barIdx: number;
  type:   'bearish' | 'bullish';
}

export interface CVDSeries {
  /** Cumulative delta values, one per bar */
  cumulative:  readonly number[];
  /** Per-bar signed deltas */
  deltas:      readonly number[];
  divergences: readonly CVDDivergencePoint[];
}

export interface IndicatorState {
  rsi:    Record<string, RSISeries>;
  macd:   Record<string, MACDSeries>;
  volume: Record<string, VolumeSeries>;
  cvd:    Record<string, CVDSeries>;

  setRSI:    (key: string, data: RSISeries)    => void;
  setMACD:   (key: string, data: MACDSeries)   => void;
  setVolume: (key: string, data: VolumeSeries) => void;
  setCVD:    (key: string, data: CVDSeries)    => void;
  clear:     (key: string) => void;
}

export const useIndicatorStore = create<IndicatorState>()(
  immer((set) => ({
    rsi:    {},
    macd:   {},
    volume: {},
    cvd:    {},

    setRSI:    (key, data) => set((s) => { s.rsi[key]    = data as never; }),
    setMACD:   (key, data) => set((s) => { s.macd[key]   = data as never; }),
    setVolume: (key, data) => set((s) => { s.volume[key] = data as never; }),
    setCVD:    (key, data) => set((s) => { s.cvd[key]    = data as never; }),

    clear: (key) =>
      set((s) => {
        delete s.rsi[key];
        delete s.macd[key];
        delete s.volume[key];
        delete s.cvd[key];
      }),
  })),
);
