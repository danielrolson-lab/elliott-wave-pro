/**
 * @elliott-wave-pro/wave-engine
 *
 * Public API surface.  Import from this module only — do not reach
 * into sub-modules directly from outside this package.
 */

// ── Types ─────────────────────────────────────────────────────────────────────
export type {
  WaveDegree,
  WaveLabel,
  WaveStructure,
  PivotType,
  MarketRegime,
  Pivot,
  WaveNode,
  FibLevel,
  WavePosterior,
  WaveCount,
  OHLCV,
  Instrument,
} from './types';

export { DEGREE_COLORS } from './types';

// ── Pivot detection ───────────────────────────────────────────────────────────
export { detectPivots, computeATR } from './pivot-detection';

// ── Wave rules ────────────────────────────────────────────────────────────────
export {
  generateWaveCounts,
  checkRules,
  checkSoftRules,
  measureWaves,
  tryBuildDiagonal,
  isHighPivot,
  degreeForTimeframe,
} from './wave-rules';

// ── Fibonacci ─────────────────────────────────────────────────────────────────
export {
  computeFibLevels,
  getConfluenceHits,
  RETRACEMENT_RATIOS,
  EXTENSION_RATIOS,
} from './fibonacci';

// ── Probability engine ────────────────────────────────────────────────────────
export {
  scoreWaveCounts,
  applyDecay,
  scoreTimeSym,
  scoreFibConfluence,
  scoreVolumeProfile,
  scoreRsiDivergence,
  scoreMacdAlignment,
} from './probability-engine';

export type { ScoreOptions } from './probability-engine';

// ── Elliott Wave Engine v3 ─────────────────────────────────────────────────────
export { generateWaveCountsV3, explainCandidate } from './elliott-wave-engine-v3';
export type {
  PatternCandidate,
  EngineState as V3EngineState,
  HigherTimeframeBias,
  PatternType,
  CountStage,
  Degree as V3Degree,
  Recommendation,
  ScoreBreakdown,
  WaveMetrics,
  CandleLike,
  Pivot as V3Pivot,
} from './elliott-wave-engine-v3';
