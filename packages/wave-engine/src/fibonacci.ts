/**
 * fibonacci.ts
 *
 * Computes Fibonacci retracement and extension levels for a given WaveCount.
 *
 * Anchor logic:
 *   Retracements — measure how deep a correction can go.
 *     Anchor: Wave 1 (P0 → P1).
 *     Applied from P1 back toward P0.
 *     Ratios: 0.236, 0.382, 0.5, 0.618, 0.786
 *
 *   Extensions — project how far the next impulse can reach.
 *     Anchor: Wave 1 length, projected forward from the Wave 2 end (P2).
 *     Ratios: 1.0, 1.272, 1.618, 2.0, 2.618
 *
 * `hit: true` when `|currentPrice - level| / level ≤ tolerance` (default 0.3%).
 */

import type { WaveCount, FibLevel } from './types';

// ── Constants ─────────────────────────────────────────────────────────────────

export const RETRACEMENT_RATIOS: readonly number[] = [
  0.236, 0.382, 0.5, 0.618, 0.786,
];

export const EXTENSION_RATIOS: readonly number[] = [
  1.0, 1.272, 1.618, 2.0, 2.618,
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function isNear(price: number, level: number, tolerance: number): boolean {
  if (level === 0) return false;
  return Math.abs(price - level) / Math.abs(level) <= tolerance;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Compute Fibonacci retracement and extension levels for `waveCount`.
 *
 * Returns exactly 10 FibLevel objects:
 *   [0..4]  retracements (ratios 0.236 → 0.786)
 *   [5..9]  extensions   (ratios 1.0   → 2.618)
 *
 * @param waveCount    A valid WaveCount (from generateWaveCounts)
 * @param currentPrice The current market price (for `hit` calculation)
 * @param tolerance    Fraction of price within which a level is considered
 *                     "hit" (default 0.003 = 0.3%)
 */
export function computeFibLevels(
  waveCount: WaveCount,
  currentPrice: number,
  tolerance = 0.003,
): FibLevel[] {
  const wave1 = waveCount.allWaves.find((w) => w.label === '1');
  const wave2 = waveCount.allWaves.find((w) => w.label === '2');

  if (!wave1 || !wave2) return [];

  const p0 = wave1.startPivot.price;  // Wave 1 start
  const p1 = wave1.endPivot?.price;   // Wave 1 end
  const p2 = wave2.endPivot?.price;   // Wave 2 end = Wave 3 start

  if (p1 === undefined || p2 === undefined) return [];

  const w1Len = p1 - p0;          // signed: positive for bullish
  const isBullish = w1Len > 0;

  // ── Retracements ────────────────────────────────────────────────────────────
  // Applied from P1 (Wave 1 end) back toward P0.
  // For bullish: levels sit between P0 and P1, going downward from P1.
  // price = P1 - ratio × |W1|
  const retracements: FibLevel[] = RETRACEMENT_RATIOS.map((ratio) => {
    const price = p1 - ratio * Math.abs(w1Len) * (isBullish ? 1 : -1);
    return { ratio, price, hit: isNear(currentPrice, price, tolerance) };
  });

  // ── Extensions ──────────────────────────────────────────────────────────────
  // Projected from P2 (Wave 2 end / Wave 3 start) using Wave 1 length.
  // For bullish: levels sit above P2, extending upward.
  // price = P2 + ratio × |W1|
  const direction = isBullish ? 1 : -1;
  const extensions: FibLevel[] = EXTENSION_RATIOS.map((ratio) => {
    const price = p2 + direction * ratio * Math.abs(w1Len);
    return { ratio, price, hit: isNear(currentPrice, price, tolerance) };
  });

  return [...retracements, ...extensions];
}

/**
 * Return only the levels that are currently being hit.
 * Useful for probability scoring and UI highlighting.
 */
export function getConfluenceHits(
  waveCount: WaveCount,
  currentPrice: number,
  tolerance = 0.003,
): FibLevel[] {
  return computeFibLevels(waveCount, currentPrice, tolerance).filter(
    (l) => l.hit,
  );
}
