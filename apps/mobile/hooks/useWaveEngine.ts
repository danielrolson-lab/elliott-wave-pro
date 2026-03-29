/**
 * useWaveEngine.ts  (v3 — multi-hypothesis Bayesian + hysteresis)
 *
 * On each new candle close, slices the last 200 bars, runs the full
 * wave-engine v3 pipeline, and writes the top-4 scored WaveCounts to the
 * Zustand waveCount store.
 *
 * v3 upgrades:
 *   - Uses generateWaveCountsV3 with multi-hypothesis scoring
 *   - Engine state persisted in useRef for hysteresis across renders
 *   - PatternCandidate mapped to WaveCount for backward-compatible store writes
 *   - _v3 field carries raw v3 candidate for UI enhancements (ScenarioCard)
 */

import { useEffect, useRef, useState } from 'react';
import {
  detectPivots,
  generateWaveCountsV3,
} from '@elliott-wave-pro/wave-engine';
import type {
  OHLCV,
  WaveCount,
  WaveNode,
  WaveDegree,
  WaveLabel,
  WaveStructure,
  PatternCandidate,
  V3EngineState,
  PatternType,
} from '@elliott-wave-pro/wave-engine';
import { useWaveCountStore } from '../stores/waveCount';

const MAX_CANDLES = 200;
const EMPTY: WaveCount[] = [];

// Shorter timeframes need a smaller minimum-swing floor to detect enough pivots.
const MIN_SWING_PCT: Readonly<Record<string, number>> = {
  '1m':  0.00015,
  '15m': 0.00025,
};

function minPivots(timeframe: string): number {
  return timeframe === '1m' ? 4 : 6;
}

// ── Degree mapping ─────────────────────────────────────────────────────────────

/**
 * Maps v3 Degree strings to WaveDegree. v3 uses "subminuette" which the
 * existing type set doesn't have, so we fall back to "minuette".
 */
function mapV3Degree(degree: string): WaveDegree {
  const map: Record<string, WaveDegree> = {
    subminuette: 'minuette',
    minuette:    'minuette',
    minute:      'minute',
    minor:       'minor',
    intermediate: 'intermediate',
    primary:     'primary',
  };
  return map[degree] ?? 'minor';
}

// ── Pattern type mapping ───────────────────────────────────────────────────────

function mapV3PatternType(type: PatternType): WaveStructure {
  const map: Record<PatternType, WaveStructure> = {
    impulse:          'impulse',
    leading_diagonal: 'leading_diagonal',
    ending_diagonal:  'ending_diagonal',
    zigzag:           'zigzag',
    regular_flat:     'flat',
    expanded_flat:    'flat',
  };
  return map[type] ?? 'impulse';
}

// ── Impulse wave labels ────────────────────────────────────────────────────────

const IMPULSE_LABELS: WaveLabel[] = ['1', '2', '3', '4', '5'];
const CORRECTIVE_LABELS: WaveLabel[] = ['A', 'B', 'C'];

// ── Adapter: PatternCandidate → WaveCount ─────────────────────────────────────

function mapV3CandidateToWaveCount(
  candidate: PatternCandidate,
  sliceOffset: number,
  candles: readonly OHLCV[],
  ticker: string,
  timeframe: string,
): WaveCount {
  const degree    = mapV3Degree(candidate.degree);
  const structure = mapV3PatternType(candidate.type);
  const pivots    = candidate.pivots;

  const isCorrective =
    candidate.type === 'zigzag' ||
    candidate.type === 'regular_flat' ||
    candidate.type === 'expanded_flat';

  const labels = isCorrective ? CORRECTIVE_LABELS : IMPULSE_LABELS;

  // Build allWaves from sequential pivot pairs
  const allWaves: WaveNode[] = [];
  const pairCount = Math.min(pivots.length - 1, labels.length);

  for (let i = 0; i < pairCount; i++) {
    const p0 = pivots[i];
    const p1 = pivots[i + 1];

    // Resolve bar index: use pivot.bar if available, else find nearest candle
    const resolveBarIndex = (ts: number, bar?: number): number => {
      if (bar !== undefined && Number.isFinite(bar)) return sliceOffset + bar;
      // Find nearest candle by timestamp
      let best = sliceOffset;
      let bestDist = Infinity;
      for (let ci = 0; ci < candles.length; ci++) {
        const dist = Math.abs(candles[ci].timestamp - ts);
        if (dist < bestDist) { bestDist = dist; best = ci; }
      }
      return best;
    };

    const startBar = resolveBarIndex(p0.ts, p0.bar);
    const endBar   = resolveBarIndex(p1.ts, p1.bar);

    const startPivot = {
      index:     startBar,
      timestamp: p0.ts,
      price:     p0.price,
      type:      (p0.isHigh ? 'HH' : 'LL') as import('@elliott-wave-pro/wave-engine').PivotType,
      timeframe,
    };
    const endPivot = {
      index:     endBar,
      timestamp: p1.ts,
      price:     p1.price,
      type:      (p1.isHigh ? 'HH' : 'LL') as import('@elliott-wave-pro/wave-engine').PivotType,
      timeframe,
    };

    allWaves.push({
      label:      labels[i],
      degree,
      structure,
      startPivot,
      endPivot,
      subwaves:   [],
    });
  }

  // currentWave: last fully-formed wave
  const currentWave: WaveNode = allWaves[allWaves.length - 1] ?? {
    label:      labels[0],
    degree,
    structure,
    startPivot: {
      index: sliceOffset, timestamp: pivots[0]?.ts ?? 0, price: pivots[0]?.price ?? 0,
      type: 'LL', timeframe,
    },
    endPivot: null,
    subwaves: [],
  };

  // Targets — use engine-supplied zone if present; else compute Fibonacci extensions
  const tz = candidate.targetZone;
  let t1 = tz?.[0] ?? 0;
  let t2 = tz?.[1] ?? 0;
  let t3 = 0;
  if (t1 === 0 && pivots.length >= 2) {
    const waveOrigin = pivots[0].price;
    const lastPivot  = pivots[pivots.length - 1].price;
    const waveLen    = Math.abs(lastPivot - waveOrigin);
    const dir        = candidate.isBullish ? 1 : -1;
    t1 = lastPivot + dir * waveLen * 1.0;
    t2 = lastPivot + dir * waveLen * 1.618;
    t3 = lastPivot + dir * waveLen * 2.618;
  }
  const targets: [number, number, number] = [t1, t2, t3];

  const stopPrice = candidate.invalidation ?? 0;

  // R/R ratio
  const lastPrice = pivots[pivots.length - 1]?.price ?? 0;
  const risk   = Math.abs(lastPrice - stopPrice);
  const reward = Math.abs((targets[0] + targets[1]) / 2 - lastPrice);
  const rrRatio = risk > 0 ? reward / risk : 0;

  // Posterior components — map from v3 score breakdown
  const posterior: import('@elliott-wave-pro/wave-engine').WavePosterior = {
    countId:  candidate.id,
    prior:    candidate.prior,
    posterior: candidate.confidence,
    likelihood_components: {
      fib_confluence:    candidate.score.fibonacci / 100,
      volume_profile:    candidate.score.volume / 100,
      rsi_divergence:    candidate.score.momentum / 100,
      momentum_alignment: candidate.score.momentum / 100,
      breadth_alignment:  0.5,
      gex_alignment:      0.5,
      mtf_alignment:      candidate.score.htfAlignment / 100,
      time_symmetry:      candidate.score.time / 100,
    },
    decay_factor:         1,
    last_updated:         Date.now(),
    invalidation_price:   stopPrice,
    confidence_interval:  [
      Math.max(0, candidate.confidence - 0.1),
      Math.min(1, candidate.confidence + 0.1),
    ],
    mtf_conflict: candidate.score.htfAlignment < 40,
  };

  const waveCount: WaveCount & { _v3?: PatternCandidate } = {
    id:           candidate.id,
    ticker,
    timeframe,
    degree,
    currentWave,
    allWaves,
    posterior,
    targets,
    stopPrice,
    rrRatio,
    isValid:      candidate.hardViolations.length === 0,
    violations:   candidate.hardViolations,
    softWarnings: candidate.score.notes.slice(0, 3),
    createdAt:    Date.now(),
    updatedAt:    Date.now(),
    _v3:          candidate,
  };

  return waveCount;
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
  const v3EngineStateRef = useRef<V3EngineState>({});

  // Reset on ticker/timeframe change — clear both local state and the store
  // so CandlestickChart immediately removes stale overlays from the prior timeframe.
  useEffect(() => {
    prevLen.current = 0;
    v3EngineStateRef.current = {};
    setResult({ waveCounts: EMPTY, sliceOffset: 0 });
    setCounts(`${ticker}_${timeframe}`, []);
  }, [ticker, timeframe, setCounts]);

  useEffect(() => {
    if (candles.length < 20) return;
    if (candles.length === prevLen.current) return;

    prevLen.current = candles.length;

    const sliceOffset = Math.max(0, candles.length - MAX_CANDLES);
    const slice = candles.slice(sliceOffset) as OHLCV[];

    // Step 1: detect pivots using existing v1/v2 pivot detector
    const swingFloor = MIN_SWING_PCT[timeframe] ?? 0.0005;
    const pivots = detectPivots(slice, 0.5, timeframe, swingFloor);
    if (__DEV__) {
      console.log(`[useWaveEngine] ${ticker}_${timeframe}: slice=${slice.length} bars → ${pivots.length} pivots`);
    }
    if (pivots.length < minPivots(timeframe)) return;

    // Step 2: convert v1 pivots → v3 Pivot format
    const v3Pivots = pivots.map((p) => ({
      ts:     p.timestamp,
      price:  p.price,
      isHigh: p.type === 'HH' || p.type === 'LH',
      bar:    p.index,
    }));

    // Step 3: run v3 engine
    const v3Counts = generateWaveCountsV3({
      pivots:     v3Pivots,
      ticker,
      timeframe,
      assetClass: 'equity',
      state:      v3EngineStateRef.current,
      candles:    slice.map((c) => ({
        ts:     c.timestamp,
        open:   c.open,
        high:   c.high,
        low:    c.low,
        close:  c.close,
        volume: c.volume,
      })),
    });

    if (__DEV__) {
      console.log(`[useWaveEngine] ${ticker}_${timeframe}: ${v3Counts.length} v3 candidates`);
    }
    if (v3Counts.length === 0) return;

    // Step 4: update engine state for hysteresis
    const preferred = v3Counts.find((c) => c.preferred);
    if (preferred) {
      v3EngineStateRef.current = {
        preferredCandidateId: preferred.id,
        preferredScore:       preferred.score.total,
        lastSwitchTs:         Date.now(),
      };
    }

    // Step 5: map v3 candidates → WaveCount[] (top 4)
    const top4 = v3Counts.slice(0, 4).map((candidate) =>
      mapV3CandidateToWaveCount(candidate, sliceOffset, candles, ticker, timeframe),
    );

    if (__DEV__) {
      console.log(
        `[useWaveEngine] ${ticker}_${timeframe}: top-${top4.length} counts, posteriors=[${top4
          .map((c) => `${c.currentWave.label}@${(c.posterior.posterior * 100).toFixed(0)}%`)
          .join(', ')}]`,
      );
    }

    const next: UseWaveEngineResult = { waveCounts: top4, sliceOffset };
    setResult(next);
    setCounts(`${ticker}_${timeframe}`, top4);
  }, [candles, ticker, timeframe, setCounts]);

  return result;
}
