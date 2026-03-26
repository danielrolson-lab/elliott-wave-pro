/**
 * gexCalculator.ts
 *
 * Computes dealer Gamma Exposure (GEX) from a raw options chain.
 *
 * Formula (per strike):
 *   dealer_call_gex  = +gamma × openInterest × 100 × spot²  (dealers short calls = long gamma from calls)
 *   dealer_put_gex   = -gamma × openInterest × 100 × spot²  (dealers long puts = short gamma from puts)
 *   net_gex_at_strike = Σ call_gex - Σ put_gex  (for all contracts at that strike)
 *
 * The sign convention used here:
 *   Positive net GEX → long gamma regime (price-stabilising: dealers buy dips, sell rallies)
 *   Negative net GEX → short gamma regime (price-amplifying: dealers sell dips, buy rallies)
 *
 * Key levels:
 *   Call Wall  — strike with the largest positive net GEX (resistance magnet)
 *   Put Wall   — strike with the largest negative net GEX (support / acceleration level)
 *   Zero GEX   — price level where cumulative net GEX changes sign (the gamma flip)
 *
 * The dollar-unit scaling (÷ 1e9) converts raw GEX to billions for display.
 */

import type { OptionRecord } from '../services/polygonOptions';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface StrikeGEX {
  strike: number;
  gex:    number;   // net dealer GEX at this strike (raw dollars)
}

export interface GEXLevels {
  zeroGex:         number;    // price of the gamma flip
  callWall:        number;    // strike with max positive GEX
  putWall:         number;    // strike with max negative GEX
  netGexBillions:  number;    // total net GEX in billions
  byStrike:        StrikeGEX[];  // sorted ascending by strike (for heatmap)
}

// ── Compute ───────────────────────────────────────────────────────────────────

/**
 * Computes GEX levels from an options chain snapshot.
 *
 * @param records  - option records from `fetchOptionsChain`
 * @param spot     - current underlying price (used in the GEX formula)
 * @returns GEXLevels, or null if there is insufficient data
 */
export function computeGEXLevels(
  records: readonly OptionRecord[],
  spot:    number,
): GEXLevels | null {
  if (records.length === 0 || spot <= 0) return null;

  // Aggregate GEX per strike
  const byStrikeMap = new Map<number, number>();

  for (const r of records) {
    const raw = r.gamma * r.openInterest * 100 * spot * spot;
    const contribution = r.contractType === 'call' ? raw : -raw;
    byStrikeMap.set(r.strike, (byStrikeMap.get(r.strike) ?? 0) + contribution);
  }

  if (byStrikeMap.size === 0) return null;

  // Sort strikes ascending
  const byStrike: StrikeGEX[] = Array.from(byStrikeMap.entries())
    .map(([strike, gex]) => ({ strike, gex }))
    .sort((a, b) => a.strike - b.strike);

  // Total net GEX
  const netGexTotal = byStrike.reduce((sum, s) => sum + s.gex, 0);

  // Call Wall: strike with max positive GEX
  let callWallGex  = -Infinity;
  let callWall     = spot;
  for (const s of byStrike) {
    if (s.gex > callWallGex) { callWallGex = s.gex; callWall = s.strike; }
  }

  // Put Wall: strike with max negative GEX
  let putWallGex = Infinity;
  let putWall    = spot;
  for (const s of byStrike) {
    if (s.gex < putWallGex) { putWallGex = s.gex; putWall = s.strike; }
  }

  // Zero GEX: find the strike pair where cumulative GEX crosses zero.
  // Accumulate from lowest strike upward; interpolate linearly at the crossing.
  let zeroGex     = spot;
  let cumulative  = 0;
  let prevCum     = 0;
  let prevStrike  = byStrike[0].strike;
  let found       = false;

  for (const s of byStrike) {
    cumulative += s.gex;

    if (!found && prevCum * cumulative <= 0 && prevStrike !== s.strike) {
      // Linear interpolation to find the crossing price
      const t = Math.abs(prevCum) / (Math.abs(prevCum) + Math.abs(cumulative));
      zeroGex = prevStrike + t * (s.strike - prevStrike);
      found   = true;
    }

    prevCum    = cumulative;
    prevStrike = s.strike;
  }

  return {
    zeroGex,
    callWall,
    putWall,
    netGexBillions: netGexTotal / 1e9,
    byStrike,
  };
}
