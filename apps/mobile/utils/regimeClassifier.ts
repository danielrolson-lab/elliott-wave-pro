/**
 * regimeClassifier.ts
 *
 * Rules-based market regime classification into 6 regimes.
 * Pure function — no side effects, fully testable.
 *
 * Algorithm (in priority order):
 *
 *  1. Compute EMAs (9, 21, 50, 200) and ATR-14 from recent candles.
 *  2. Compute ATR ratio: current ATR vs 20-bar rolling average ATR.
 *  3. Use near-term ATM IV (from options store) as a VIX proxy when available.
 *
 *  Regime rules (checked in order — first match wins):
 *
 *  HIGH_VOL_CHOP        atrRatio > 1.5  AND  EMAs not aligned (mixed direction)
 *  LOW_VOL_COMPRESSION  atrRatio < 0.6  AND  EMAs within 0.8% of each other
 *  STRONG_TREND_UP      EMA9 > EMA21 > EMA50 AND atrRatio > 0.9 AND bullScore ≥ 3
 *  WEAK_TREND_UP        EMA9 > EMA50 (but not full alignment or atrRatio low)
 *  STRONG_TREND_DOWN    EMA9 < EMA21 < EMA50 AND atrRatio > 0.9 AND bearScore ≥ 3
 *  WEAK_TREND_DOWN      EMA9 < EMA50 (default bear case)
 */

import type { OHLCV } from '@elliott-wave-pro/wave-engine';
import type { MarketRegime } from '@elliott-wave-pro/wave-engine';

// ── EMA ───────────────────────────────────────────────────────────────────────

function ema(closes: readonly number[], period: number): number {
  if (closes.length === 0) return 0;
  const k = 2 / (period + 1);
  let e = closes[0];
  for (let i = 1; i < closes.length; i++) e = closes[i] * k + e * (1 - k);
  return e;
}

// ── ATR-14 (Wilder) ───────────────────────────────────────────────────────────

function atr14(candles: readonly OHLCV[]): number {
  if (candles.length < 2) return 0;
  let sum = 0;
  const period = Math.min(14, candles.length - 1);
  const start = candles.length - period;
  for (let i = start; i < candles.length; i++) {
    const prev = candles[i - 1].close;
    const c    = candles[i];
    const tr   = Math.max(c.high - c.low, Math.abs(c.high - prev), Math.abs(c.low - prev));
    sum += tr;
  }
  return sum / period;
}

/** Rolling average ATR over the last `window` bars (each ATR computed on 14-bar window). */
function rollingAtrAvg(candles: readonly OHLCV[], window = 20): number {
  if (candles.length < 16) return atr14(candles) || 1;
  const n = Math.min(window, candles.length - 14);
  let sum = 0;
  for (let i = 0; i < n; i++) {
    sum += atr14(candles.slice(0, candles.length - i));
  }
  return sum / n;
}

// ── Bull / bear score ─────────────────────────────────────────────────────────

/** Counts bull signals from last 5 candles: close > open, high > prev high, close > prev close. */
function bullBearScore(candles: readonly OHLCV[]): { bull: number; bear: number } {
  const tail = candles.slice(-6);
  let bull = 0;
  let bear = 0;
  for (let i = 1; i < tail.length; i++) {
    if (tail[i].close > tail[i].open)     bull++;
    else                                   bear++;
    if (tail[i].high > tail[i - 1].high)  bull++;
    else                                   bear++;
    if (tail[i].close > tail[i - 1].close) bull++;
    else                                    bear++;
  }
  return { bull, bear };
}

// ── Classifier ────────────────────────────────────────────────────────────────

export interface RegimeInput {
  candles:   readonly OHLCV[];
  /** Near-term ATM IV (0–1 scale) from options store. 0 = unavailable. */
  atmIV?:    number;
}

export function classifyRegime(input: RegimeInput): MarketRegime {
  const { candles, atmIV = 0 } = input;

  if (candles.length < 21) return 'LOW_VOL_COMPRESSION';

  const closes = candles.map((c) => c.close);

  const e9   = ema(closes, 9);
  const e21  = ema(closes, 21);
  const e50  = ema(closes.length >= 50 ? closes : closes, 50);
  const e200 = ema(closes.length >= 200 ? closes : closes, 200);

  const curATR  = atr14(candles);
  const avgATR  = rollingAtrAvg(candles);
  const atrRatio = avgATR > 0 ? curATR / avgATR : 1;

  // VIX proxy: SPY near-term ATM IV × 100 ≈ VIX.  If not available, use ATR ratio.
  const ivHighVol = atmIV > 0.25;   // ~VIX 25
  const ivLowVol  = atmIV > 0 && atmIV < 0.15;  // ~VIX 15

  const { bull, bear } = bullBearScore(candles);

  // EMA spread as % of price — tight spread = compression
  const spread50 = Math.abs(e9 - e50) / e50;

  // ── Rule priority ──────────────────────────────────────────────────────────

  // 1. High-vol chop: large ATR OR high IV AND EMAs not cleanly aligned
  const emasConflict = !(e9 > e21 && e21 > e50) && !(e9 < e21 && e21 < e50);
  if ((atrRatio > 1.5 || ivHighVol) && emasConflict) return 'HIGH_VOL_CHOP';

  // 2. Low-vol compression: tight range AND EMAs nearly flat
  if ((atrRatio < 0.6 || ivLowVol) && spread50 < 0.008) return 'LOW_VOL_COMPRESSION';

  // 3. Strong trend up: full EMA stack aligned + expanding ATR + bull candle score
  if (e9 > e21 && e21 > e50 && (candles.length < 200 || e50 > e200) && atrRatio >= 0.9 && bull >= 8) {
    return 'STRONG_TREND_UP';
  }

  // 4. Weak trend up: EMA9 above EMA50 at minimum
  if (e9 > e50) return 'WEAK_TREND_UP';

  // 5. Strong trend down: full EMA stack declining + expanding ATR + bear score
  if (e9 < e21 && e21 < e50 && (candles.length < 200 || e50 < e200) && atrRatio >= 0.9 && bear >= 8) {
    return 'STRONG_TREND_DOWN';
  }

  // 6. Weak trend down (default for EMA9 below EMA50)
  return 'WEAK_TREND_DOWN';
}

// ── Display metadata ──────────────────────────────────────────────────────────

export interface RegimeMeta {
  label:       string;
  shortLabel:  string;
  color:       string;
  description: string;
}

export const REGIME_META: Readonly<Record<MarketRegime, RegimeMeta>> = {
  STRONG_TREND_UP: {
    label:       'Strong Trend Up',
    shortLabel:  'STU',
    color:       '#22c55e',
    description: 'EMAs stacked bullish, ATR expanding. Momentum favours longs.',
  },
  WEAK_TREND_UP: {
    label:       'Weak Trend Up',
    shortLabel:  'WTU',
    color:       '#86efac',
    description: 'Price above EMA50 but breadth diverging. Distribution risk.',
  },
  STRONG_TREND_DOWN: {
    label:       'Strong Trend Down',
    shortLabel:  'STD',
    color:       '#ef4444',
    description: 'EMAs stacked bearish, ATR expanding. Momentum favours shorts.',
  },
  WEAK_TREND_DOWN: {
    label:       'Weak Trend Down',
    shortLabel:  'WTD',
    color:       '#fca5a5',
    description: 'Price below EMA50 but internals stabilising. Accumulation possible.',
  },
  HIGH_VOL_CHOP: {
    label:       'High-Vol Chop',
    shortLabel:  'HVC',
    color:       '#f59e0b',
    description: 'Elevated ATR with no directional conviction. Fade extremes.',
  },
  LOW_VOL_COMPRESSION: {
    label:       'Low-Vol Compression',
    shortLabel:  'LVC',
    color:       '#a78bfa',
    description: 'Tight range, coiling. Breakout imminent — size accordingly.',
  },
};
