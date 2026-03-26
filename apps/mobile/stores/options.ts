/**
 * stores/options.ts
 *
 * Zustand store for options chain data keyed by `${ticker}_${expiry}`.
 *
 * Written by useOptionsChain; read by OptionsChain + IVSurface components.
 */

import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import type { Moneyness } from '../utils/optionsGreeks';

// ── Types ─────────────────────────────────────────────────────────────────────

/** A fully-decorated option row ready for display. */
export interface OptionRow {
  // Identity
  strike:       number;
  expiry:       string;   // YYYY-MM-DD
  dte:          number;
  contractType: 'call' | 'put';
  // Bid/Ask
  bid:          number;
  ask:          number;
  mid:          number;
  // Volume + OI
  volume:       number;
  openInterest: number;
  // First-order Greeks (from Polygon)
  delta:        number;
  gamma:        number;
  theta:        number;
  vega:         number;
  // Second-order Greeks (computed client-side)
  vanna:        number;
  charm:        number;
  // IV
  impliedVol:   number;
  // Derived
  moneyness:    Moneyness;
}

/** One point on the IV term structure. */
export interface ExpiryIVPoint {
  expiry: string;   // YYYY-MM-DD
  dte:    number;
  atmIV:  number;   // ATM implied vol (0–1 scale)
}

/** Per-expiry skew stats (25-delta RR + butterfly). */
export interface SkewPoint {
  delta:          number;   // absolute delta (for X axis)
  impliedVol:     number;
}

export interface ExpirySkew {
  expiry:         string;
  riskReversal25d: number;
  butterfly25d:    number;
  points:         SkewPoint[];   // sorted by delta ascending (0.10 → 0.90)
}

export type ChainSide = 'calls' | 'puts' | 'both';

export interface FilterConfig {
  side:      ChainSide;
  minDelta:  number;   // 0.05
  maxDelta:  number;   // 0.95
  minVolume: number;
  minOI:     number;
}

const DEFAULT_FILTER: FilterConfig = {
  side:      'both',
  minDelta:  0.05,
  maxDelta:  0.95,
  minVolume: 0,
  minOI:     0,
};

// ── State ─────────────────────────────────────────────────────────────────────

interface OptionsState {
  /** Chain rows keyed by `${ticker}_${expiry}` */
  rows:             Record<string, OptionRow[]>;
  /** Available expiries per ticker (sorted ascending) */
  expiries:         Record<string, string[]>;
  /** Currently selected expiry per ticker */
  selectedExpiry:   Record<string, string>;
  /** IV term structure per ticker */
  termStructure:    Record<string, ExpiryIVPoint[]>;
  /** Per-expiry skew per ticker */
  skew:             Record<string, ExpirySkew | null>;
  /** Max Pain strike per ticker */
  maxPain:          Record<string, number>;
  /** Max Gamma strike per ticker (dealer hot spot) */
  maxGammaStrike:   Record<string, number>;
  /** IV Rank per ticker (0–100) */
  ivRank:           Record<string, number>;
  /** Rolling IV history for IV Rank (up to 252 samples per ticker) */
  ivHistory:        Record<string, number[]>;
  /** Filter config per ticker */
  filters:          Record<string, FilterConfig>;

  // ── Actions ──
  setRows(key: string, rows: OptionRow[]): void;
  setExpiries(ticker: string, expiries: string[]): void;
  setSelectedExpiry(ticker: string, expiry: string): void;
  setTermStructure(ticker: string, points: ExpiryIVPoint[]): void;
  setSkew(ticker: string, skew: ExpirySkew | null): void;
  setMaxPain(ticker: string, strike: number): void;
  setMaxGammaStrike(ticker: string, strike: number): void;
  setIVRank(ticker: string, rank: number): void;
  appendIVHistory(ticker: string, iv: number): void;
  setFilter<K extends keyof FilterConfig>(ticker: string, key: K, value: FilterConfig[K]): void;
}

// ── Store ─────────────────────────────────────────────────────────────────────

export const useOptionsStore = create<OptionsState>()(
  immer((set) => ({
    rows:           {},
    expiries:       {},
    selectedExpiry: {},
    termStructure:  {},
    skew:           {},
    maxPain:        {},
    maxGammaStrike: {},
    ivRank:         {},
    ivHistory:      {},
    filters:        {},

    setRows(key, rows) {
      set((s) => { s.rows[key] = rows; });
    },

    setExpiries(ticker, expiries) {
      set((s) => { s.expiries[ticker] = expiries; });
    },

    setSelectedExpiry(ticker, expiry) {
      set((s) => { s.selectedExpiry[ticker] = expiry; });
    },

    setTermStructure(ticker, points) {
      set((s) => { s.termStructure[ticker] = points; });
    },

    setSkew(ticker, skew) {
      set((s) => { s.skew[ticker] = skew; });
    },

    setMaxPain(ticker, strike) {
      set((s) => { s.maxPain[ticker] = strike; });
    },

    setMaxGammaStrike(ticker, strike) {
      set((s) => { s.maxGammaStrike[ticker] = strike; });
    },

    setIVRank(ticker, rank) {
      set((s) => { s.ivRank[ticker] = rank; });
    },

    appendIVHistory(ticker, iv) {
      set((s) => {
        const hist = s.ivHistory[ticker] ?? [];
        hist.push(iv);
        // Keep last 252 samples (≈ 1 year of daily closes)
        s.ivHistory[ticker] = hist.length > 252 ? hist.slice(-252) : hist;
      });
    },

    setFilter(ticker, key, value) {
      set((s) => {
        if (!s.filters[ticker]) {
          s.filters[ticker] = { ...DEFAULT_FILTER };
        }
        (s.filters[ticker] as Record<string, unknown>)[key] = value;
      });
    },
  })),
);

// ── Selector helpers ──────────────────────────────────────────────────────────

/** Returns the filter for a ticker, falling back to defaults. */
export function selectFilter(
  state: OptionsState,
  ticker: string,
): FilterConfig {
  return state.filters[ticker] ?? DEFAULT_FILTER;
}

/** Applies filter + side toggle to a row array. */
export function applyFilter(rows: readonly OptionRow[], filter: FilterConfig): OptionRow[] {
  return rows.filter((r) => {
    if (filter.side === 'calls' && r.contractType !== 'call') return false;
    if (filter.side === 'puts'  && r.contractType !== 'put')  return false;
    const absDelta = Math.abs(r.delta);
    if (absDelta < filter.minDelta || absDelta > filter.maxDelta) return false;
    if (r.volume < filter.minVolume) return false;
    if (r.openInterest < filter.minOI) return false;
    return true;
  });
}
