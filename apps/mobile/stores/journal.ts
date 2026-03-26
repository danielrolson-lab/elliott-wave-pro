/**
 * stores/journal.ts
 *
 * Trade journal store — persists entries in MMKV.
 * Each entry is auto-populated from chart state at log time, then
 * enriched with user inputs on exit.
 */

import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { persist, createJSONStorage } from 'zustand/middleware';
import { MMKV } from 'react-native-mmkv';

const mmkv = new MMKV({ id: 'trade-journal' });

const mmkvStorage = {
  getItem:    (key: string) => mmkv.getString(key) ?? null,
  setItem:    (key: string, value: string) => mmkv.set(key, value),
  removeItem: (key: string) => mmkv.delete(key),
};

export type Direction        = 'long' | 'short';
export type InstrumentType   = 'stock' | 'option_call' | 'option_put' | 'futures' | 'etf' | 'crypto';
export type EmotionalState   = 1 | 2 | 3 | 4 | 5;
export type TradeOutcome     = 'win' | 'loss' | 'breakeven' | 'open';

export interface JournalEntry {
  id:              string;
  // Auto-populated from chart state
  ticker:          string;
  direction:       Direction;
  instrument_type: InstrumentType;
  entry_price:     number;
  stop_price:      number;
  target_price:    number;
  active_wave:     string;      // e.g. "Wave 3 (impulse)"
  market_regime:   string;      // e.g. "STRONG_TREND_UP"
  gex_level:       string;      // e.g. "Above Call Wall"
  iv_rank:         number;      // 0–100
  entry_date:      string;      // ISO
  // User inputs
  exit_price:      number | null;
  exit_date:       string | null;
  notes:           string;
  emotional_state: EmotionalState;  // 1=fear, 5=confident
  outcome:         TradeOutcome;
  // Computed
  pnl_r:           number | null;   // P&L in R multiples
  pnl_pct:         number | null;
}

// ── Analytics computed from all entries ──────────────────────────────────────

export interface JournalAnalytics {
  total_trades:           number;
  win_rate:               number;
  avg_r:                  number;
  max_drawdown:           number;
  win_rate_by_wave:       Record<string, number>;
  win_rate_by_regime:     Record<string, number>;
  avg_r_by_instrument:    Record<string, number>;
  win_rate_by_hour:       Record<number, number>;   // 0-23
  win_rate_by_weekday:    Record<number, number>;   // 0=Sun
  cut_winners_early_flag: boolean;
  hold_losers_long_flag:  boolean;
  monthly_pnl:            Array<{ month: string; pnl: number }>;
  equity_curve:           number[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function computeR(entry: JournalEntry): number | null {
  if (entry.exit_price === null) return null;
  const risk   = Math.abs(entry.entry_price - entry.stop_price);
  if (risk === 0) return null;
  const profit = entry.direction === 'long'
    ? entry.exit_price - entry.entry_price
    : entry.entry_price - entry.exit_price;
  return Math.round((profit / risk) * 100) / 100;
}

function computePctReturn(entry: JournalEntry): number | null {
  if (entry.exit_price === null) return null;
  const base = entry.direction === 'long'
    ? (entry.exit_price - entry.entry_price) / entry.entry_price
    : (entry.entry_price - entry.exit_price) / entry.entry_price;
  return Math.round(base * 10000) / 100; // as %
}

export function computeAnalytics(entries: JournalEntry[]): JournalAnalytics {
  const closed = entries.filter((e) => e.outcome !== 'open' && e.exit_price !== null);
  const wins   = closed.filter((e) => (e.pnl_r ?? 0) > 0);

  const win_rate = closed.length ? wins.length / closed.length * 100 : 0;
  const avg_r    = closed.length
    ? closed.reduce((s, e) => s + (e.pnl_r ?? 0), 0) / closed.length
    : 0;

  // Win rate by wave
  const waveMap: Record<string, { wins: number; total: number }> = {};
  for (const e of closed) {
    const w = e.active_wave || 'Unknown';
    if (!waveMap[w]) waveMap[w] = { wins: 0, total: 0 };
    waveMap[w].total++;
    if ((e.pnl_r ?? 0) > 0) waveMap[w].wins++;
  }
  const win_rate_by_wave: Record<string, number> = {};
  for (const [w, v] of Object.entries(waveMap)) {
    win_rate_by_wave[w] = v.total ? Math.round(v.wins / v.total * 100) : 0;
  }

  // Win rate by regime
  const regimeMap: Record<string, { wins: number; total: number }> = {};
  for (const e of closed) {
    const r = e.market_regime || 'Unknown';
    if (!regimeMap[r]) regimeMap[r] = { wins: 0, total: 0 };
    regimeMap[r].total++;
    if ((e.pnl_r ?? 0) > 0) regimeMap[r].wins++;
  }
  const win_rate_by_regime: Record<string, number> = {};
  for (const [r, v] of Object.entries(regimeMap)) {
    win_rate_by_regime[r] = v.total ? Math.round(v.wins / v.total * 100) : 0;
  }

  // Avg R by instrument
  const instrMap: Record<string, { sum: number; count: number }> = {};
  for (const e of closed) {
    const k = e.instrument_type;
    if (!instrMap[k]) instrMap[k] = { sum: 0, count: 0 };
    instrMap[k].sum += (e.pnl_r ?? 0);
    instrMap[k].count++;
  }
  const avg_r_by_instrument: Record<string, number> = {};
  for (const [k, v] of Object.entries(instrMap)) {
    avg_r_by_instrument[k] = v.count ? Math.round(v.sum / v.count * 100) / 100 : 0;
  }

  // Win rate by hour
  const hourMap: Record<number, { wins: number; total: number }> = {};
  for (const e of closed) {
    const h = e.entry_date ? new Date(e.entry_date).getUTCHours() : -1;
    if (h < 0) continue;
    if (!hourMap[h]) hourMap[h] = { wins: 0, total: 0 };
    hourMap[h].total++;
    if ((e.pnl_r ?? 0) > 0) hourMap[h].wins++;
  }
  const win_rate_by_hour: Record<number, number> = {};
  for (const [h, v] of Object.entries(hourMap)) {
    win_rate_by_hour[Number(h)] = Math.round(v.wins / v.total * 100);
  }

  // Win rate by weekday
  const wdMap: Record<number, { wins: number; total: number }> = {};
  for (const e of closed) {
    const wd = e.entry_date ? new Date(e.entry_date).getUTCDay() : -1;
    if (wd < 0) continue;
    if (!wdMap[wd]) wdMap[wd] = { wins: 0, total: 0 };
    wdMap[wd].total++;
    if ((e.pnl_r ?? 0) > 0) wdMap[wd].wins++;
  }
  const win_rate_by_weekday: Record<number, number> = {};
  for (const [wd, v] of Object.entries(wdMap)) {
    win_rate_by_weekday[Number(wd)] = Math.round(v.wins / v.total * 100);
  }

  // Behavioral pattern: cut winners early
  // Flag if avg R of wins < 1.5R (implies taking profit too early)
  const winR = wins.map((e) => e.pnl_r ?? 0);
  const avgWinR  = winR.length ? winR.reduce((a, b) => a + b, 0) / winR.length : 0;
  const lossR    = closed.filter((e) => (e.pnl_r ?? 0) <= 0).map((e) => Math.abs(e.pnl_r ?? 0));
  const avgLossR = lossR.length ? lossR.reduce((a, b) => a + b, 0) / lossR.length : 0;
  const cut_winners_early_flag = winR.length >= 5 && avgWinR < 1.2;
  const hold_losers_long_flag  = lossR.length >= 5 && avgLossR > 1.5;

  // Equity curve (cumulative R)
  const equity_curve = closed
    .sort((a, b) => (a.entry_date ?? '').localeCompare(b.entry_date ?? ''))
    .reduce<number[]>((acc, e) => {
      const prev = acc.length ? acc[acc.length - 1] : 0;
      acc.push(prev + (e.pnl_r ?? 0));
      return acc;
    }, []);

  // Max drawdown on equity curve
  let peak = -Infinity, max_drawdown = 0;
  for (const val of equity_curve) {
    if (val > peak) peak = val;
    const dd = peak - val;
    if (dd > max_drawdown) max_drawdown = dd;
  }

  // Monthly P&L
  const monthMap: Record<string, number> = {};
  for (const e of closed) {
    const month = (e.exit_date ?? e.entry_date ?? '').slice(0, 7);
    if (!month) continue;
    monthMap[month] = (monthMap[month] ?? 0) + (e.pnl_r ?? 0);
  }
  const monthly_pnl = Object.entries(monthMap)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, pnl]) => ({ month, pnl: Math.round(pnl * 100) / 100 }));

  return {
    total_trades: entries.length,
    win_rate:     Math.round(win_rate * 10) / 10,
    avg_r:        Math.round(avg_r * 100) / 100,
    max_drawdown: Math.round(max_drawdown * 100) / 100,
    win_rate_by_wave,
    win_rate_by_regime,
    avg_r_by_instrument,
    win_rate_by_hour,
    win_rate_by_weekday,
    cut_winners_early_flag,
    hold_losers_long_flag,
    monthly_pnl,
    equity_curve,
  };
}

// ── Store ─────────────────────────────────────────────────────────────────────

interface JournalState {
  entries: JournalEntry[];
  addEntry:    (entry: Omit<JournalEntry, 'id'>) => string;
  updateEntry: (id: string, patch: Partial<JournalEntry>) => void;
  deleteEntry: (id: string) => void;
  closeEntry:  (id: string, exitPrice: number, exitDate: string, notes: string, emotional: EmotionalState) => void;
}

export const useJournalStore = create<JournalState>()(
  persist(
    immer((set) => ({
      entries: [],

      addEntry: (entry) => {
        const id = `j_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
        set((s) => {
          s.entries.unshift({ ...entry, id });
        });
        return id;
      },

      updateEntry: (id, patch) =>
        set((s) => {
          const idx = s.entries.findIndex((e) => e.id === id);
          if (idx !== -1) Object.assign(s.entries[idx], patch);
        }),

      closeEntry: (id, exitPrice, exitDate, notes, emotional) =>
        set((s) => {
          const e = s.entries.find((e) => e.id === id);
          if (!e) return;
          e.exit_price     = exitPrice;
          e.exit_date      = exitDate;
          e.notes          = notes;
          e.emotional_state = emotional;
          e.pnl_r          = computeR({ ...e, exit_price: exitPrice });
          e.pnl_pct        = computePctReturn({ ...e, exit_price: exitPrice });
          const r = e.pnl_r ?? 0;
          e.outcome = r > 0.05 ? 'win' : r < -0.05 ? 'loss' : 'breakeven';
        }),

      deleteEntry: (id) =>
        set((s) => {
          s.entries = s.entries.filter((e) => e.id !== id);
        }),
    })),
    {
      name:    'journal-v1',
      storage: createJSONStorage(() => mmkvStorage),
    },
  ),
);
