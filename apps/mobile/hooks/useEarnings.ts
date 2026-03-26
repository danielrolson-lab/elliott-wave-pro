/**
 * hooks/useEarnings.ts
 *
 * Fetches earnings dates from Polygon and computes earnings analysis.
 * Polygon endpoint: /vX/reference/financials (earnings history) and
 *                   /v1/meta/symbols/{ticker}/company (earnings date field).
 */

import { useCallback } from 'react';
import { useEarningsStore }  from '../stores/earnings';
import { useOptionsStore }   from '../stores/options';
import { useWaveCountStore } from '../stores/waveCount';
import {
  selectStrategy,
  estimateIVCrush,
  daysToEarnings,
  type EarningsEvent,
  type HistoricalEarningsMove,
  type EarningsAnalysis,
} from '../utils/earningsEngine';

const POLYGON_BASE = 'https://api.polygon.io';
const API_KEY      = process.env.EXPO_PUBLIC_POLYGON_API_KEY ?? '';

async function fetchEarningsCalendar(ticker: string): Promise<EarningsEvent | null> {
  // Polygon /vX/reference/financials gives historical earnings
  const url = `${POLYGON_BASE}/vX/reference/financials?ticker=${ticker}&timeframe=quarterly&order=desc&limit=1&apiKey=${API_KEY}`;
  try {
    const resp = await fetch(url);
    if (!resp.ok) return null;
    const data = await resp.json() as { results?: Array<Record<string, unknown>> };
    const result = data.results?.[0];
    if (!result) return null;
    return {
      ticker,
      report_date:      String(result.end_date ?? ''),
      report_time:      'after_close',
      eps_estimate:     null,
      eps_actual:       null,
      revenue_estimate: null,
      revenue_actual:   null,
      surprise_pct:     null,
    };
  } catch { return null; }
}

async function fetchHistoricalPrices(ticker: string, limit: number = 500): Promise<Array<{ t: number; c: number }>> {
  const url = `${POLYGON_BASE}/v2/aggs/ticker/${ticker}/range/1/day/2020-01-01/2099-01-01?adjusted=true&sort=asc&limit=${limit}&apiKey=${API_KEY}`;
  try {
    const resp = await fetch(url);
    if (!resp.ok) return [];
    const data = await resp.json() as { results?: Array<{ t: number; c: number }> };
    return data.results ?? [];
  } catch { return []; }
}

async function fetchHistoricalEarningsDates(ticker: string): Promise<string[]> {
  const url = `${POLYGON_BASE}/vX/reference/financials?ticker=${ticker}&timeframe=quarterly&order=desc&limit=12&apiKey=${API_KEY}`;
  try {
    const resp = await fetch(url);
    if (!resp.ok) return [];
    const data = await resp.json() as { results?: Array<{ end_date?: string }> };
    return (data.results ?? []).map((r) => String(r.end_date ?? '')).filter(Boolean);
  } catch { return []; }
}

export function useEarnings(ticker: string) {
  const { setAnalysis, setStatus, setError } = useEarningsStore();
  const ivRank     = useOptionsStore((s) => s.ivRank[ticker] ?? 0);
  const waveCounts = useWaveCountStore((s) => s.counts[`${ticker}_5m`] ?? []);

  const fetch = useCallback(async () => {
    setStatus(ticker, 'loading');
    try {
      const [nextEvent, historicalDates, prices] = await Promise.all([
        fetchEarningsCalendar(ticker),
        fetchHistoricalEarningsDates(ticker),
        fetchHistoricalPrices(ticker),
      ]);

      // Compute historical moves around each earnings date
      const historicalMoves: HistoricalEarningsMove[] = [];
      for (const dateStr of historicalDates) {
        const dateMs    = new Date(dateStr).getTime();
        const beforeIdx = prices.findIndex((p) => p.t >= dateMs) - 1;
        const afterIdx  = prices.findIndex((p) => p.t > dateMs);
        if (beforeIdx < 0 || afterIdx < 0 || afterIdx >= prices.length) continue;
        const beforeBar = prices[beforeIdx];
        const afterBar  = prices[afterIdx];
        const movePct = (afterBar.c - beforeBar.c) / beforeBar.c * 100;
        historicalMoves.push({
          date:         dateStr,
          price_before: beforeBar.c,
          price_after:  afterBar.c,
          move_pct:     Math.abs(movePct),
          direction:    afterBar.c >= beforeBar.c ? 'up' : 'down',
        });
      }

      const avgMove = historicalMoves.length
        ? historicalMoves.reduce((s, m) => s + m.move_pct, 0) / historicalMoves.length
        : 0;

      // Implied move from IV rank (proxy: higher IV rank = more premium)
      const impliedMovePct = ivRank > 0 ? avgMove * (1 + (ivRank - 50) / 100) : null;
      const ivVsHist       = impliedMovePct && avgMove > 0 ? impliedMovePct / avgMove : null;

      const topWave       = waveCounts[0];
      const waveLabel     = String(topWave?.currentWave?.label ?? '');
      const waveStructure = topWave?.currentWave?.structure ?? null;

      const { strategy, rationale } = selectStrategy({
        iv_rank:       ivRank,
        iv_vs_hist:    ivVsHist,
        wave_label:    waveLabel || null,
        wave_structure: waveStructure,
      });

      const ivCrush = estimateIVCrush({
        current_iv:    ivRank / 100,
        historical_iv: historicalMoves.map(() => Math.max(0, ivRank / 100 - 0.15)),
      });

      const analysis: EarningsAnalysis = {
        ticker,
        next_event:              nextEvent,
        days_to_earnings:        daysToEarnings(nextEvent?.report_date),
        implied_move_pct:        impliedMovePct ? Math.round(impliedMovePct * 10) / 10 : null,
        historical_moves:        historicalMoves,
        avg_historical_move:     Math.round(avgMove * 10) / 10,
        implied_vs_hist_ratio:   ivVsHist ? Math.round(ivVsHist * 100) / 100 : null,
        iv_rank:                 ivRank,
        iv_crush_estimate:       ivCrush,
        suggested_strategy:      strategy,
        strategy_rationale:      rationale,
      };

      setAnalysis(ticker, analysis);
      setStatus(ticker, 'success');
    } catch (err) {
      setError(ticker, err instanceof Error ? err.message : 'Unknown error');
      setStatus(ticker, 'error');
    }
  }, [ticker, ivRank, waveCounts, setAnalysis, setStatus, setError]);

  return { fetch };
}
