/**
 * pivot-detection.ts
 *
 * Adaptive ZigZag pivot detector using ATR-based swing threshold.
 *
 * Algorithm:
 *   1. Compute ATR(14) via Wilder's smoothing.
 *   2. Walk candles with a state machine: track the running extreme in the
 *      current direction.  A reversal is confirmed once price moves
 *      `atrMultiplier × ATR` against the extreme.
 *   3. Label each alternating pivot as HH/HL/LH/LL by comparing to the
 *      prior pivot of the same polarity.
 *
 * Spec ref: "ZigZag with adaptive threshold: threshold = ATR(14)/price × 100"
 */

import type { OHLCV, Pivot, PivotType } from './types';

// ── ATR (Wilder's smoothing) ──────────────────────────────────────────────────

/**
 * Returns an ATR array the same length as `candles`.
 * Early slots (< period) are back-filled with the seed ATR.
 */
export function computeATR(candles: OHLCV[], period = 14): number[] {
  const n = candles.length;
  if (n === 0) return [];

  // True range for each bar
  const tr = new Array<number>(n).fill(0);
  tr[0] = candles[0].high - candles[0].low;
  for (let i = 1; i < n; i++) {
    tr[i] = Math.max(
      candles[i].high - candles[i].low,
      Math.abs(candles[i].high - candles[i - 1].close),
      Math.abs(candles[i].low - candles[i - 1].close),
    );
  }

  const atr = new Array<number>(n).fill(0);
  const seedLen = Math.min(period, n);

  // Seed: SMA of first `seedLen` TR values
  let seed = 0;
  for (let i = 0; i < seedLen; i++) seed += tr[i];
  atr[seedLen - 1] = seed / seedLen;

  // Wilder's smoothing: ATR[i] = (ATR[i-1] × (p-1) + TR[i]) / p
  for (let i = seedLen; i < n; i++) {
    atr[i] = (atr[i - 1] * (period - 1) + tr[i]) / period;
  }

  // Back-fill early slots
  const seedAtr = atr[seedLen - 1];
  for (let i = 0; i < seedLen - 1; i++) atr[i] = seedAtr;

  return atr;
}

// ── ZigZag state machine ──────────────────────────────────────────────────────

interface ZigZagPoint {
  index: number;
  price: number;
  isHigh: boolean;
  timestamp: number;
}

function buildZigZag(
  candles: OHLCV[],
  atr: number[],
  atrMultiplier: number,
): ZigZagPoint[] {
  const n = candles.length;
  if (n < 3) return [];

  const points: ZigZagPoint[] = [];

  // Determine initial direction from the first two closes
  let direction: 'up' | 'down' =
    candles[1].close >= candles[0].close ? 'up' : 'down';
  let extremeIdx = 0;
  let extremePrice =
    direction === 'up' ? candles[0].high : candles[0].low;

  for (let i = 1; i < n; i++) {
    const bar = candles[i];
    // Minimum swing = atrMultiplier × ATR, floored at 0.05% of price
    const threshold = Math.max(
      atr[i] * atrMultiplier,
      bar.close * 0.0005,
    );

    if (direction === 'up') {
      if (bar.high > extremePrice) {
        extremePrice = bar.high;
        extremeIdx = i;
      } else if (extremePrice - bar.close >= threshold) {
        points.push({
          index: extremeIdx,
          price: extremePrice,
          isHigh: true,
          timestamp: candles[extremeIdx].timestamp,
        });
        direction = 'down';
        extremePrice = bar.low;
        extremeIdx = i;
      }
    } else {
      if (bar.low < extremePrice) {
        extremePrice = bar.low;
        extremeIdx = i;
      } else if (bar.close - extremePrice >= threshold) {
        points.push({
          index: extremeIdx,
          price: extremePrice,
          isHigh: false,
          timestamp: candles[extremeIdx].timestamp,
        });
        direction = 'up';
        extremePrice = bar.high;
        extremeIdx = i;
      }
    }
  }

  // Append the final (unconfirmed) extreme
  const last = points[points.length - 1];
  if (!last || last.index !== extremeIdx) {
    points.push({
      index: extremeIdx,
      price: extremePrice,
      isHigh: direction === 'up',
      timestamp: candles[extremeIdx].timestamp,
    });
  }

  return points;
}

// ── HH / HL / LH / LL labeling ───────────────────────────────────────────────

function labelPivotTypes(points: ZigZagPoint[]): PivotType[] {
  const types: PivotType[] = [];
  let prevHighIdx = -1;
  let prevLowIdx = -1;

  for (let i = 0; i < points.length; i++) {
    const p = points[i];

    if (p.isHigh) {
      if (prevHighIdx === -1) {
        types.push('HH'); // first high — assume new high
      } else {
        types.push(p.price > points[prevHighIdx].price ? 'HH' : 'LH');
      }
      prevHighIdx = i;
    } else {
      if (prevLowIdx === -1) {
        types.push('LL'); // first low — assume new low
      } else {
        types.push(p.price > points[prevLowIdx].price ? 'HL' : 'LL');
      }
      prevLowIdx = i;
    }
  }

  return types;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Detect swing pivots from a candle array.
 *
 * @param candles      OHLCV array, sorted oldest → newest
 * @param atrMultiplier  How many ATRs constitute a meaningful swing (default 0.5)
 * @param timeframe    Label stamped on every returned Pivot (default '5m')
 * @returns            Alternating high/low Pivot array, oldest → newest
 */
export function detectPivots(
  candles: OHLCV[],
  atrMultiplier = 0.5,
  timeframe = '5m',
): Pivot[] {
  if (candles.length < 3) return [];

  const atr = computeATR(candles);
  const zigzag = buildZigZag(candles, atr, atrMultiplier);
  const types = labelPivotTypes(zigzag);

  return zigzag.map((p, i) => ({
    index: p.index,
    price: p.price,
    timestamp: p.timestamp,
    type: types[i] as PivotType,
    timeframe,
  }));
}
