/**
 * probability-engine.ts  (v2 — Bayesian v2 with incremental decay + MTF)
 *
 * Scores each WaveCount across eight likelihood components and returns the
 * array sorted by posterior probability (descending).
 *
 * Bayesian update rule (per spec):
 *   posterior = normalize( prior × likelihood )
 *   likelihood = ∏ component_i^weight_i
 *
 * Key upgrade from v1:
 *   - Incremental posterior: existing posterior is used as the prior for the
 *     next update, decayed toward the uniform distribution with a half-life
 *     of 5 candles.  First-time scores start with a uniform prior.
 *   - Multi-timeframe alignment: mtf_alignment component scores based on
 *     whether higher-TF counts agree in direction.  Caller supplies scores
 *     via opts.mtfScores.
 *   - Two stub components (breadth_alignment, gex_alignment) held at neutral
 *     until their data sources are integrated (D3 and D8).
 *
 * Component weights (sum = 1.0):
 *   fib_confluence     0.25  — price near key Fibonacci level
 *   volume_profile     0.20  — Wave 3 has the highest average volume
 *   rsi_divergence     0.15  — RSI alignment with current wave position
 *   momentum_alignment 0.10  — MACD histogram sign matches wave direction
 *   mtf_alignment      0.15  — same wave direction on higher timeframe(s)
 *   time_symmetry      0.10  — Wave 4 duration ≈ Wave 2 duration
 *   breadth_alignment  0.025 — NYSE TICK / A-D line (stub: neutral 0.5)
 *   gex_alignment      0.025 — GEX regime matches wave direction (stub)
 */

import type { WaveCount, OHLCV } from './types';
import { computeFibLevels } from './fibonacci';

// ── Component weights (must sum to 1.0) ───────────────────────────────────────

const WEIGHTS = {
  fib_confluence:     0.25,
  volume_profile:     0.20,
  rsi_divergence:     0.15,
  momentum_alignment: 0.10,
  mtf_alignment:      0.15,
  time_symmetry:      0.10,
  breadth_alignment:  0.025,
  gex_alignment:      0.025,
} as const satisfies Record<string, number>;

const HALF_LIFE_CANDLES = 5;
const EPS = 0.01; // prevents zero-product likelihood

// ── Incremental decay ─────────────────────────────────────────────────────────

/**
 * Blends an existing posterior toward the uniform (maximum-entropy) prior.
 *
 * After `halfLife` candle closes, the weight on the existing posterior halves.
 * After many candles without confirming new evidence, all counts converge
 * toward equal probability.
 *
 * @param existing       Previous posterior probability for this count
 * @param uniform        1/n (equal-weight prior among all competing counts)
 * @param candlesSince   Number of candle closes since `existing` was computed
 * @param halfLife       Decay half-life in candles (default 5)
 */
export function applyDecay(
  existing: number,
  uniform: number,
  candlesSince: number,
  halfLife = HALF_LIFE_CANDLES,
): number {
  const decayFactor = Math.pow(0.5, candlesSince / halfLife);
  return existing * decayFactor + uniform * (1 - decayFactor);
}

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
 * - Wave 5 complete (bullish): RSI < 70 = likely divergence → 0.8
 *                              RSI ≥ 70 = no divergence     → 0.3
 * - Wave 5 complete (bearish): RSI > 30 = likely divergence → 0.8
 *                              RSI ≤ 30 = no divergence     → 0.3
 * - Other waves: neutral 0.5
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

  const isBullishWave =
    label === '1' || label === '3' || label === '5'
      ? count.currentWave.startPivot.price < (count.currentWave.endPivot?.price ?? Infinity)
      : count.currentWave.startPivot.price > (count.currentWave.endPivot?.price ?? 0);

  const deadband = 0.01;
  if (Math.abs(macdHistogram) < deadband) return 0.5;

  const macdBullish = macdHistogram > 0;
  return macdBullish === isBullishWave ? 0.9 : 0.2;
}

// ── Score: Time symmetry ──────────────────────────────────────────────────────

/**
 * Per Frost/Prechter: Wave 4 often takes approximately the same time as Wave 2.
 * Measures the ratio of Wave 2 and Wave 4 durations in bars (via pivot indices).
 *
 * Returns 0.8 when durations are within a factor of 2; 0.4 otherwise.
 */
export function scoreTimeSym(count: WaveCount, _candles: OHLCV[]): number {
  const w2 = count.allWaves.find((w) => w.label === '2');
  const w4 = count.allWaves.find((w) => w.label === '4');

  if (!w2 || !w4 || !w2.endPivot || !w4.endPivot) return 0.5;

  const w2Bars = w2.endPivot.index - w2.startPivot.index;
  const w4Bars = w4.endPivot.index - w4.startPivot.index;

  if (w2Bars <= 0 || w4Bars <= 0) return 0.5;

  const ratio = Math.min(w2Bars, w4Bars) / Math.max(w2Bars, w4Bars);
  // 1.0 = perfect symmetry; score falls at ratio < 0.5 (factor-of-2 divergence)
  return ratio >= 0.5 ? 0.8 : 0.4;
}

// ── Score: MTF alignment ──────────────────────────────────────────────────────

/**
 * Accepts an external MTF score in [0, 1] supplied by the hook.
 * 0.9 = higher TF agrees in direction
 * 0.5 = no higher TF data (neutral)
 * 0.2 = higher TF conflicts in direction
 * If undefined, returns neutral 0.5.
 */
function scoreMtfAlignment(mtfScore: number | undefined): number {
  return mtfScore ?? 0.5;
}

// ── Score: Stub components ────────────────────────────────────────────────────

/** Breadth alignment (NYSE TICK / A-D line) — neutral stub until D8. */
function scoreBreadthAlignment(): number {
  return 0.5;
}

/** GEX alignment — neutral stub until D3 (GEX overlay). */
function scoreGexAlignment(): number {
  return 0.5;
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

export interface ScoreOptions {
  /**
   * Posterior probabilities from the previous scoring round, keyed by countId.
   * Used as the decayed prior for the incremental Bayesian update.
   * Counts not present here get a uniform prior (1/n).
   */
  existingPosteriors?: Readonly<Record<string, number>>;
  /**
   * How many candle closes have elapsed since the existing posteriors were
   * computed.  Drives the decay toward uniform prior.  Default: 1.
   */
  candlesSinceUpdate?: number;
  /**
   * MTF alignment score per countId, in [0, 1].
   * 0.9 = higher TF agrees, 0.5 = unknown/neutral, 0.2 = conflict.
   * Counts not present here receive the neutral score.
   */
  mtfScores?: Readonly<Record<string, number>>;
}

/**
 * Score and rank WaveCount objects by incremental Bayesian posterior.
 *
 * @param counts   Wave counts from generateWaveCounts
 * @param candles  OHLCV array (same series used to detect pivots)
 * @param rsi      Current RSI(14) value (0–100)
 * @param macd     Current MACD histogram value (positive = bullish momentum)
 * @param opts     Optional: existing posteriors, elapsed candles, MTF scores
 * @returns        The same counts with updated posteriors, sorted descending
 */
export function scoreWaveCounts(
  counts: WaveCount[],
  candles: OHLCV[],
  rsi: number,
  macd: number,
  opts: ScoreOptions = {},
): WaveCount[] {
  if (counts.length === 0) return [];

  const n = counts.length;
  const uniformPrior = 1 / n;
  const candlesSince = opts.candlesSinceUpdate ?? 1;

  // ── Compute priors (decayed from existing or uniform) ────────────────────────
  const priors = counts.map((count): number => {
    const existing = opts.existingPosteriors?.[count.id];
    if (existing === undefined) return uniformPrior;
    return applyDecay(existing, uniformPrior, candlesSince);
  });

  // ── Compute raw component scores (stored without EPS) ────────────────────────
  const rawScores = counts.map((count) => ({
    fib_confluence:     scoreFibConfluence(count, candles),
    volume_profile:     scoreVolumeProfile(count, candles),
    rsi_divergence:     scoreRsiDivergence(count, rsi),
    momentum_alignment: scoreMacdAlignment(count, macd),
    mtf_alignment:      scoreMtfAlignment(opts.mtfScores?.[count.id]),
    time_symmetry:      scoreTimeSym(count, candles),
    breadth_alignment:  scoreBreadthAlignment(),
    gex_alignment:      scoreGexAlignment(),
  }));

  // ── Compute likelihoods (geometric mean weighted, with EPS floor) ─────────────
  const likelihoods = rawScores.map((c) => (
    (c.fib_confluence     + EPS) ** WEIGHTS.fib_confluence     *
    (c.volume_profile     + EPS) ** WEIGHTS.volume_profile     *
    (c.rsi_divergence     + EPS) ** WEIGHTS.rsi_divergence     *
    (c.momentum_alignment + EPS) ** WEIGHTS.momentum_alignment *
    (c.mtf_alignment      + EPS) ** WEIGHTS.mtf_alignment      *
    (c.time_symmetry      + EPS) ** WEIGHTS.time_symmetry      *
    (c.breadth_alignment  + EPS) ** WEIGHTS.breadth_alignment  *
    (c.gex_alignment      + EPS) ** WEIGHTS.gex_alignment
  ));

  // ── Bayesian update: posterior ∝ prior × likelihood ───────────────────────────
  const unnormalized = priors.map((prior, i) => prior * likelihoods[i]);
  const normalized = normalizeProbs(unnormalized);

  const now = Date.now();
  const MTF_CONFLICT_THRESHOLD = 0.4;

  // ── Build updated WaveCounts ──────────────────────────────────────────────────
  const scored = counts.map((count, i): WaveCount => {
    const c = rawScores[i];
    const mtfScore = opts.mtfScores?.[count.id] ?? 0.5;
    const hasExisting = opts.existingPosteriors?.[count.id] !== undefined;

    return {
      ...count,
      posterior: {
        ...count.posterior,
        prior: priors[i],
        posterior: normalized[i],
        likelihood_components: {
          fib_confluence:     c.fib_confluence,
          volume_profile:     c.volume_profile,
          rsi_divergence:     c.rsi_divergence,
          momentum_alignment: c.momentum_alignment,
          mtf_alignment:      c.mtf_alignment,
          time_symmetry:      c.time_symmetry,
          breadth_alignment:  c.breadth_alignment,
          gex_alignment:      c.gex_alignment,
        },
        decay_factor: hasExisting
          ? Math.pow(0.5, candlesSince / HALF_LIFE_CANDLES)
          : 1.0,
        last_updated: now,
        mtf_conflict: mtfScore < MTF_CONFLICT_THRESHOLD,
      },
    } satisfies WaveCount;
  });

  return scored.sort((a, b) => b.posterior.posterior - a.posterior.posterior);
}

// ── Exported component scorers (used directly in tests) ───────────────────────

export {
  scoreFibConfluence,
  scoreVolumeProfile,
  scoreRsiDivergence,
  scoreMacdAlignment,
};
