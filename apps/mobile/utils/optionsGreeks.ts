/**
 * optionsGreeks.ts
 *
 * Client-side computation of second-order Greeks (Vanna, Charm), moneyness
 * classification, Max Pain, and IV Rank.
 *
 * All formulas follow the standard Black-Scholes framework.
 * Risk-free rate is approximated at 5% (r = 0.05).
 * No dividends assumed (q = 0).
 */

import type { FullOptionRecord } from '../services/polygonOptions';

// ── Constants ─────────────────────────────────────────────────────────────────

const RISK_FREE_RATE = 0.05;

// ── Black-Scholes primitives ──────────────────────────────────────────────────

/** Standard normal PDF φ(x) */
function normPDF(x: number): number {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}

/** Standard normal CDF Φ(x) — Abramowitz & Stegun approximation (error < 7.5e-8) */
function normCDF(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const z = Math.abs(x);
  const t = 1 / (1 + 0.2316419 * z);
  const poly =
    t * (0.319381530 +
      t * (-0.356563782 +
        t * (1.781477937 +
          t * (-1.821255978 + t * 1.330274429))));
  return 0.5 + sign * (0.5 - normPDF(z) * poly);
}

interface BSParams {
  d1: number;
  d2: number;
  sqrtT: number;
}

function bsParams(
  spot:   number,
  strike: number,
  iv:     number,
  dte:    number,
): BSParams | null {
  if (dte <= 0 || iv <= 0 || spot <= 0 || strike <= 0) return null;
  const T     = dte / 365;
  const sqrtT = Math.sqrt(T);
  const d1    = (Math.log(spot / strike) + (RISK_FREE_RATE + 0.5 * iv * iv) * T) / (iv * sqrtT);
  const d2    = d1 - iv * sqrtT;
  return { d1, d2, sqrtT };
}

// ── Second-order Greeks ───────────────────────────────────────────────────────

/**
 * Vanna = ∂Delta/∂σ = ∂Vega/∂S
 *
 * Vanna = -φ(d1) × d2 / σ
 *
 * Positive Vanna: long calls gain delta as vol rises.
 * Charm is Vanna's time-decay equivalent.
 */
export function computeVanna(
  spot:   number,
  strike: number,
  iv:     number,
  dte:    number,
): number {
  const p = bsParams(spot, strike, iv, dte);
  if (!p) return 0;
  return -normPDF(p.d1) * p.d2 / iv;
}

/**
 * Charm = ∂Delta/∂T (daily delta bleed per day)
 *
 * For a call (no dividends):
 *   charm = -φ(d1) × [2×r×T - d2×σ×√T] / (2×T×σ×√T)
 *
 * Returned as a per-day value (T in years → divide by 365).
 */
export function computeCharm(
  spot:        number,
  strike:      number,
  iv:          number,
  dte:         number,
  contractType: 'call' | 'put',
): number {
  const p = bsParams(spot, strike, iv, dte);
  if (!p) return 0;
  const T    = dte / 365;
  const denom = 2 * T * iv * p.sqrtT;
  if (Math.abs(denom) < 1e-12) return 0;
  const raw = -normPDF(p.d1) * (2 * RISK_FREE_RATE * T - p.d2 * iv * p.sqrtT) / denom;
  // For puts, charm = call_charm - risk_free × e^(-rT) × N(-d2)   →  simplified: negate correction
  return contractType === 'call' ? raw / 365 : (raw - RISK_FREE_RATE * normCDF(-p.d2)) / 365;
}

// ── Moneyness classification ──────────────────────────────────────────────────

export type Moneyness = 'deep_itm' | 'itm' | 'atm' | 'otm' | 'deep_otm';

/**
 * Classifies moneyness by how far the strike is from spot, relative to spot.
 *   ATM:      |strike/spot - 1| < 1%
 *   ITM/OTM:  1–5%
 *   Deep:     > 5%
 */
export function classifyMoneyness(
  strike:      number,
  spot:        number,
  contractType: 'call' | 'put',
): Moneyness {
  const pct = (strike - spot) / spot;
  const absP = Math.abs(pct);

  if (absP < 0.01) return 'atm';

  // Calls: ITM when strike < spot; Puts: ITM when strike > spot
  const isITM = contractType === 'call' ? pct < 0 : pct > 0;

  if (isITM) return absP > 0.05 ? 'deep_itm' : 'itm';
  return absP > 0.05 ? 'deep_otm' : 'otm';
}

// ── Max Pain ─────────────────────────────────────────────────────────────────

/**
 * Computes the Max Pain strike — the price at which total option dollar pain
 * (sum of intrinsic value of all open contracts) is minimised for option buyers
 * (hence maximised loss is minimised for sellers, i.e. the market maker's
 * preferred expiry price).
 *
 * Algorithm: for each candidate strike S_exp, sum intrinsic value of all
 * calls (max(0, S_exp - K) × OI) and all puts (max(0, K - S_exp) × OI).
 * Return the candidate strike that minimises this total.
 */
export function computeMaxPain(rows: readonly FullOptionRecord[]): number {
  const strikes = Array.from(new Set(rows.map((r) => r.strike))).sort((a, b) => a - b);
  if (strikes.length === 0) return 0;

  let minPain = Infinity;
  let maxPainStrike = strikes[0];

  for (const candidate of strikes) {
    let pain = 0;
    for (const r of rows) {
      if (r.contractType === 'call') {
        pain += Math.max(0, candidate - r.strike) * r.openInterest;
      } else {
        pain += Math.max(0, r.strike - candidate) * r.openInterest;
      }
    }
    if (pain < minPain) {
      minPain = pain;
      maxPainStrike = candidate;
    }
  }

  return maxPainStrike;
}

// ── ATM IV from a set of rows ─────────────────────────────────────────────────

/**
 * Returns the weighted average IV of the two strikes nearest to spot for a
 * given expiry set.  Used to build the IV term structure.
 */
export function atmIV(rows: readonly FullOptionRecord[], spot: number): number {
  if (rows.length === 0 || spot <= 0) return 0;

  // Find the two strikes nearest to spot (one below, one above)
  const strikes = Array.from(new Set(rows.map((r) => r.strike))).sort((a, b) => a - b);

  let lo = strikes[0];
  let hi = strikes[strikes.length - 1];

  for (const s of strikes) {
    if (s <= spot) lo = s;
    if (s >= spot && hi === strikes[strikes.length - 1]) hi = s;
  }

  // Average the call and put IV at each bracket strike
  const ivAt = (strike: number): number => {
    const at = rows.filter((r) => r.strike === strike);
    if (at.length === 0) return 0;
    const sum = at.reduce((acc, r) => acc + r.impliedVol, 0);
    return sum / at.length;
  };

  const ivLo = ivAt(lo);
  const ivHi = ivAt(hi);
  if (lo === hi) return ivLo;

  // Linear interpolation between the two bracket strikes
  const t = (spot - lo) / (hi - lo);
  return ivLo + t * (ivHi - ivLo);
}

// ── IV Rank ───────────────────────────────────────────────────────────────────

/**
 * IV Rank (0–100): how high current IV is relative to the trailing sample.
 *
 * IV Rank = (current - min) / (max - min) × 100
 *
 * If fewer than 2 samples, returns 50 (neutral).
 */
export function computeIVRank(currentIV: number, ivHistory: readonly number[]): number {
  if (ivHistory.length < 2) return 50;
  const min = Math.min(...ivHistory);
  const max = Math.max(...ivHistory);
  if (max === min) return 50;
  return Math.round(((currentIV - min) / (max - min)) * 100);
}

// ── 25-delta Risk Reversal + Butterfly ────────────────────────────────────────

interface SkewStats {
  riskReversal25d: number;   // IV(25-delta put) - IV(25-delta call)
  butterfly25d:    number;   // (IV(25-delta put) + IV(25-delta call)) / 2 - IV(50-delta)
}

/**
 * Estimates 25-delta risk reversal and butterfly from a set of call rows at
 * a single expiry.  Finds the rows closest to |delta| = 0.25 and 0.50.
 */
export function computeSkewStats(
  rows: readonly FullOptionRecord[],
): SkewStats | null {
  const calls = rows.filter((r) => r.contractType === 'call' && r.delta > 0);
  const puts  = rows.filter((r) => r.contractType === 'put'  && r.delta < 0);

  if (calls.length === 0 || puts.length === 0) return null;

  const nearest = (arr: readonly FullOptionRecord[], target: number): FullOptionRecord => {
    return arr.reduce((best, r) =>
      Math.abs(Math.abs(r.delta) - target) < Math.abs(Math.abs(best.delta) - target) ? r : best,
    );
  };

  const call25 = nearest(calls, 0.25);
  const put25  = nearest(puts,  0.25);
  const call50 = nearest(calls, 0.50);

  const riskReversal25d = put25.impliedVol - call25.impliedVol;
  const butterfly25d    = (put25.impliedVol + call25.impliedVol) / 2 - call50.impliedVol;

  return { riskReversal25d, butterfly25d };
}
