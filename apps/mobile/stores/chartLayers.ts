/**
 * chartLayers.ts
 * Persists chart overlay / indicator visibility preferences via MMKV.
 */
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';
import { MMKV } from 'react-native-mmkv';

const storage = new MMKV({ id: 'chart-layers' });
const mmkvStorage = {
  getItem: (key: string) => storage.getString(key) ?? null,
  setItem: (key: string, value: string) => storage.set(key, value),
  removeItem: (key: string) => storage.delete(key),
};

export type EWMode = 'now' | 'multi-degree' | 'history';

export interface ChartLayersState {
  // EW display mode — mutually exclusive
  ewMode: EWMode;

  // Row 1 — Price overlays
  ma20:        boolean;  // ema21
  ma50:        boolean;  // ema50
  ma200:       boolean;  // ema200
  vwap:        boolean;
  bb:          boolean;  // bollinger bands
  ewWaves:        boolean;  // elliott wave labels + channel + projections
  waveProjection: boolean;  // projected wave zig-zag simulation
  fibLevels:      boolean;  // fib retracements + extensions
  ewChannel:      boolean;  // wave channel overlay
  invalidation:   boolean;  // invalidation line on wave overlay

  // Row 2 — Indicators
  showRSI:    boolean;
  showMACD:   boolean;
  showVolume: boolean;
  showCVD:    boolean;
  showGEX:    boolean;  // gex overlay on price chart

  // Row 3 — Data overlays
  darkPool:     boolean;
  optionsFlow:  boolean;
  sentiment:    boolean;
  waveLabels:   boolean;  // wave number labels on pivots
  altCount:     boolean;  // alternate count overlay

  // Actions
  setEWMode: (mode: EWMode) => void;
  toggle: (key: keyof Omit<ChartLayersState, 'toggle' | 'reset' | 'setEWMode'>) => void;
  reset:  () => void;
}

const DEFAULTS = {
  ewMode: 'now' as EWMode,
  ma20: true, ma50: true, ma200: false, vwap: false, bb: false,
  ewWaves: true, waveProjection: true, fibLevels: true, ewChannel: false, invalidation: true,
  showRSI: true, showMACD: false, showVolume: true, showCVD: false, showGEX: false,
  darkPool: false, optionsFlow: false, sentiment: false, waveLabels: true, altCount: false,
};

export const useChartLayersStore = create<ChartLayersState>()(
  persist(
    immer((set) => ({
      ...DEFAULTS,
      setEWMode: (mode) => set((s) => { s.ewMode = mode; }),
      toggle: (key) => set((s) => { (s as unknown as Record<string, boolean>)[key] = !(s as unknown as Record<string, boolean>)[key]; }),
      reset:  () => set(() => ({ ...DEFAULTS })),
    })),
    {
      name: 'chart-layers',
      storage: createJSONStorage(() => mmkvStorage),
      partialize: (s) => {
        const { toggle, reset, ...rest } = s;
        return rest;
      },
    },
  ),
);
