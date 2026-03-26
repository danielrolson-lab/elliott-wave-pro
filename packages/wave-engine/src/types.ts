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

export type MarketRegime = 'TREND_UP' | 'TREND_DOWN' | 'CHOP' | 'HIGH_VOL';

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
