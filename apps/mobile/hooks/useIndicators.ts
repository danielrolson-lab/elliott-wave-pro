/**
 * hooks/useIndicators.ts
 *
 * Computes RSI-14, MACD (12/26/9), and Volume MA-20 series from OHLCV data
 * and writes the results to the Zustand indicator store.
 *
 * Run this hook once per chart mount, alongside useWaveEngine.
 * Components read the pre-computed series from the store — they do no math.
 */

import { useEffect, useRef } from 'react';
import type { OHLCV } from '@elliott-wave-pro/wave-engine';
import { useIndicatorStore } from '../stores/indicators';
import type {
  MACDSeries,
  VolumeSeries,
  DivergencePoint,
  CrossoverPoint,
} from '../stores/indicators';

// ── RSI 14 (Wilder's smoothing) ───────────────────────────────────────────────

function computeRSISeries(closes: readonly number[]): number[] {
  const n = closes.length;
  const out = new Array<number>(n).fill(50);
  if (n < 15) return out;

  // Seed: simple average of first 14 changes
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 1; i <= 14; i++) {
    const d = closes[i] - closes[i - 1];
    if (d > 0) avgGain += d;
    else avgLoss -= d;
  }
  avgGain /= 14;
  avgLoss /= 14;
  out[14] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);

  // Wilder's smoothing for remaining bars
  for (let i = 15; i < n; i++) {
    const d = closes[i] - closes[i - 1];
    const gain = d > 0 ? d : 0;
    const loss = d < 0 ? -d : 0;
    avgGain = (avgGain * 13 + gain) / 14;
    avgLoss = (avgLoss * 13 + loss) / 14;
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return out;
}

/** Classic RSI divergence: price HH + RSI LH (bearish) or price LL + RSI HL (bullish). */
function detectDivergences(
  closes: readonly number[],
  rsi: readonly number[],
): DivergencePoint[] {
  const n = closes.length;
  const W = 4; // half-window for local extrema
  const result: DivergencePoint[] = [];

  const highs: Array<{ idx: number; price: number; rsi: number }> = [];
  const lows:  Array<{ idx: number; price: number; rsi: number }> = [];

  for (let i = W; i < n - W; i++) {
    let isHigh = true;
    let isLow  = true;
    for (let k = 1; k <= W; k++) {
      if (closes[i] <= closes[i - k] || closes[i] <= closes[i + k]) isHigh = false;
      if (closes[i] >= closes[i - k] || closes[i] >= closes[i + k]) isLow  = false;
    }
    if (isHigh) highs.push({ idx: i, price: closes[i], rsi: rsi[i] });
    if (isLow)  lows.push({ idx: i, price: closes[i], rsi: rsi[i] });
  }

  // Consecutive highs: price HH + RSI LH → bearish divergence
  for (let i = 1; i < highs.length; i++) {
    if (highs[i].price > highs[i - 1].price && highs[i].rsi < highs[i - 1].rsi) {
      result.push({ barIdx: highs[i].idx, type: 'bearish' });
    }
  }
  // Consecutive lows: price LL + RSI HL → bullish divergence
  for (let i = 1; i < lows.length; i++) {
    if (lows[i].price < lows[i - 1].price && lows[i].rsi > lows[i - 1].rsi) {
      result.push({ barIdx: lows[i].idx, type: 'bullish' });
    }
  }
  return result;
}

// ── MACD 12/26/9 ─────────────────────────────────────────────────────────────

function computeEMASeries(values: readonly number[], period: number): number[] {
  const k = 2 / (period + 1);
  const out = new Array<number>(values.length);
  out[0] = values[0];
  for (let i = 1; i < values.length; i++) {
    out[i] = values[i] * k + out[i - 1] * (1 - k);
  }
  return out;
}

function computeMACDSeries(closes: readonly number[]): MACDSeries {
  const ema12    = computeEMASeries(closes, 12);
  const ema26    = computeEMASeries(closes, 26);
  const macdLine = ema12.map((v, i) => v - ema26[i]);
  const signalLine = computeEMASeries(macdLine, 9);
  const histogram  = macdLine.map((v, i) => v - signalLine[i]);

  const crossovers: CrossoverPoint[] = [];
  for (let i = 1; i < histogram.length; i++) {
    if (histogram[i - 1] < 0 && histogram[i] >= 0) {
      crossovers.push({ barIdx: i, type: 'bullish' });
    } else if (histogram[i - 1] >= 0 && histogram[i] < 0) {
      crossovers.push({ barIdx: i, type: 'bearish' });
    }
  }
  return { macdLine, signalLine, histogram, crossovers };
}

// ── Volume MA-20 ──────────────────────────────────────────────────────────────

function computeVolumeSeries(candles: readonly OHLCV[]): VolumeSeries {
  const volumes = candles.map((c) => c.volume);
  const ma20    = new Array<number>(volumes.length).fill(0);
  for (let i = 0; i < volumes.length; i++) {
    const start   = Math.max(0, i - 19);
    const slice   = volumes.slice(start, i + 1);
    ma20[i] = slice.reduce((a, b) => a + b, 0) / slice.length;
  }
  return { volumes, ma20 };
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useIndicators(
  ticker:    string,
  timeframe: string,
  candles:   readonly OHLCV[],
): void {
  const { setRSI, setMACD, setVolume } = useIndicatorStore.getState();
  const prevLen = useRef(0);

  useEffect(() => {
    if (candles.length < 15) return;
    if (candles.length === prevLen.current) return;
    prevLen.current = candles.length;

    const key    = `${ticker}_${timeframe}`;
    const closes = candles.map((c) => c.close);

    const rsiValues   = computeRSISeries(closes);
    const divergences = detectDivergences(closes, rsiValues);

    setRSI(key,    { values: rsiValues, divergences });
    setMACD(key,   computeMACDSeries(closes));
    setVolume(key, computeVolumeSeries(candles));
  }, [candles, ticker, timeframe, setRSI, setMACD, setVolume]);
}
