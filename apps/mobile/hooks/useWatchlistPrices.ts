/**
 * useWatchlistPrices.ts
 *
 * Fetches price data for every watchlist ticker via Polygon REST.
 *
 * Two fetches per ticker (Polygon Stocks Starter plan compatible):
 *   1. /prev — previous trading day's bar (for prev close baseline + sparkline)
 *   2. /range/5/minute/{today}/{today} — today's 5m bars (15-min delayed)
 *
 * Populates:
 *   - watchlist.lastPrice / .changePercent  (today's delayed price vs prev close)
 *   - marketData.candles[`${ticker}_1D`]    (daily history for sparklines)
 *   - marketData.candles[`${ticker}_intraday`] (today's 5m bars; isolated from chart's 5m key)
 *
 * Refresh schedule:
 *   - Full fetch (prev + sparkline + intraday): on mount and when tickers change
 *   - Intraday-only refresh: every 2 minutes (keeps price and delay indicator current)
 */

import { useEffect, useRef } from 'react';
import type { OHLCV } from '@elliott-wave-pro/wave-engine';
import { useWatchlistStore } from '../stores/watchlist';
import { useMarketDataStore } from '../stores/marketData';

const POLYGON_API_KEY = process.env['EXPO_PUBLIC_POLYGON_API_KEY'] ?? '';
const INTRADAY_REFRESH_MS = 2 * 60 * 1000; // 2 minutes

// ET date string: use NY timezone so we request the correct trading day
function todayETDateString(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
}

// ── Intraday fetch (today's 5m bars, 15-min delayed) ──────────────────────────

async function fetchIntraday(ticker: string): Promise<OHLCV[]> {
  try {
    const today = todayETDateString();
    const url =
      `https://api.polygon.io/v2/aggs/ticker/${ticker}/range/5/minute/${today}/${today}` +
      `?adjusted=true&sort=asc&limit=200&apiKey=${POLYGON_API_KEY}`;
    const res = await fetch(url);
    if (!res.ok) return [];
    const json = await res.json() as {
      results?: Array<{ o: number; h: number; l: number; c: number; v: number; t: number }>;
    };
    return (json.results ?? []).map((r) => ({
      open: r.o, high: r.h, low: r.l, close: r.c, volume: r.v, timestamp: r.t,
    }));
  } catch {
    return [];
  }
}

// ── Full fetch: prev close + sparkline + intraday ────────────────────────────

async function fetchPrevDay(ticker: string): Promise<{
  prevClose: number;
  sparkCandles: OHLCV[];
  intradayCandles: OHLCV[];
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

    const prevClose = bar.c;

    // Fetch 30 daily bars for sparkline (run in parallel with intraday)
    const toDate   = new Date(bar.t);
    const fromDate = new Date(bar.t);
    fromDate.setDate(fromDate.getDate() - 40);
    const fmt = (d: Date) => d.toISOString().slice(0, 10);
    const sparkUrl =
      `https://api.polygon.io/v2/aggs/ticker/${ticker}/range/1/day/${fmt(fromDate)}/${fmt(toDate)}` +
      `?adjusted=true&limit=40&apiKey=${POLYGON_API_KEY}`;

    const [sparkRes, intradayCandles] = await Promise.all([
      fetch(sparkUrl),
      fetchIntraday(ticker),
    ]);

    let sparkCandles: OHLCV[] = [];
    if (sparkRes.ok) {
      const sparkJson = await sparkRes.json() as {
        results?: Array<{ o: number; h: number; l: number; c: number; v: number; t: number }>;
      };
      sparkCandles = (sparkJson.results ?? []).map((r) => ({
        open: r.o, high: r.h, low: r.l, close: r.c, volume: r.v, timestamp: r.t,
      }));
    }

    return { prevClose, sparkCandles, intradayCandles };
  } catch (e) {
    console.warn(`[watchlistPrices] ${ticker} error:`, String(e));
    return null;
  }
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useWatchlistPrices(): void {
  const items              = useWatchlistStore((s) => s.items);
  const updateSnapshot     = useWatchlistStore((s) => s.updateItemSnapshot);
  const setLastIntradayAt  = useWatchlistStore((s) => s.setLastIntradayAt);
  const upsertCandles      = useMarketDataStore((s) => s.upsertCandles);

  const tickerKey = items.map((i) => i.id).sort().join(',');

  // Stable ref to actions so the interval closure doesn't go stale
  const actionsRef = useRef({ updateSnapshot, upsertCandles, setLastIntradayAt });
  actionsRef.current = { updateSnapshot, upsertCandles, setLastIntradayAt };

  // Helper: write intraday candles and update snapshot price.
  // Writes to `${ticker}_intraday` — isolated from the chart's `${ticker}_5m` key
  // so usePolygonCandles (5-day backfill) never overwrites the delay indicator.
  function applyIntradayUpdate(ticker: string, candles: OHLCV[], prevClose: number) {
    if (candles.length === 0) return;
    actionsRef.current.upsertCandles(`${ticker}_intraday`, candles);
    const lastPrice     = candles[candles.length - 1]!.close;
    const changePercent = ((lastPrice - prevClose) / prevClose) * 100;
    actionsRef.current.updateSnapshot(ticker, { lastPrice, changePercent });
    // Stamp the fetch time so DataDelayFooter can compute accurate delay
    // without depending on candle timestamps (which can be stale from chart backfill).
    actionsRef.current.setLastIntradayAt(Date.now());
  }

  // ── Full fetch on mount / ticker list change ─────────────────────────────
  useEffect(() => {
    if (!tickerKey) return;
    const tickers = tickerKey.split(',');
    tickers.forEach((ticker, i) => {
      setTimeout(async () => {
        const result = await fetchPrevDay(ticker);
        if (!result) return;
        if (result.sparkCandles.length > 0) {
          actionsRef.current.upsertCandles(`${ticker}_1D`, result.sparkCandles);
        }
        applyIntradayUpdate(ticker, result.intradayCandles, result.prevClose);
        console.log(
          `[watchlistPrices] ${ticker}: prev=$${result.prevClose.toFixed(2)} ` +
          `intraday=${result.intradayCandles.length} spark=${result.sparkCandles.length}`,
        );
      }, i * 150);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tickerKey]);

  // ── Intraday refresh every 2 minutes ─────────────────────────────────────
  useEffect(() => {
    if (!tickerKey) return;

    const refresh = () => {
      const tickers = tickerKey.split(',');
      tickers.forEach((ticker, i) => {
        setTimeout(async () => {
          // Get prevClose from stored daily candles (last daily bar = prev close)
          const daily = useMarketDataStore.getState().candles[`${ticker}_1D`] ?? [];
          const prevClose = daily[daily.length - 1]?.close;
          if (!prevClose) return; // daily data not loaded yet; full fetch will handle it

          const candles = await fetchIntraday(ticker);
          applyIntradayUpdate(ticker, candles, prevClose);
        }, i * 100); // tighter stagger for refresh (read-only, lighter)
      });
    };

    const id = setInterval(refresh, INTRADAY_REFRESH_MS);
    return () => clearInterval(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tickerKey]);
}
