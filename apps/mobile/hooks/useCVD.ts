/**
 * useCVD.ts
 *
 * Computes Cumulative Volume Delta on every candle close and writes the result
 * to the indicators store so CVDIndicator can read it without re-computing.
 */

import { useEffect } from 'react';
import type { OHLCV } from '@elliott-wave-pro/wave-engine';
import { computeCVD } from '../utils/cvdEngine';
import { useIndicatorStore } from '../stores/indicators';

export function useCVD(
  ticker:    string,
  timeframe: string,
  candles:   readonly OHLCV[],
): void {
  const setCVD = useIndicatorStore((s) => s.setCVD);
  const key    = `${ticker}_${timeframe}`;

  useEffect(() => {
    if (candles.length === 0) return;
    const result = computeCVD(candles);
    setCVD(key, {
      cumulative:  result.bars.map((b) => b.cumulative),
      deltas:      result.bars.map((b) => b.delta),
      divergences: result.divergences,
    });
  }, [candles, key, setCVD]);
}
