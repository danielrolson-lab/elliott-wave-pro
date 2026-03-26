/**
 * useRegimeClassifier.ts
 *
 * Runs the rules-based regime classifier whenever candles update.
 * Writes the result to marketData.regimes[ticker].
 */

import { useEffect, useRef } from 'react';
import { classifyRegime }       from '../utils/regimeClassifier';
import { useMarketDataStore }   from '../stores/marketData';
import { useOptionsStore }      from '../stores/options';
import type { OHLCV }           from '@elliott-wave-pro/wave-engine';

export function useRegimeClassifier(
  ticker:    string,
  timeframe: string,
  candles:   readonly OHLCV[],
): void {
  const setRegime    = useMarketDataStore((s) => s.setRegime);
  const prevLenRef   = useRef(0);

  // Read ATM IV from near-term term structure
  const atmIV = useOptionsStore((s) => {
    const ts = s.termStructure[ticker];
    return ts && ts.length > 0 ? ts[0].atmIV : 0;
  });

  useEffect(() => {
    if (candles.length < 21) return;
    if (candles.length === prevLenRef.current) return;
    prevLenRef.current = candles.length;

    const regime = classifyRegime({ candles, atmIV });
    setRegime(ticker, regime);
  }, [candles, atmIV, ticker, timeframe, setRegime]);
}
