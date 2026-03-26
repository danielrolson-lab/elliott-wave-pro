/**
 * hooks/useDarkPoolFeed.ts
 *
 * Polls FINRA OTC transparency data via Polygon's trades endpoint.
 * Polygon does not expose a dedicated dark pool feed, so we proxy through
 * the trades API filtering by exchange codes associated with dark pools /
 * TRF venues (exchange codes 62, 63, 64, 65 = FINRA TRF variants).
 *
 * Polls every 30 seconds across liquid underlyings.
 */

import { useEffect, useRef, useCallback } from 'react';
import { useDarkPoolStore, type DarkPoolPrint } from '../stores/darkpool';
import { useWaveCountStore } from '../stores/waveCount';

const POLYGON_BASE  = 'https://api.polygon.io';
const API_KEY       = process.env.EXPO_PUBLIC_POLYGON_API_KEY ?? '';
const POLL_MS       = 30_000;
const DARK_EXCHANGES = [62, 63, 64, 65, 4];  // FINRA TRF + other dark venues

const DEFAULT_TICKERS = ['SPY', 'QQQ', 'AAPL', 'NVDA', 'MSFT', 'TSLA', 'AMZN', 'META'];

interface PolygonTrade {
  ev?: string;
  sym: string;
  p:   number;   // price
  s:   number;   // size
  t:   number;   // timestamp
  x:   number;   // exchange id
  i:   string;   // trade id
}

async function fetchRecentTrades(ticker: string): Promise<PolygonTrade[]> {
  const url = `${POLYGON_BASE}/v3/trades/${ticker}?limit=50&apiKey=${API_KEY}`;
  const resp = await fetch(url);
  if (!resp.ok) return [];
  const data = await resp.json() as { results?: PolygonTrade[] };
  return data.results ?? [];
}

async function fetchPrevDayVolume(ticker: string): Promise<number> {
  const url = `${POLYGON_BASE}/v2/aggs/ticker/${ticker}/prev?adjusted=true&apiKey=${API_KEY}`;
  const resp = await fetch(url);
  if (!resp.ok) return 10_000_000; // fallback ADV
  const data = await resp.json() as { results?: Array<{ v?: number }> };
  return data.results?.[0]?.v ?? 10_000_000;
}

export function useDarkPoolFeed(tickers: string[] = DEFAULT_TICKERS) {
  const { addPrint, setStatus, setError, setLastFetch } = useDarkPoolStore();
  const waveKey    = (ticker: string) => `${ticker}_5m`;
  const waveCounts = useWaveCountStore((s) => s.counts);
  const timerRef   = useRef<ReturnType<typeof setInterval> | null>(null);

  const pollTicker = useCallback(async (ticker: string) => {
    const [trades, adv] = await Promise.all([
      fetchRecentTrades(ticker),
      fetchPrevDayVolume(ticker),
    ]);

    const darkTrades = trades.filter((t) => DARK_EXCHANGES.includes(t.x));

    // Get current wave context
    const key    = waveKey(ticker);
    const counts = waveCounts[key] ?? [];
    const topCount = counts[0];
    const waveLabel     = topCount?.currentWave?.label ?? null;
    const wavePosterior = topCount ? (topCount.posterior?.posterior ?? null) : null;
    const isWave2or4    = waveLabel === '2' || waveLabel === '4';
    const waveContext   = waveLabel && isWave2or4
      ? `Wave ${waveLabel} retrace — potential institutional accumulation`
      : waveLabel
      ? `Wave ${waveLabel} active`
      : null;

    for (const trade of darkTrades) {
      const notional  = trade.p * trade.s;
      if (notional < 100_000) continue;  // skip tiny prints

      const pct_of_adv = adv > 0 ? (trade.s / adv) * 100 : 0;
      const large_flag = pct_of_adv >= 40;

      const print: DarkPoolPrint = {
        id:           `${ticker}_${trade.i}_${trade.t}`,
        timestamp:    trade.t,
        ticker,
        price:        trade.p,
        size:         trade.s,
        notional,
        venue:        trade.x === 62 ? 'NYSE TRF' : trade.x === 63 ? 'Nasdaq TRF' : trade.x === 4 ? 'FINRA ATS' : `TRF ${trade.x}`,
        pct_of_adv:   Math.round(pct_of_adv * 10) / 10,
        large_flag,
        wave_label:     waveLabel ? String(waveLabel) : null,
        wave_posterior: wavePosterior,
        wave_context:   waveContext,
      };
      addPrint(print);
    }
  }, [addPrint, waveCounts]);

  const pollAll = useCallback(async () => {
    setStatus('loading');
    try {
      await Promise.all(tickers.map(pollTicker));
      setLastFetch(Date.now());
      setStatus('live');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Feed error');
      setStatus('error');
    }
  }, [tickers, pollTicker, setStatus, setLastFetch, setError]);

  useEffect(() => {
    void pollAll();
    timerRef.current = setInterval(() => { void pollAll(); }, POLL_MS);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [pollAll]);

  return { refresh: pollAll };
}
