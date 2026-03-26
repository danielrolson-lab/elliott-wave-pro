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

export interface IndicatorState {
  rsi:    Record<string, RSISeries>;
  macd:   Record<string, MACDSeries>;
  volume: Record<string, VolumeSeries>;

  setRSI:    (key: string, data: RSISeries)    => void;
  setMACD:   (key: string, data: MACDSeries)   => void;
  setVolume: (key: string, data: VolumeSeries) => void;
  clear:     (key: string) => void;
}

export const useIndicatorStore = create<IndicatorState>()(
  immer((set) => ({
    rsi:    {},
    macd:   {},
    volume: {},

    setRSI:    (key, data) => set((s) => { s.rsi[key]    = data as never; }),
    setMACD:   (key, data) => set((s) => { s.macd[key]   = data as never; }),
    setVolume: (key, data) => set((s) => { s.volume[key] = data as never; }),

    clear: (key) =>
      set((s) => {
        delete s.rsi[key];
        delete s.macd[key];
        delete s.volume[key];
      }),
  })),
);
