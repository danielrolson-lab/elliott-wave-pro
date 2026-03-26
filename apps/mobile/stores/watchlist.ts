import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import type { Instrument, MarketRegime } from '@elliott-wave-pro/wave-engine';

export type WatchlistTab = 'all' | 'equities' | 'futures' | 'options' | 'crypto';

export type SortKey = 'change_pct' | 'wave_signal' | 'iv_rank' | 'volume_spike';

export interface WatchlistItem {
  id: string;
  instrument: Instrument;
  addedAt: number;
  // Snapshot data (refreshed from marketData store)
  lastPrice: number | null;
  changePercent: number | null;
  regime: MarketRegime | null;
  ivRank: number | null;
  volumeRatio: number | null;
  waveLabel: string | null;
  waveSignalStrength: number | null;
}

export interface WatchlistState {
  items: WatchlistItem[];
  activeTab: WatchlistTab;
  sortKey: SortKey;
  selectedIds: Set<string>;

  // Actions
  addItem: (instrument: Instrument) => void;
  removeItem: (id: string) => void;
  reorderItems: (fromIndex: number, toIndex: number) => void;
  updateItemSnapshot: (id: string, snapshot: Partial<WatchlistItem>) => void;
  setActiveTab: (tab: WatchlistTab) => void;
  setSortKey: (key: SortKey) => void;
  toggleSelect: (id: string) => void;
  clearSelection: () => void;
}

export const useWatchlistStore = create<WatchlistState>()(
  immer((set) => ({
    items: [],
    activeTab: 'all',
    sortKey: 'change_pct',
    selectedIds: new Set(),

    addItem: (instrument) =>
      set((state) => {
        const exists = state.items.some((i) => i.instrument.ticker === instrument.ticker);
        if (!exists) {
          state.items.push({
            id: instrument.ticker,
            instrument,
            addedAt: Date.now(),
            lastPrice: null,
            changePercent: null,
            regime: null,
            ivRank: null,
            volumeRatio: null,
            waveLabel: null,
            waveSignalStrength: null,
          });
        }
      }),

    removeItem: (id) =>
      set((state) => {
        state.items = state.items.filter((i) => i.id !== id);
        state.selectedIds.delete(id);
      }),

    reorderItems: (fromIndex, toIndex) =>
      set((state) => {
        const [moved] = state.items.splice(fromIndex, 1);
        state.items.splice(toIndex, 0, moved);
      }),

    updateItemSnapshot: (id, snapshot) =>
      set((state) => {
        const item = state.items.find((i) => i.id === id);
        if (item) {
          Object.assign(item, snapshot);
        }
      }),

    setActiveTab: (tab) =>
      set((state) => {
        state.activeTab = tab;
      }),

    setSortKey: (key) =>
      set((state) => {
        state.sortKey = key;
      }),

    toggleSelect: (id) =>
      set((state) => {
        if (state.selectedIds.has(id)) {
          state.selectedIds.delete(id);
        } else {
          state.selectedIds.add(id);
        }
      }),

    clearSelection: () =>
      set((state) => {
        state.selectedIds.clear();
      }),
  })),
);
