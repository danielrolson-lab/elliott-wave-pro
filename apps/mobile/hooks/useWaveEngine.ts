/**
 * useWaveEngine.ts
 *
 * On each new candle (close event), slices the last 200 bars, runs the full
 * wave-engine pipeline, and writes the top-2 scored WaveCounts to the Zustand
 * waveCount store.
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

// ── RSI (14-period, simple) ───────────────────────────────────────────────────

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

// ── Hook ─────────────────────────────────────────────────────────────────────

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
  // Track last processed length so we only re-run on new candle close
  const prevLen = useRef(0);

  useEffect(() => {
    if (candles.length < 20) return;
    // Same candle count → no new close event, skip
    if (candles.length === prevLen.current) return;
    prevLen.current = candles.length;

    const sliceOffset = Math.max(0, candles.length - MAX_CANDLES);
    const slice = candles.slice(sliceOffset) as OHLCV[];

    // Step 1: detect pivots
    const pivots = detectPivots(slice);
    if (pivots.length < 6) return;

    // Step 2: generate all valid wave counts
    const counts = generateWaveCounts(pivots, ticker, timeframe);
    if (counts.length === 0) return;

    // Step 3: compute RSI + MACD for scoring
    const closes = slice.map((c) => c.close);
    const rsi  = computeRSI14(closes);
    const macd = computeMACDHistogram(closes);

    // Step 4: score and take top 2
    const scored = scoreWaveCounts(counts, slice, rsi, macd);
    const top2   = scored.slice(0, 2);

    const next: UseWaveEngineResult = { waveCounts: top2, sliceOffset };
    setResult(next);
    setCounts(`${ticker}_${timeframe}`, top2);
  }, [candles, ticker, timeframe, setCounts]);

  return result;
}
