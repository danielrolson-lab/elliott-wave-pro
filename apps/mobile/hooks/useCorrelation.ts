/**
 * hooks/useCorrelation.ts
 *
 * Fetches daily closes for all watchlist tickers, builds rolling 20-day
 * correlation matrix, and detects breakdowns vs the prior 40-day window.
 * Refreshes once per day (or on demand).
 */

import { useCallback, useEffect } from 'react';
import { useWatchlistStore }   from '../stores/watchlist';
import { useCorrelationStore } from '../stores/correlation';
import { buildCorrelationMatrix } from '../utils/correlationEngine';

const POLYGON_BASE = 'https://api.polygon.io';
const API_KEY      = process.env.EXPO_PUBLIC_POLYGON_API_KEY ?? '';

async function fetchDailyCloses(ticker: string, limit: number = 60): Promise<number[]> {
  const url = `${POLYGON_BASE}/v2/aggs/ticker/${ticker}/range/1/day/2020-01-01/2099-01-01?adjusted=true&sort=asc&limit=${limit}&apiKey=${API_KEY}`;
  try {
    const resp = await fetch(url);
    if (!resp.ok) return [];
    const data = await resp.json() as { results?: Array<{ c: number }> };
    return (data.results ?? []).map((r) => r.c);
  } catch {
    return [];
  }
}

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

export function useCorrelation() {
  const tickers        = useWatchlistStore((s) => s.items.map((i) => i.instrument.ticker));
  const { setCurrent, setPrior, setStatus, setError, setLastComputed, lastComputed } = useCorrelationStore();

  const compute = useCallback(async () => {
    if (tickers.length < 2) return;
    setStatus('loading');
    try {
      const priceMap: Record<string, number[]> = {};
      await Promise.all(
        tickers.map(async (ticker) => {
          const closes = await fetchDailyCloses(ticker, 60);
          if (closes.length >= 21) priceMap[ticker] = closes;
        }),
      );

      const validTickers = Object.keys(priceMap);
      if (validTickers.length < 2) {
        setStatus('error');
        setError('Need at least 2 tickers with price history');
        return;
      }

      const current = buildCorrelationMatrix(priceMap, 20);
      const prior   = buildCorrelationMatrix(priceMap, 40);

      setCurrent(current);
      setPrior(prior);
      setLastComputed(Date.now());
      setStatus('success');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Correlation error');
      setStatus('error');
    }
  }, [tickers, setCurrent, setPrior, setStatus, setError, setLastComputed]);

  useEffect(() => {
    if (Date.now() - lastComputed > ONE_DAY_MS) {
      void compute();
    }
  }, [compute, lastComputed]);

  return { compute };
}
