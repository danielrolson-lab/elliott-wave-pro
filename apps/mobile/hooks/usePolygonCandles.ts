/**
 * usePolygonCandles
 *
 * Fetches real historical OHLCV candles from the Polygon.io REST API and writes
 * them into the Zustand marketData store under the key `${ticker}_${timeframe}`.
 *
 * Called once per (ticker, timeframe) pair. Subsequent WS aggregate updates
 * from usePolygonWebSocket merge on top via updateLiveAggregate().
 *
 * Endpoint used:
 *   GET /v2/aggs/ticker/{ticker}/range/{multiplier}/{timespan}/{from}/{to}
 *
 * Env var required: EXPO_PUBLIC_POLYGON_API_KEY
 */

import { useEffect, useRef, useState } from 'react';
import { useMarketDataStore } from '../stores/marketData';
import type { TimeframeOption } from '../components/chart/chartTypes';
import type { OHLCV } from '@elliott-wave-pro/wave-engine';

// ─── Polygon REST response types ──────────────────────────────────────────────

interface PolygonAgg {
  t: number;   // bar start timestamp ms
  o: number;   // open
  h: number;   // high
  l: number;   // low
  c: number;   // close
  v: number;   // volume
  vw?: number; // VWAP
  n?: number;  // number of trades
}

interface PolygonAggsResponse {
  status: string;
  resultsCount?: number;
  results?: PolygonAgg[];
  error?: string;
}

// ─── Timeframe mapping ────────────────────────────────────────────────────────

interface TFSpec {
  multiplier: number;
  timespan: 'minute' | 'hour' | 'day' | 'week';
  /** How many calendar days of history to request. */
  lookbackDays: number;
}

// Lookback sized so each TF can show ~1000 bars when fully zoomed out.
// Anchor: 30m = 21 calendar days ≈ 1,000 bars on a 24hr/day basis.
// Scaled proportionally: days = 21 × (tf_minutes / 30).
const TF_MAP: Readonly<Record<TimeframeOption, TFSpec>> = {
  '1m':  { multiplier: 1,  timespan: 'minute', lookbackDays: 2    },  // ~780 mkt bars; 1m is API-rate-limited
  '5m':  { multiplier: 5,  timespan: 'minute', lookbackDays: 5    },  // ~390 bars (keep short — 5m data is dense)
  '15m': { multiplier: 15, timespan: 'minute', lookbackDays: 11   },  // ~572 bars
  '30m': { multiplier: 30, timespan: 'minute', lookbackDays: 21   },  // ~1,092 bars
  '1h':  { multiplier: 1,  timespan: 'hour',   lookbackDays: 42   },  // ~1,092 bars
  '4h':  { multiplier: 4,  timespan: 'hour',   lookbackDays: 168  },  // ~1,092 bars
  '1D':  { multiplier: 1,  timespan: 'day',    lookbackDays: 1008 },  // ~1,008 trading days ≈ 4 years
  '1W':  { multiplier: 1,  timespan: 'week',   lookbackDays: 730  },  // ~104 weekly bars
};

// ─── Date helpers ─────────────────────────────────────────────────────────────

/** Format a Date as YYYY-MM-DD for Polygon REST query params. */
function toDateParam(d: Date): string {
  const year  = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day   = String(d.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// ─── Fetch ────────────────────────────────────────────────────────────────────

const BASE_URL = 'https://api.polygon.io';

async function fetchCandles(
  ticker: string,
  spec: TFSpec,
  apiKey: string,
  signal: AbortSignal,
): Promise<OHLCV[]> {
  const now  = new Date();
  const from = new Date(now.getTime() - spec.lookbackDays * 24 * 60 * 60 * 1000);

  const params = new URLSearchParams({
    adjusted: 'true',
    sort:     'asc',
    limit:    '50000',
    apiKey,
  });

  const url = [
    BASE_URL,
    'v2/aggs/ticker',
    encodeURIComponent(ticker),
    'range',
    String(spec.multiplier),
    spec.timespan,
    toDateParam(from),
    toDateParam(now),
  ].join('/') + `?${params.toString()}`;

  const response = await fetch(url, { signal });

  if (!response.ok) {
    throw new Error(`Polygon REST ${response.status}: ${response.statusText}`);
  }

  const data: PolygonAggsResponse = (await response.json()) as PolygonAggsResponse;

  if (data.status === 'ERROR') {
    throw new Error(data.error ?? 'Polygon returned ERROR status');
  }

  if (!data.results || data.results.length === 0) {
    return [];
  }

  return data.results.map((agg): OHLCV => ({
    timestamp: agg.t,
    open:      agg.o,
    high:      agg.h,
    low:       agg.l,
    close:     agg.c,
    volume:    agg.v,
    vwap:      agg.vw,
  }));
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export type BackfillStatus = 'idle' | 'loading' | 'success' | 'error';

export interface UsePolygonCandlesResult {
  status: BackfillStatus;
  error: string | null;
}

/**
 * Fetches historical OHLCV for the given ticker + timeframe from Polygon REST
 * and writes them to the marketData store. Re-fetches whenever ticker or
 * timeframe changes.
 *
 * The chart component reads candles from `marketData.candles[key]` directly;
 * this hook only drives the fetch + store write.
 */
export function usePolygonCandles(
  ticker: string,
  timeframe: TimeframeOption,
): UsePolygonCandlesResult {
  const upsertCandles = useMarketDataStore((s) => s.upsertCandles);
  const [status, setStatus] = useState<BackfillStatus>('idle');
  const [error, setError]   = useState<string | null>(null);
  // Track the last (ticker, timeframe) so we don't re-fetch the same pair
  const lastKey = useRef<string>('');

  useEffect(() => {
    const apiKey = process.env.EXPO_PUBLIC_POLYGON_API_KEY;
    if (!apiKey) {
      setStatus('error');
      setError('EXPO_PUBLIC_POLYGON_API_KEY is not set');
      return;
    }

    const storeKey = `${ticker}_${timeframe}`;
    if (lastKey.current === storeKey) return;
    lastKey.current = storeKey;

    const spec = TF_MAP[timeframe];
    const controller = new AbortController();

    setStatus('loading');
    setError(null);

    fetchCandles(ticker, spec, apiKey, controller.signal)
      .then((candles) => {
        upsertCandles(storeKey, candles);
        setStatus('success');
        if (__DEV__) {
          console.log(
            `[usePolygonCandles] ${storeKey}: loaded ${candles.length} bars`,
          );
        }
      })
      .catch((err: unknown) => {
        if (err instanceof Error && err.name === 'AbortError') return;
        const message = err instanceof Error ? err.message : String(err);
        setStatus('error');
        setError(message);
        console.error(`[usePolygonCandles] ${storeKey}: ${message}`);
      });

    return () => {
      controller.abort();
    };
  }, [ticker, timeframe, upsertCandles]);

  return { status, error };
}
