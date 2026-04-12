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

// Analysis window per TF — how many candles the wave engine processes.
// Chart can display ALL fetched candles; this only caps the wave analysis slice.
// Sized to give ~3–4 weeks of structural context without being computationally heavy.
const MAX_CANDLES_BY_TF: Readonly<Record<string, number>> = {
  '1m': 150, '5m': 200, '15m': 300, '30m': 400,
  '1h': 400, '4h': 350, '1D': 500, '1W': 200,
};
const MAX_CANDLES = 200; // fallback
const EMPTY: WaveCount[] = [];

// Shorter timeframes need a smaller minimum-swing floor to detect enough pivots.
const MIN_SWING_PCT: Readonly<Record<string, number>> = {
  '1m':  0.00015,
  '5m':  0.00020,
  '15m': 0.00025,
  '30m': 0.00030,
  '1h':  0.00035,
  '4h':  0.00040,
  '1D':  0.00050,
  '1W':  0.00080,
};

function minPivots(timeframe: string): number {
  return (timeframe === '1m' || timeframe === '5m' || timeframe === '15m') ? 4 : 6;
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

  // Build allWaves from pivot pairs.
  // • Impulse (5-wave): consecutive pairs 0→1, 1→2, 2→3, 3→4, 4→5
  // • Zigzag / flat (3-wave): the engine stores the full 6-pivot window but
  //   the ABC structure uses pivots at indices [0,2], [2,3], [3,5].
  //   Using consecutive pairs here would draw 3 micro-segments instead of the
  //   actual A, B, C waves.
  const CORR_PAIRS: [number, number][] = [[0, 2], [2, 3], [3, 5]];
  const pairIndices: [number, number][] = isCorrective
    ? CORR_PAIRS.slice(0, Math.min(labels.length, pivots.length > 5 ? 3 : 1))
    : Array.from({ length: Math.min(pivots.length - 1, labels.length) }, (_, i) => [i, i + 1] as [number, number]);

  const allWaves: WaveNode[] = [];

  for (let i = 0; i < pairIndices.length; i++) {
    const [si, ei] = pairIndices[i];
    const p0 = pivots[si];
    const p1 = pivots[ei];
    if (!p0 || !p1) break;

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

  // Targets
  // • Forming stage: project forward in wave direction (Fibonacci extensions)
  // • Complete stage: project CORRECTIVE retracement levels back into the structure.
  //   A complete 5-wave impulse is followed by an ABC correction — show 38.2%/61.8%/100%
  //   retracement of the full wave from origin to end as T1/T2/T3.
  const tz = candidate.targetZone;
  let t1 = tz?.[0] ?? 0;
  let t2 = tz?.[1] ?? 0;
  let t3 = 0;

  if (candidate.stage === 'complete' && pivots.length >= 2) {
    // Complete: show corrective retracement targets (counter-direction)
    const waveOrigin = pivots[0].price;
    const waveEnd    = pivots[pivots.length - 1].price;
    const waveLen    = Math.abs(waveEnd - waveOrigin);
    if (waveLen / Math.max(waveEnd, 0.01) >= 0.005) {
      const corrDir = candidate.isBullish ? -1 : 1; // correction goes opposite direction
      t1 = waveEnd + corrDir * waveLen * 0.382;
      t2 = waveEnd + corrDir * waveLen * 0.618;
      t3 = waveOrigin; // 100% retrace = full reversal
    }
  } else if (t1 === 0 && pivots.length >= 2) {
    // Forming: project continuation extensions
    const waveOrigin = pivots[0].price;
    const lastPivot  = pivots[pivots.length - 1].price;
    const waveLen    = Math.abs(lastPivot - waveOrigin);
    // Only project targets when the wave span is at least 0.5% of price
    if (lastPivot > 0 && waveLen / lastPivot >= 0.005) {
      const dir = candidate.isBullish ? 1 : -1;
      t1 = lastPivot + dir * waveLen * 1.0;
      t2 = lastPivot + dir * waveLen * 1.618;
      t3 = lastPivot + dir * waveLen * 2.618;
    }
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
  isHistorical: boolean;
}

export function useWaveEngine(
  ticker: string,
  timeframe: string,
  candles: readonly OHLCV[],
  viewportStart?: number,
): UseWaveEngineResult {
  const setCounts = useWaveCountStore((s) => s.setCounts);
  const [result, setResult] = useState<UseWaveEngineResult>({
    waveCounts: EMPTY,
    sliceOffset: 0,
    isHistorical: false,
  });
  const prevLen = useRef(0);
  const prevViewportRef = useRef(-1);
  const v3EngineStateRef = useRef<V3EngineState>({});

  // Reset on ticker/timeframe change — clear both local state and the store
  // so CandlestickChart immediately removes stale overlays from the prior timeframe.
  useEffect(() => {
    prevLen.current = 0;
    prevViewportRef.current = -1;
    v3EngineStateRef.current = {};
    setResult({ waveCounts: EMPTY, sliceOffset: 0, isHistorical: false });
    setCounts(`${ticker}_${timeframe}`, []);
  }, [ticker, timeframe, setCounts]);

  useEffect(() => {
    if (candles.length < 20) return;

    const tfMaxCandles = MAX_CANDLES_BY_TF[timeframe] ?? MAX_CANDLES;
    const HIST_THRESHOLD = 50; // bars from live edge to trigger historical mode
    const liveSliceOffset = Math.max(0, candles.length - tfMaxCandles);
    const isHistMode = viewportStart !== undefined
      && viewportStart < liveSliceOffset - HIST_THRESHOLD;

    // In live mode: skip if no new candle
    if (!isHistMode && candles.length === prevLen.current) return;
    // In historical mode: skip if viewport hasn't moved significantly
    if (isHistMode && viewportStart === prevViewportRef.current) return;

    prevLen.current = candles.length;
    if (isHistMode && viewportStart !== undefined) prevViewportRef.current = viewportStart;

    // Compute slice
    const sliceOffset = isHistMode
      ? Math.max(0, viewportStart! - 20)  // 20-bar context before viewport
      : liveSliceOffset;
    const sliceEnd = isHistMode
      ? Math.min(candles.length, viewportStart! + tfMaxCandles)
      : candles.length;
    const slice = candles.slice(sliceOffset, sliceEnd) as OHLCV[];

    // Step 1: detect pivots using existing v1/v2 pivot detector
    const swingFloor = MIN_SWING_PCT[timeframe] ?? 0.0005;
    // Adaptive ATR multiplier — shorter TFs need higher sensitivity (more pivots)
    const ATR_MULT: Record<string, number> = {
      '1m': 1.5, '5m': 1.2, '15m': 1.0, '30m': 0.8, '1h': 1.0, '4h': 0.8, '1D': 0.5, '1W': 0.4,
    };
    const atrMult = ATR_MULT[timeframe] ?? 0.5;
    const pivots = detectPivots(slice, atrMult, timeframe, swingFloor);
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

    // Step 4b: Recency reorder — prefer the highest-confidence candidate whose
    // last pivot falls in the recent 30% of the slice.  Without this, a
    // high-confidence complete pattern from the middle of history wins over a
    // more-recent (but slightly lower-scoring) forming pattern, and the wave
    // overlay ends up off-screen to the left.
    const recentCutoff = Math.floor(slice.length * 0.70);
    const recentCandidates = [...v3Counts].sort((a, b) => {
      const aLastBar = a.pivots[a.pivots.length - 1]?.bar ?? 0;
      const bLastBar = b.pivots[b.pivots.length - 1]?.bar ?? 0;
      const aRecent = aLastBar >= recentCutoff ? 1 : 0;
      const bRecent = bLastBar >= recentCutoff ? 1 : 0;
      if (aRecent !== bRecent) return bRecent - aRecent; // recent first
      return b.score.total - a.score.total; // then by engine score
    });
    // Only apply the reorder if it produces a different primary candidate
    const rankedCounts = recentCandidates[0]?.id !== v3Counts[0]?.id
      ? recentCandidates
      : v3Counts;

    // Step 5: map v3 candidates → WaveCount[] (top 4)
    const top4 = rankedCounts.slice(0, 4).map((candidate) =>
      mapV3CandidateToWaveCount(candidate, sliceOffset, candles, ticker, timeframe),
    );

    // Step 6: Post-completion re-anchor pass.
    // When the primary count is a COMPLETE pattern, run a second engine pass
    // starting from the last pivot of that pattern. This surfaces the opposing
    // impulse that a human analyst would manually anchor from the completion point.
    const primary = rankedCounts[0];
    if (primary?.stage === 'complete' && primary.pivots.length >= 2) {
      const lastPivot = primary.pivots[primary.pivots.length - 1];
      // lastPivot.bar is relative to the slice; convert to absolute candle index
      const anchorBar = sliceOffset + (lastPivot.bar ?? 0);
      // Need at least 8 bars after the anchor for a meaningful sub-structure
      if (anchorBar < candles.length - 8) {
        const reanchorOffset = Math.max(sliceOffset, anchorBar - 2); // 2 bars of context
        const reanchorSlice = candles.slice(reanchorOffset) as OHLCV[];

        if (reanchorSlice.length >= 8) {
          const rePivots = detectPivots(reanchorSlice, atrMult, timeframe, swingFloor);
          if (rePivots.length >= 4) {
            const reV3Pivots = rePivots.map((p) => ({
              ts:     p.timestamp,
              price:  p.price,
              isHigh: p.type === 'HH' || p.type === 'LH',
              bar:    p.index,
            }));
            const reCandidates = generateWaveCountsV3({
              pivots:     reV3Pivots,
              ticker,
              timeframe,
              assetClass: 'equity',
              state:      {},
              candles:    reanchorSlice.map((c) => ({
                ts: c.timestamp, open: c.open, high: c.high,
                low: c.low, close: c.close, volume: c.volume,
              })),
            });
            // Keep candidates that are OPPOSING direction to the primary
            const opposingDir = !primary.isBullish;
            const opposingCandidates = reCandidates.filter(
              (c) => c.isBullish === opposingDir && c.confidence >= 0.25,
            );
            if (opposingCandidates.length > 0) {
              const mapped = opposingCandidates.slice(0, 2).map((c) =>
                mapV3CandidateToWaveCount(c, reanchorOffset, candles, ticker, timeframe),
              );
              // Merge: keep top4 primary counts, append opposing ones (up to 4 total)
              const merged = [...top4, ...mapped].slice(0, 4);
              if (__DEV__) {
                console.log(
                  `[useWaveEngine] re-anchor found ${opposingCandidates.length} opposing candidates from bar ${anchorBar}`,
                );
              }
              const next: UseWaveEngineResult = { waveCounts: merged, sliceOffset, isHistorical: isHistMode };
              setResult(next);
              setCounts(`${ticker}_${timeframe}`, merged);
              return;
            }
          }
        }
      }
    }

    if (__DEV__) {
      console.log(
        `[useWaveEngine] ${ticker}_${timeframe}: top-${top4.length} counts, posteriors=[${top4
          .map((c) => `${c.currentWave.label}@${(c.posterior.posterior * 100).toFixed(0)}%`)
          .join(', ')}]`,
      );
    }

    const next: UseWaveEngineResult = { waveCounts: top4, sliceOffset, isHistorical: isHistMode };
    setResult(next);
    setCounts(`${ticker}_${timeframe}`, top4);
  }, [candles, viewportStart, ticker, timeframe, setCounts]);

  return result;
}
