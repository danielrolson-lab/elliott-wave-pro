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

// ── Pivot detection ───────────────────────────────────────────────────────────
export { detectPivots, computeATR } from './pivot-detection';

// ── Wave rules ────────────────────────────────────────────────────────────────
export { generateWaveCounts } from './wave-rules';

// ── Fibonacci ─────────────────────────────────────────────────────────────────
export {
  computeFibLevels,
  getConfluenceHits,
  RETRACEMENT_RATIOS,
  EXTENSION_RATIOS,
} from './fibonacci';

// ── Probability engine ────────────────────────────────────────────────────────
export { scoreWaveCounts } from './probability-engine';
