/**
 * useGEXLevels.ts
 *
 * Fetches the options chain from Polygon, computes dealer GEX levels, and
 * writes them to the GEX store.  Re-fetches whenever `ticker` changes.
 *
 * The current spot price is read from the marketData store (last close of
 * the most recent candle for `${ticker}_5m`).  Falls back to 0 if not yet
 * available — the calculator treats 0 as "no data" and returns null.
 *
 * Refresh: automatic on ticker change + manual via the returned `refresh()`
 * function.  The caller can wire `refresh` to a pull-to-refresh control.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchOptionsChain }    from '../services/polygonOptions';
import { computeGEXLevels }     from '../utils/gexCalculator';
import { useGEXStore }          from '../stores/gex';
import { useMarketDataStore }   from '../stores/marketData';

const POLYGON_API_KEY = process.env.EXPO_PUBLIC_POLYGON_API_KEY ?? '';

export type GEXStatus = 'idle' | 'loading' | 'success' | 'error';

export interface UseGEXLevelsResult {
  status:  GEXStatus;
  error:   string | null;
  refresh: () => void;
}

export function useGEXLevels(ticker: string): UseGEXLevelsResult {
  const setLevels    = useGEXStore((s) => s.setLevels);
  const [status,  setStatus]  = useState<GEXStatus>('idle');
  const [error,   setError]   = useState<string | null>(null);
  const abortRef  = useRef<AbortController | null>(null);

  // Read spot price from the 5m candle store (last close)
  const spot = useMarketDataStore((s) => {
    const candles = s.candles[`${ticker}_5m`];
    return candles && candles.length > 0 ? candles[candles.length - 1].close : 0;
  });

  const run = useCallback(async () => {
    if (!POLYGON_API_KEY) {
      setStatus('error');
      setError('EXPO_PUBLIC_POLYGON_API_KEY not configured');
      return;
    }

    // Cancel any previous in-flight request
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    setStatus('loading');
    setError(null);

    try {
      const records = await fetchOptionsChain(ticker, POLYGON_API_KEY, ctrl.signal);

      if (ctrl.signal.aborted) return;

      // Use spot from closure; if 0, computeGEXLevels returns null
      const levels = computeGEXLevels(records, spot);
      setLevels(ticker, levels);
      setStatus('success');
    } catch (err: unknown) {
      if (ctrl.signal.aborted) return;
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      setStatus('error');
      setLevels(ticker, null);
    }
  }, [ticker, spot, setLevels]);

  useEffect(() => {
    void run();
    return () => {
      abortRef.current?.abort();
    };
  }, [run]);

  return { status, error, refresh: run };
}
