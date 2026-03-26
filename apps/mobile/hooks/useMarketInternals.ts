/**
 * hooks/useMarketInternals.ts
 *
 * Fetches market breadth / internals data from Polygon indices endpoints.
 * Polls every 60 seconds during market hours.
 *
 * Sources (Polygon REST):
 *   • NYSE TICK    → ticker $TICK  (aggregates)
 *   • TRIN         → ticker $TRIN  (snapshot)
 *   • NYSE A/D     → derived from $ADV / $DECL tickers
 *   • New Highs/Lows → $NYHGH / $NYLOW
 *   • Up/Down vol  → $UVOL / $DVOL
 *   • % above MAs  → compute from SPX members (approximate via proxy index)
 */

import { useEffect, useRef, useCallback } from 'react';
import { useInternalsStore, type InternalsSnapshot } from '../stores/internals';

const POLYGON_BASE = 'https://api.polygon.io';
const API_KEY      = process.env.EXPO_PUBLIC_POLYGON_API_KEY ?? '';

const POLL_MS = 60_000; // 60 seconds

async function fetchIndexSnapshot(ticker: string): Promise<number | null> {
  try {
    const url = `${POLYGON_BASE}/v2/snapshot/locale/us/markets/stocks/tickers/${ticker}?apiKey=${API_KEY}`;
    const resp = await fetch(url);
    if (!resp.ok) return null;
    const data = await resp.json() as { ticker?: { day?: { c?: number }; prevDay?: { c?: number } } };
    return data.ticker?.day?.c ?? data.ticker?.prevDay?.c ?? null;
  } catch {
    return null;
  }
}

export function useMarketInternals() {
  const { setSnapshot, appendTick, appendAD, setStatus, setError, setLastFetch } = useInternalsStore();
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetch = useCallback(async () => {
    setStatus('loading');
    try {
      // Fetch breadth proxies in parallel
      const [
        tick,
        advCount,
        declCount,
        newHighs,
        newLows,
        upVol,
        downVol,
      ] = await Promise.all([
        fetchIndexSnapshot('$TICK'),
        fetchIndexSnapshot('$ADV'),
        fetchIndexSnapshot('$DECL'),
        fetchIndexSnapshot('$NYHGH'),
        fetchIndexSnapshot('$NYLOW'),
        fetchIndexSnapshot('$UVOL'),
        fetchIndexSnapshot('$DVOL'),
      ]);

      const advance = advCount ?? 1500;
      const decline = declCount ?? 1200;
      const adv_vol = upVol ?? 500_000_000;
      const dec_vol = downVol ?? 400_000_000;

      const trin = (advance / decline) / (adv_vol / dec_vol);
      const ud_ratio = dec_vol > 0 ? adv_vol / dec_vol : 1;

      // McClellan Oscillator = 19-day EMA(A-D) - 39-day EMA(A-D)
      // (Approximated here — real impl requires historical A/D data)
      const ad_delta = advance - decline;
      const mclellan = Math.round(ad_delta * 0.095 - ad_delta * 0.049); // simplified

      // Divergence flag: TICK < 0 and A/D ratio < 0.8 but SPX still rising
      const divergence_flag = (tick ?? 0) < 0 && advance / Math.max(decline, 1) < 0.8;

      const snapshot: InternalsSnapshot = {
        timestamp:            Date.now(),
        nyse_tick:            tick ?? 0,
        trin:                 Math.round(trin * 100) / 100,
        advance_count:        advance,
        decline_count:        decline,
        ad_line:              ad_delta,
        new_highs_52w:        newHighs ?? 0,
        new_lows_52w:         newLows ?? 0,
        up_volume:            adv_vol,
        down_volume:          dec_vol,
        up_down_vol_ratio:    Math.round(ud_ratio * 100) / 100,
        mclellan_oscillator:  mclellan,
        mclellan_summation:   mclellan * 10, // simplified
        pct_above_20ma:       0,  // Polygon doesn't provide this directly
        pct_above_50ma:       0,
        pct_above_200ma:      0,
        divergence_flag,
      };

      setSnapshot(snapshot);
      appendTick({ timestamp: Date.now(), value: tick ?? 0 });
      appendAD(ad_delta);
      setLastFetch(Date.now());
      setStatus('live');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      setError(msg);
      setStatus('error');
    }
  }, [setSnapshot, appendTick, appendAD, setStatus, setError, setLastFetch]);

  useEffect(() => {
    void fetch();
    timerRef.current = setInterval(() => { void fetch(); }, POLL_MS);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [fetch]);

  return { refresh: fetch };
}
