// Core domain types shared between the wave engine and the mobile app

export type WaveDegree =
  | 'grand_supercycle'
  | 'supercycle'
  | 'cycle'
  | 'primary'
  | 'intermediate'
  | 'minor'
  | 'minute'
  | 'minuette';

export type WaveLabel = '1' | '2' | '3' | '4' | '5' | 'A' | 'B' | 'C' | 'D' | 'E' | 'W' | 'X' | 'Y' | 'Z';

export type WaveStructure = 'impulse' | 'zigzag' | 'flat' | 'triangle' | 'leading_diagonal' | 'ending_diagonal';

export type PivotType = 'HH' | 'HL' | 'LH' | 'LL';

export type MarketRegime =
  | 'STRONG_TREND_UP'
  | 'WEAK_TREND_UP'
  | 'STRONG_TREND_DOWN'
  | 'WEAK_TREND_DOWN'
  | 'HIGH_VOL_CHOP'
  | 'LOW_VOL_COMPRESSION';

/** Color for each wave degree label on the chart (per Frost/Prechter convention). */
export const DEGREE_COLORS: Readonly<Record<WaveDegree, string>> = {
  grand_supercycle: '#FFD700', // gold
  supercycle:       '#C0C0C0', // silver
  cycle:            '#FFFFFF', // white
  primary:          '#FFFFFF', // white
  intermediate:     '#D4D4D4', // light gray
  minor:            '#A0A0A0', // gray
  minute:           '#6E7681', // dark gray
  minuette:         '#4E5A64', // dim
};

export interface Pivot {
  /** Index of this pivot in the source OHLCV array. */
  index: number;
  timestamp: number;
  price: number;
  type: PivotType;
  timeframe: string;
}

export interface WaveNode {
  label: WaveLabel;
  degree: WaveDegree;
  structure: WaveStructure;
  startPivot: Pivot;
  endPivot: Pivot | null;
  subwaves: WaveNode[];
}

export interface FibLevel {
  ratio: number;
  price: number;
  hit: boolean;
}

export interface WavePosterior {
  countId: string;
  prior: number;
  posterior: number;
  likelihood_components: {
    fib_confluence: number;
    volume_profile: number;
    rsi_divergence: number;
    momentum_alignment: number;
    breadth_alignment: number;
    gex_alignment: number;
    mtf_alignment: number;
    time_symmetry: number;
  };
  decay_factor: number;
  last_updated: number;
  invalidation_price: number;
  confidence_interval: [number, number];
  /** True when one or more higher-timeframe counts conflict in direction. */
  mtf_conflict: boolean;
}

export interface WaveCount {
  id: string;
  ticker: string;
  timeframe: string;
  degree: WaveDegree;
  currentWave: WaveNode;
  allWaves: WaveNode[];
  posterior: WavePosterior;
  targets: [number, number, number];
  stopPrice: number;
  rrRatio: number;
  isValid: boolean;
  violations: string[];
  /** Soft rule warnings — do not invalidate the count but lower its score. */
  softWarnings: string[];
  createdAt: number;
  updatedAt: number;
}

export interface OHLCV {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  vwap?: number;
}

export interface Instrument {
  ticker: string;
  name: string;
  exchange: string;
  type: 'equity' | 'etf' | 'futures' | 'forex' | 'crypto' | 'option';
  isLeveraged?: boolean;
  underlyingTicker?: string;
}
