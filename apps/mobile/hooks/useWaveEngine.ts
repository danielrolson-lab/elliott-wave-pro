/**
 * useWaveEngine.ts  (v2 — incremental Bayesian + MTF alignment)
 *
 * On each new candle close, slices the last 200 bars, runs the full
 * wave-engine pipeline, and writes the top-2 scored WaveCounts to the Zustand
 * waveCount store.
 *
 * v2 upgrades:
 *   - Passes existing posteriors from the store so the probability engine can
 *     apply incremental Bayesian updates (prior = decayed previous posterior).
 *   - Computes multi-timeframe alignment scores by checking whether the top
 *     wave count on each higher timeframe agrees in direction with each
 *     candidate count on the current timeframe.
 *
 * Returns the counts and the slice offset so the chart overlay can convert
 * pivot bar indices to absolute indices in the full candle array.
 */

import { useEffect, useRef, useState } from 'react';
import {
  detectPivots,
  generateWaveCounts,
  scoreWaveCounts,
} from '@elliott-wave-pro/wave-engine';
import type { OHLCV, WaveCount } from '@elliott-wave-pro/wave-engine';
import { useWaveCountStore } from '../stores/waveCount';

const MAX_CANDLES = 200;
const EMPTY: WaveCount[] = [];

// ── RSI (14-period, Wilder) ───────────────────────────────────────────────────

function computeRSI14(closes: readonly number[]): number {
  const n = closes.length;
  if (n < 15) return 50;
  let gains = 0;
  let losses = 0;
  for (let i = n - 14; i < n; i++) {
    const d = closes[i] - closes[i - 1];
    if (d > 0) gains += d;
    else losses -= d;
  }
  if (losses === 0) return 100;
  return 100 - 100 / (1 + gains / losses);
}

// ── MACD histogram (12/26 EMA diff) ──────────────────────────────────────────

function lastEMA(closes: readonly number[], period: number): number {
  if (closes.length === 0) return 0;
  const k = 2 / (period + 1);
  let ema = closes[0];
  for (let i = 1; i < closes.length; i++) {
    ema = closes[i] * k + ema * (1 - k);
  }
  return ema;
}

function computeMACDHistogram(closes: readonly number[]): number {
  if (closes.length < 26) return 0;
  return lastEMA(closes, 12) - lastEMA(closes, 26);
}

// ── MTF alignment ─────────────────────────────────────────────────────────────

/**
 * Maps each timeframe to the higher timeframes used for MTF alignment scoring.
 * Per spec: +20 probability bonus when TF and a higher TF agree on direction.
 */
const HIGHER_TFS: Readonly<Record<string, readonly string[]>> = {
  '1m':  ['5m', '15m'],
  '5m':  ['1h', '4h'],
  '15m': ['1h', '4h'],
  '30m': ['1h', '4h'],
  '1h':  ['4h', '1D'],
  '4h':  ['1D'],
  '1D':  ['1W'],
  '1W':  [],
};

function isBullishCount(count: WaveCount): boolean {
  const w1 = count.allWaves.find((w) => w.label === '1');
  if (!w1 || !w1.endPivot) return false;
  return w1.startPivot.price < w1.endPivot.price;
}

/**
 * Returns a score in [0, 1] for how aligned this count's direction is with
 * the top count on each higher timeframe.
 *
 * 0.9 = all higher TFs agree
 * 0.5 = no higher TF data (neutral)
 * 0.2 = all higher TFs conflict
 */
function computeMtfScore(
  ticker: string,
  timeframe: string,
  isBullish: boolean,
  allCounts: Readonly<Record<string, WaveCount[]>>,
): number {
  const higherTfs = HIGHER_TFS[timeframe] ?? [];
  if (higherTfs.length === 0) return 0.5;

  let agreeing = 0;
  let conflicting = 0;

  for (const htf of higherTfs) {
    const htfTop = allCounts[`${ticker}_${htf}`]?.[0];
    if (!htfTop) continue;
    if (isBullishCount(htfTop) === isBullish) agreeing++;
    else conflicting++;
  }

  if (agreeing > 0 && conflicting === 0) return 0.9;
  if (conflicting > 0 && agreeing === 0) return 0.2;
  return 0.5; // mixed or no data
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export interface UseWaveEngineResult {
  waveCounts: WaveCount[];
  sliceOffset: number;
}

export function useWaveEngine(
  ticker: string,
  timeframe: string,
  candles: readonly OHLCV[],
): UseWaveEngineResult {
  const setCounts = useWaveCountStore((s) => s.setCounts);
  const [result, setResult] = useState<UseWaveEngineResult>({
    waveCounts: EMPTY,
    sliceOffset: 0,
  });
  const prevLen = useRef(0);

  // BUG-020: reset prevLen and clear stale counts when ticker or timeframe changes
  useEffect(() => {
    prevLen.current = 0;
    setResult({ waveCounts: EMPTY, sliceOffset: 0 });
  }, [ticker, timeframe]);

  useEffect(() => {
    if (candles.length < 20) return;
    if (candles.length === prevLen.current) return;

    const candlesSinceUpdate = candles.length - prevLen.current;
    prevLen.current = candles.length;

    const sliceOffset = Math.max(0, candles.length - MAX_CANDLES);
    const slice = candles.slice(sliceOffset) as OHLCV[];

    // Step 1: detect pivots
    const pivots = detectPivots(slice, 0.5, timeframe);
    if (pivots.length < 6) return;

    // Step 2: generate all valid wave counts (impulse + diagonal)
    const counts = generateWaveCounts(pivots, ticker, timeframe);
    if (counts.length === 0) return;

    // Step 3: compute RSI + MACD for scoring
    const closes = slice.map((c) => c.close);
    const rsi  = computeRSI14(closes);
    const macd = computeMACDHistogram(closes);

    // Step 4: gather existing posteriors from store for incremental update
    const storeState = useWaveCountStore.getState();
    const storedCounts = storeState.counts[`${ticker}_${timeframe}`] ?? [];
    const existingPosteriors: Record<string, number> = {};
    for (const c of storedCounts) {
      existingPosteriors[c.id] = c.posterior.posterior;
    }

    // Step 5: compute MTF alignment scores
    const allCounts = storeState.counts;
    const mtfScores: Record<string, number> = {};
    for (const count of counts) {
      const isB = isBullishCount(count);
      mtfScores[count.id] = computeMtfScore(ticker, timeframe, isB, allCounts);
    }

    // Step 6: score with incremental Bayesian update
    const scored = scoreWaveCounts(counts, slice, rsi, macd, {
      existingPosteriors,
      candlesSinceUpdate,
      mtfScores,
    });
    const top4 = scored.slice(0, 4);

    const next: UseWaveEngineResult = { waveCounts: top4, sliceOffset };
    setResult(next);
    setCounts(`${ticker}_${timeframe}`, top4);
  }, [candles, ticker, timeframe, setCounts]);

  return result;
}
