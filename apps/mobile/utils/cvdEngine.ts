/**
 * cvdEngine.ts
 *
 * Cumulative Volume Delta (CVD) computation from OHLCV bars.
 *
 * Bar-level aggressor classification (uptick rule):
 *   close > prevClose  → bullish bar → +volume  (BUY pressure)
 *   close < prevClose  → bearish bar → -volume  (SELL pressure)
 *   close === prevClose → split 50/50 (neutral)
 *
 * CVD is the running sum of signed volumes; positive = net buy pressure.
 *
 * Divergence detection (5-bar look-back windows):
 *   Bearish: price makes higher high, CVD makes lower high → supply absorption
 *   Bullish: price makes lower low,  CVD makes higher low  → demand absorption
 */

import type { OHLCV } from '@elliott-wave-pro/wave-engine';

export interface CVDBar {
  /** Signed volume for this bar (+buy / -sell) */
  delta:       number;
  /** Cumulative delta up to and including this bar */
  cumulative:  number;
}

export interface CVDDivergence {
  barIdx: number;
  type:   'bearish' | 'bullish';
}

export interface CVDResult {
  bars:        readonly CVDBar[];
  divergences: readonly CVDDivergence[];
}

// ── Core computation ──────────────────────────────────────────────────────────

export function computeCVD(candles: readonly OHLCV[]): CVDResult {
  if (candles.length === 0) return { bars: [], divergences: [] };

  const bars: CVDBar[] = [];
  let cumulative = 0;

  for (let i = 0; i < candles.length; i++) {
    const c = candles[i]!;
    const prevClose = i > 0 ? candles[i - 1]!.close : c.open;
    const vol = c.volume ?? 0;

    let delta: number;
    if (c.close > prevClose) {
      delta = +vol;
    } else if (c.close < prevClose) {
      delta = -vol;
    } else {
      delta = 0; // flat close — neutral
    }

    cumulative += delta;
    bars.push({ delta, cumulative });
  }

  const divergences = detectDivergences(candles, bars);
  return { bars, divergences };
}

// ── Divergence detection ──────────────────────────────────────────────────────

const LOOKBACK = 5;

function detectDivergences(
  candles: readonly OHLCV[],
  bars:    readonly CVDBar[],
): CVDDivergence[] {
  const result: CVDDivergence[] = [];
  const n = candles.length;

  for (let i = LOOKBACK; i < n; i++) {
    const priceNow  = candles[i]!.close;
    const cvdNow    = bars[i]!.cumulative;

    // Find the reference bar (highest close in lookback for bearish; lowest for bullish)
    let refPrice = candles[i - 1]!.close;
    let refCVD   = bars[i - 1]!.cumulative;
    for (let j = i - LOOKBACK; j < i; j++) {
      if (candles[j]!.close > refPrice) {
        refPrice = candles[j]!.close;
        refCVD   = bars[j]!.cumulative;
      }
    }

    // Bearish divergence: price higher high, CVD lower high
    if (priceNow > refPrice && cvdNow < refCVD) {
      result.push({ barIdx: i, type: 'bearish' });
    }

    // Bullish divergence: price lower low, CVD higher low
    let refPriceLow = candles[i - 1]!.close;
    let refCVDLow   = bars[i - 1]!.cumulative;
    for (let j = i - LOOKBACK; j < i; j++) {
      if (candles[j]!.close < refPriceLow) {
        refPriceLow = candles[j]!.close;
        refCVDLow   = bars[j]!.cumulative;
      }
    }

    if (priceNow < refPriceLow && cvdNow > refCVDLow) {
      result.push({ barIdx: i, type: 'bullish' });
    }
  }

  return result;
}
