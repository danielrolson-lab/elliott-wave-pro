/**
 * probability-engine.ts
 *
 * Scores each WaveCount across four likelihood components and returns the
 * array sorted by posterior probability (descending).
 *
 * Bayesian update rule (per spec):
 *   posterior = normalize( prior × likelihood )
 *   likelihood = ∏ component_i^weight_i
 *
 * Components (weights sum to 1.0):
 *   fib_confluence    0.35  — current price near key Fibonacci level
 *   volume_profile    0.30  — Wave 3 has the highest average volume
 *   rsi_divergence    0.20  — RSI alignment with current wave position
 *   momentum_alignment 0.15 — MACD histogram sign matches wave direction
 *
 * A small epsilon (0.01) prevents any component from zeroing the product.
 */

import type { WaveCount, OHLCV } from './types';
import { computeFibLevels } from './fibonacci';

// ── Component weights ─────────────────────────────────────────────────────────

const W_FIB  = 0.35;
const W_VOL  = 0.30;
const W_RSI  = 0.20;
const W_MACD = 0.15;
const EPS    = 0.01; // prevents zero-product likelihood

// ── Score: Fibonacci confluence ───────────────────────────────────────────────

/**
 * Returns 0–1 based on how many Fibonacci levels the current candle's
 * close price is touching (within the default 0.3% tolerance).
 */
function scoreFibConfluence(count: WaveCount, candles: OHLCV[]): number {
  if (candles.length === 0) return 0.5;
  const currentPrice = candles[candles.length - 1].close;
  const levels = computeFibLevels(count, currentPrice);
  if (levels.length === 0) return 0.5;

  const hits = levels.filter((l) => l.hit).length;
  // 0 hits → 0.2, 1 hit → 0.6, 2+ hits → 1.0
  return Math.min(0.2 + hits * 0.4, 1.0);
}

// ── Score: Volume profile ─────────────────────────────────────────────────────

/**
 * In a valid impulse, Wave 3 should have the highest average volume.
 * Compares mean volume of the Wave 3 candle range vs Wave 1 and Wave 5.
 * Returns 1.0 if W3 is the loudest, 0.4 otherwise.
 */
function scoreVolumeProfile(count: WaveCount, candles: OHLCV[]): number {
  const w1 = count.allWaves.find((w) => w.label === '1');
  const w3 = count.allWaves.find((w) => w.label === '3');
  const w5 = count.allWaves.find((w) => w.label === '5');

  if (!w1 || !w3 || !w5) return 0.5;

  const sliceVol = (startTs: number, endTs: number): number => {
    const bars = candles.filter(
      (c) => c.timestamp >= startTs && c.timestamp <= endTs,
    );
    if (bars.length === 0) return 0;
    return bars.reduce((s, c) => s + c.volume, 0) / bars.length;
  };

  const tsEnd = (node: typeof w1) =>
    node.endPivot?.timestamp ?? node.startPivot.timestamp;

  const vol1 = sliceVol(w1.startPivot.timestamp, tsEnd(w1));
  const vol3 = sliceVol(w3.startPivot.timestamp, tsEnd(w3));
  const vol5 = sliceVol(w5.startPivot.timestamp, tsEnd(w5));

  const maxVol = Math.max(vol1, vol3, vol5);
  return maxVol > 0 && vol3 >= maxVol - maxVol * 0.05 ? 1.0 : 0.4;
}

// ── Score: RSI divergence ─────────────────────────────────────────────────────

/**
 * RSI should show bearish divergence near Wave 5 tops (lower RSI while price
 * makes higher high) and bullish divergence at Wave 2/4 bottoms.
 *
 * Simplified signal:
 *   - Wave 5 complete (bullish): RSI < 70 = likely divergence → 0.8
 *                                RSI ≥ 70 = no divergence     → 0.3
 *   - Wave 5 complete (bearish): RSI > 30 = likely divergence → 0.8
 *                                RSI ≤ 30 = no divergence     → 0.3
 *   - Other waves: neutral 0.5
 */
function scoreRsiDivergence(count: WaveCount, rsi: number): number {
  const currentLabel = count.currentWave.label;
  if (currentLabel !== '5') return 0.5;

  const isBullish =
    count.currentWave.startPivot.price < (count.currentWave.endPivot?.price ?? 0);

  if (isBullish) {
    return rsi < 70 ? 0.8 : 0.3;
  } else {
    return rsi > 30 ? 0.8 : 0.3;
  }
}

// ── Score: MACD momentum alignment ───────────────────────────────────────────

/**
 * The MACD histogram should be positive (momentum up) during bullish impulse
 * waves and negative during bearish impulse waves.  Returns 0.9 for alignment,
 * 0.2 for opposition, 0.5 for neutral (MACD ≈ 0).
 */
function scoreMacdAlignment(count: WaveCount, macdHistogram: number): number {
  const label = count.currentWave.label;

  // Determine expected direction for the current wave
  const isBullishWave =
    label === '1' || label === '3' || label === '5'
      ? count.currentWave.startPivot.price < (count.currentWave.endPivot?.price ?? Infinity)
      : count.currentWave.startPivot.price > (count.currentWave.endPivot?.price ?? 0);

  const deadband = 0.01; // treat near-zero MACD as neutral
  if (Math.abs(macdHistogram) < deadband) return 0.5;

  const macdBullish = macdHistogram > 0;
  return macdBullish === isBullishWave ? 0.9 : 0.2;
}

// ── Normalization ─────────────────────────────────────────────────────────────

function normalizeProbs(values: number[]): number[] {
  const total = values.reduce((s, v) => s + v, 0);
  if (total === 0) {
    const eq = 1 / values.length;
    return values.map(() => eq);
  }
  return values.map((v) => v / total);
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Score and rank WaveCount objects by Bayesian posterior probability.
 *
 * @param counts  Wave counts from generateWaveCounts
 * @param candles OHLCV array (same series used to detect pivots)
 * @param rsi     Current RSI(14) value (0–100)
 * @param macd    Current MACD histogram value (positive = bullish momentum)
 * @returns       The same counts with updated posteriors, sorted descending
 */
export function scoreWaveCounts(
  counts: WaveCount[],
  candles: OHLCV[],
  rsi: number,
  macd: number,
): WaveCount[] {
  if (counts.length === 0) return [];

  const n = counts.length;
  const equalPrior = 1 / n;

  // Compute unnormalized posteriors
  const unnormalized = counts.map((count) => {
    const fibScore  = scoreFibConfluence(count, candles)   + EPS;
    const volScore  = scoreVolumeProfile(count, candles)   + EPS;
    const rsiScore  = scoreRsiDivergence(count, rsi)       + EPS;
    const macdScore = scoreMacdAlignment(count, macd)      + EPS;

    // Geometric mean weighted by component weights
    const likelihood =
      fibScore  ** W_FIB  *
      volScore  ** W_VOL  *
      rsiScore  ** W_RSI  *
      macdScore ** W_MACD;

    return equalPrior * likelihood;
  });

  const normalized = normalizeProbs(unnormalized);

  // Stamp results back onto WaveCount posteriors
  const scored = counts.map((count, i) => {
    const fib  = scoreFibConfluence(count, candles);
    const vol  = scoreVolumeProfile(count, candles);
    const rsiS = scoreRsiDivergence(count, rsi);
    const macdS = scoreMacdAlignment(count, macd);

    return {
      ...count,
      posterior: {
        ...count.posterior,
        prior: equalPrior,
        posterior: normalized[i],
        likelihood_components: {
          ...count.posterior.likelihood_components,
          fib_confluence: fib,
          volume_profile: vol,
          rsi_divergence: rsiS,
          momentum_alignment: macdS,
        },
        last_updated: Date.now(),
      },
    } satisfies WaveCount;
  });

  // Sort descending by posterior probability
  return scored.sort((a, b) => b.posterior.posterior - a.posterior.posterior);
}

// ── Exported component scorers (used directly in tests) ───────────────────────

export {
  scoreFibConfluence,
  scoreVolumeProfile,
  scoreRsiDivergence,
  scoreMacdAlignment,
};
