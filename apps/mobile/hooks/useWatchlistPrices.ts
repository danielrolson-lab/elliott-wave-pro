/**
 * useWatchlistPrices.ts
 *
 * Fetches previous-day OHLCV for every watchlist ticker via Polygon /prev
 * (works on Starter plan, unlike /snapshot which requires a higher tier).
 *
 * Populates:
 *   - watchlist.lastPrice / .changePercent  (displayed in tiles)
 *   - marketData.candles[`${ticker}_1D`]    (used for sparklines)
 *
 * Runs once on mount and again whenever the set of watchlist tickers changes.
 * Fetches are staggered 150 ms apart to avoid rate-limit bursts.
 */

import { useEffect } from 'react';
import type { OHLCV } from '@elliott-wave-pro/wave-engine';
import { useWatchlistStore } from '../stores/watchlist';
import { useMarketDataStore } from '../stores/marketData';

const POLYGON_API_KEY = process.env['EXPO_PUBLIC_POLYGON_API_KEY'] ?? '';

async function fetchPrevDay(ticker: string): Promise<{
  lastPrice: number;
  changePercent: number;
  sparkCandles: OHLCV[];
} | null> {
  try {
    const prevUrl = `https://api.polygon.io/v2/aggs/ticker/${ticker}/prev?adjusted=true&apiKey=${POLYGON_API_KEY}`;
    const prevRes = await fetch(prevUrl);
    if (!prevRes.ok) {
      console.warn(`[watchlistPrices] ${ticker} /prev ${prevRes.status}`);
      return null;
    }
    const prevJson = await prevRes.json() as {
      results?: Array<{ c: number; o: number; h: number; l: number; v: number; t: number }>;
    };
    const bar = prevJson.results?.[0];
    if (!bar) return null;

    const lastPrice     = bar.c;
    const changePercent = ((bar.c - bar.o) / bar.o) * 100;

    // Fetch 30 daily bars for sparkline
    const toDate   = new Date(bar.t);
    const fromDate = new Date(bar.t);
    fromDate.setDate(fromDate.getDate() - 40);
    const fmt = (d: Date) => d.toISOString().slice(0, 10);
    const sparkUrl =
      `https://api.polygon.io/v2/aggs/ticker/${ticker}/range/1/day/${fmt(fromDate)}/${fmt(toDate)}` +
      `?adjusted=true&limit=40&apiKey=${POLYGON_API_KEY}`;

    const sparkRes = await fetch(sparkUrl);
    let sparkCandles: OHLCV[] = [];
    if (sparkRes.ok) {
      const sparkJson = await sparkRes.json() as {
        results?: Array<{ o: number; h: number; l: number; c: number; v: number; t: number }>;
      };
      sparkCandles = (sparkJson.results ?? []).map((r) => ({
        open: r.o, high: r.h, low: r.l, close: r.c, volume: r.v, timestamp: r.t,
      }));
    }

    console.log(
      `[watchlistPrices] ${ticker}: $${lastPrice.toFixed(2)} ` +
      `${changePercent >= 0 ? '+' : ''}${changePercent.toFixed(2)}% spark=${sparkCandles.length}`,
    );
    return { lastPrice, changePercent, sparkCandles };
  } catch (e) {
    console.warn(`[watchlistPrices] ${ticker} error:`, String(e));
    return null;
  }
}

export function useWatchlistPrices(): void {
  const items            = useWatchlistStore((s) => s.items);
  const updateSnapshot   = useWatchlistStore((s) => s.updateItemSnapshot);
  const upsertCandles    = useMarketDataStore((s) => s.upsertCandles);

  // Key on the sorted ticker list so we only re-fetch when tickers change
  const tickerKey = items.map((i) => i.id).sort().join(',');

  useEffect(() => {
    if (!tickerKey) return;
    const tickers = tickerKey.split(',');
    tickers.forEach((ticker, i) => {
      setTimeout(async () => {
        const result = await fetchPrevDay(ticker);
        if (!result) return;
        updateSnapshot(ticker, {
          lastPrice:     result.lastPrice,
          changePercent: result.changePercent,
        });
        if (result.sparkCandles.length > 0) {
          upsertCandles(`${ticker}_1D`, result.sparkCandles);
        }
      }, i * 150);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tickerKey]);
}
