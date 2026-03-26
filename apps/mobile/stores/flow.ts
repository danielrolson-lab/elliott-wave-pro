/**
 * stores/flow.ts
 *
 * Zustand store for the options flow feed.
 *
 * Ring buffer: keeps the newest MAX_PRINTS prints across all fetches.
 * On each ingest, prints are merged by ID (dedup), sorted by premium desc,
 * and REPEAT flags are tagged: any strike that appears ≥ 3 times in the
 * rolling 10-minute window is marked isRepeat = true.
 */

import { create } from 'zustand';
import { immer }  from 'zustand/middleware/immer';
import type { FlowPrint, FlowSentiment } from '../services/flowFeed';

// ── Constants ─────────────────────────────────────────────────────────────────

const MAX_PRINTS       = 300;
const REPEAT_WINDOW_MS = 10 * 60 * 1000;   // 10 minutes
const REPEAT_THRESHOLD = 3;                 // appearances to qualify as REPEAT

// ── Filter types ──────────────────────────────────────────────────────────────

export type MinPremiumTier = 10_000 | 50_000 | 100_000 | 500_000 | 1_000_000;

export const PREMIUM_TIERS: MinPremiumTier[] = [10_000, 50_000, 100_000, 500_000, 1_000_000];

export type FlowTypeFilter = 'all' | 'sweeps' | 'blocks' | 'unusual';

export interface FlowFilter {
  minPremium:  MinPremiumTier;
  sentiment:   'all' | FlowSentiment;
  type:        FlowTypeFilter;
  ewAlignment: boolean;   // only show if EW primary count direction matches sentiment
}

const DEFAULT_FILTER: FlowFilter = {
  minPremium:  50_000,
  sentiment:   'all',
  type:        'all',
  ewAlignment: false,
};

// ── State ─────────────────────────────────────────────────────────────────────

interface FlowState {
  prints:     FlowPrint[];
  filter:     FlowFilter;
  lastFetch:  number;    // unix ms — 0 if never fetched

  ingest(incoming: FlowPrint[]): void;
  setFilter<K extends keyof FlowFilter>(key: K, value: FlowFilter[K]): void;
  clearPrints(): void;
}

// ── Repeat detection helper ───────────────────────────────────────────────────

/**
 * Tags isRepeat=true on prints whose strike (per underlying) has appeared
 * REPEAT_THRESHOLD or more times within REPEAT_WINDOW_MS of each other in
 * the combined print set.
 */
function tagRepeats(prints: FlowPrint[]): void {
  // Group fetchedAt timestamps by `${ticker}_${strike}`
  const windows = new Map<string, number[]>();

  for (const p of prints) {
    const key = `${p.ticker}_${p.strike}`;
    let arr = windows.get(key);
    if (!arr) { arr = []; windows.set(key, arr); }
    arr.push(p.fetchedAt);
  }

  // For each print, check if its strike has ≥ REPEAT_THRESHOLD appearances in its window
  const repeatKeys = new Set<string>();
  for (const [key, times] of windows) {
    const sorted = times.slice().sort((a, b) => a - b);
    for (let i = 0; i <= sorted.length - REPEAT_THRESHOLD; i++) {
      if (sorted[i + REPEAT_THRESHOLD - 1] - sorted[i] <= REPEAT_WINDOW_MS) {
        repeatKeys.add(key);
        break;
      }
    }
  }

  for (const p of prints) {
    p.isRepeat = repeatKeys.has(`${p.ticker}_${p.strike}`);
  }
}

// ── Store ─────────────────────────────────────────────────────────────────────

export const useFlowStore = create<FlowState>()(
  immer((set) => ({
    prints:    [],
    filter:    DEFAULT_FILTER,
    lastFetch: 0,

    ingest(incoming) {
      set((s) => {
        // Merge with existing by ID (dedup)
        const existingById = new Map<string, FlowPrint>(s.prints.map((p) => [p.id, p]));
        for (const p of incoming) {
          existingById.set(p.id, p);
        }

        // Evict prints older than REPEAT_WINDOW_MS + 2 min buffer
        const cutoff = Date.now() - REPEAT_WINDOW_MS - 2 * 60_000;
        let merged = Array.from(existingById.values()).filter((p) => p.fetchedAt >= cutoff);

        // Sort by premium desc
        merged.sort((a, b) => b.premium - a.premium);

        // Trim to ring buffer size
        if (merged.length > MAX_PRINTS) merged = merged.slice(0, MAX_PRINTS);

        // Tag repeats in-place
        tagRepeats(merged);

        s.prints    = merged;
        s.lastFetch = Date.now();
      });
    },

    setFilter(key, value) {
      set((s) => {
        (s.filter as Record<string, unknown>)[key] = value;
      });
    },

    clearPrints() {
      set((s) => { s.prints = []; });
    },
  })),
);

// ── Selector: apply filter ────────────────────────────────────────────────────

export function applyFlowFilter(
  prints: readonly FlowPrint[],
  filter: FlowFilter,
): FlowPrint[] {
  return prints.filter((p) => {
    if (p.premium < filter.minPremium) return false;

    if (filter.sentiment !== 'all' && p.sentiment !== filter.sentiment) return false;

    if (filter.type === 'sweeps'  && !p.isSweep)  return false;
    if (filter.type === 'blocks'  && !p.isBlock)  return false;
    if (filter.type === 'unusual' && p.volOIRatio < 0.5) return false;

    return true;
  });
}
