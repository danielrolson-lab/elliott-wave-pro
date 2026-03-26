/**
 * etfDecayEngine.ts
 *
 * Leveraged ETF daily rebalance drag model.
 *
 * Formula (continuous compounding approximation):
 *   decay_per_day ≈ (leverage² × daily_variance) / 2
 *   annual_drag   ≈ decay_per_day × 252  (trading days)
 *
 * where daily_variance = stdev(daily_returns)²
 *
 * Example:
 *   3× ETF with 1% daily vol → decay ≈ (9 × 0.0001) / 2 = 0.00045/day → ~11.3% annual drag
 *
 * Rollover cost (futures-based ETFs like VIX products):
 *   Contango drag = (front_price - next_price) / next_price × positions_rolled_per_year
 *   We approximate this as a fixed regime: contango = -0.5%/day, backwardation = +0.3%/day
 *
 * References:
 *   Cheng & Madhavan (2009), "The Dynamics of Leveraged and Inverse ETF Returns"
 */

import type { OHLCV } from '@elliott-wave-pro/wave-engine';

// ── Leveraged ETF registry ────────────────────────────────────────────────────

export interface LeveragedETFSpec {
  ticker:   string;
  leverage: number;     // 2 or 3 (negative for inverse)
  underlying: string;   // e.g. "QQQ", "SOX", "VIX"
  /** True if futures-based (VIX-linked) — adds rollover cost */
  futuresBased: boolean;
}

/** Known leveraged/inverse ETFs. Checked by substring match on ticker. */
export const LEVERAGED_ETF_REGISTRY: readonly LeveragedETFSpec[] = [
  // 3× Bull
  { ticker: 'TQQQ',  leverage:  3, underlying: 'QQQ',  futuresBased: false },
  { ticker: 'SOXL',  leverage:  3, underlying: 'SOX',  futuresBased: false },
  { ticker: 'SPXL',  leverage:  3, underlying: 'SPY',  futuresBased: false },
  { ticker: 'UPRO',  leverage:  3, underlying: 'SPY',  futuresBased: false },
  { ticker: 'TNA',   leverage:  3, underlying: 'IWM',  futuresBased: false },
  { ticker: 'FNGU',  leverage:  3, underlying: 'FANG', futuresBased: false },
  // 2× Bull
  { ticker: 'QLD',   leverage:  2, underlying: 'QQQ',  futuresBased: false },
  { ticker: 'SSO',   leverage:  2, underlying: 'SPY',  futuresBased: false },
  { ticker: 'USD',   leverage:  2, underlying: 'SOX',  futuresBased: false },
  // 3× Bear
  { ticker: 'SQQQ',  leverage: -3, underlying: 'QQQ',  futuresBased: false },
  { ticker: 'SOXS',  leverage: -3, underlying: 'SOX',  futuresBased: false },
  { ticker: 'SPXS',  leverage: -3, underlying: 'SPY',  futuresBased: false },
  { ticker: 'SDOW',  leverage: -3, underlying: 'DJIA', futuresBased: false },
  { ticker: 'TZA',   leverage: -3, underlying: 'IWM',  futuresBased: false },
  // 2× Bear
  { ticker: 'QID',   leverage: -2, underlying: 'QQQ',  futuresBased: false },
  { ticker: 'SDS',   leverage: -2, underlying: 'SPY',  futuresBased: false },
  // VIX-based (futures rollover)
  { ticker: 'UVXY',  leverage:  1.5, underlying: 'VIX', futuresBased: true },
  { ticker: 'SVXY',  leverage: -0.5, underlying: 'VIX', futuresBased: true },
  { ticker: 'VXX',   leverage:  1,   underlying: 'VIX', futuresBased: true },
  { ticker: 'VIXY',  leverage:  1,   underlying: 'VIX', futuresBased: true },
];

// ── Decay result ──────────────────────────────────────────────────────────────

export interface DecayResult {
  ticker:         string;
  leverage:       number;
  /** Daily volatility drag as a fraction (e.g. 0.00045 = 0.045%/day) */
  decayPerDay:    number;
  /** Annualised drag percentage (0–100) */
  annualDragPct:  number;
  /** Rollover cost per year (0 if not futures-based) */
  rolloverDragPct: number;
  /** Total annualised drag = vol drag + rollover drag (percent) */
  totalDragPct:   number;
  /** Daily variance of the underlying asset */
  dailyVariance:  number;
  /** Whether a rollover alert should fire (futures-based only) */
  rolloverAlert:  boolean;
}

// ── Core functions ────────────────────────────────────────────────────────────

/** Looks up the ETF spec by ticker. Returns null if not a known leveraged ETF. */
export function getLeveragedSpec(ticker: string): LeveragedETFSpec | null {
  return LEVERAGED_ETF_REGISTRY.find((s) => s.ticker === ticker.toUpperCase()) ?? null;
}

/**
 * Computes decay for a leveraged ETF given recent underlying candles.
 *
 * @param spec     LeveragedETFSpec from registry
 * @param candles  Recent OHLCV bars of the *underlying* (not the ETF itself)
 */
export function computeDecay(
  spec:    LeveragedETFSpec,
  candles: readonly OHLCV[],
): DecayResult {
  const lev = spec.leverage;

  // Compute daily returns of underlying
  const returns: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const prev = candles[i - 1]!.close;
    const curr = candles[i]!.close;
    if (prev > 0) returns.push((curr - prev) / prev);
  }

  // Stdev of returns
  const dailyVariance = computeVariance(returns);

  // Decay = (lev² × σ²) / 2
  const decayPerDay   = (lev * lev * dailyVariance) / 2;
  const annualDragPct = decayPerDay * 252 * 100;

  // Rollover cost (VIX ETP typical contango ~8-10%/year → ~0.03%/day)
  const CONTANGO_PER_DAY = 0.0003; // 0.03% per day ≈ 7.5% per year
  const rolloverDragPct  = spec.futuresBased ? CONTANGO_PER_DAY * 252 * 100 : 0;

  const totalDragPct   = annualDragPct + rolloverDragPct;

  // Rollover alert: VIX futures roll every Wednesday — simplified as always true
  // for futures-based ETFs (UI can show "Futures Roll" badge)
  const rolloverAlert  = spec.futuresBased;

  return {
    ticker:          spec.ticker,
    leverage:        lev,
    decayPerDay,
    annualDragPct,
    rolloverDragPct,
    totalDragPct,
    dailyVariance,
    rolloverAlert,
  };
}

/** Returns a 0–1 decay severity score (0 = negligible, 1 = extreme). */
export function decaySeverity(result: DecayResult): number {
  // 0–5% drag → 0–0.25, 5–15% drag → 0.25–0.75, 15%+ → 0.75–1
  const drag = result.totalDragPct;
  if (drag < 5)  return (drag / 5) * 0.25;
  if (drag < 15) return 0.25 + ((drag - 5) / 10) * 0.5;
  return Math.min(1, 0.75 + ((drag - 15) / 20) * 0.25);
}

/** Color for the decay meter (green → yellow → red). */
export function decayColor(severity: number): string {
  if (severity < 0.35) return '#22c55e';
  if (severity < 0.65) return '#f59e0b';
  return '#ef4444';
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function computeVariance(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const sq   = values.reduce((a, b) => a + (b - mean) ** 2, 0);
  return sq / (values.length - 1);
}
