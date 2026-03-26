/**
 * wave-rules.ts
 *
 * Generates all valid Elliott Wave impulse counts from a pivot array.
 *
 * Strategy:
 *   - Slide a 6-pivot window across the pivot array (6 pivots = complete
 *     5-wave impulse: P0 start, P1 W1-end, P2 W2-end, P3 W3-end,
 *     P4 W4-end, P5 W5-end).
 *   - For each window, verify:
 *       a. Pivots strictly alternate high ↔ low.
 *       b. All four EW hard rules hold.
 *   - Invalid windows are silently discarded.
 *   - Returns all valid WaveCount objects (up to 8); the probability engine
 *     trims to the top 4 after scoring.
 *
 * Hard rules enforced (per spec EW_RULES):
 *   1. Wave 2 retracement ≤ 100% of Wave 1.
 *   2. Wave 3 is NOT the shortest of {W1, W3, W5}.
 *   3. Wave 4 low does NOT enter Wave 1 high territory (no overlap).
 *   4. Alternation: Wave 2 and Wave 4 must differ in depth
 *      (one sharp >50%, the other flat <50%).
 */

import type {
  Pivot,
  WaveCount,
  WaveNode,
  WavePosterior,
  WaveDegree,
} from './types';

// ── Helpers ───────────────────────────────────────────────────────────────────

function isHighPivot(p: Pivot): boolean {
  return p.type === 'HH' || p.type === 'LH';
}

/** Simple deterministic ID — no external dep needed. */
function makeCountId(
  ticker: string,
  tf: string,
  startIdx: number,
  endIdx: number,
): string {
  return `${ticker}:${tf}:${startIdx}-${endIdx}`;
}

// ── Wave measurement ──────────────────────────────────────────────────────────

interface WaveMeasurements {
  w1: number;           // absolute length of Wave 1
  w2: number;           // absolute retrace of Wave 2
  w3: number;           // absolute length of Wave 3
  w4: number;           // absolute retrace of Wave 4
  w5: number;           // absolute length of Wave 5
  w2RetracePct: number; // w2 / w1  (fraction, 0-1+)
  w4RetracePct: number; // w4 / w3
}

function measure(prices: number[], isBullish: boolean): WaveMeasurements {
  const [p0, p1, p2, p3, p4, p5] = prices;

  let w1: number, w2: number, w3: number, w4: number, w5: number;

  if (isBullish) {
    // P0 low → P1 high → P2 low → P3 high → P4 low → P5 high
    w1 = p1 - p0;
    w2 = p1 - p2;  // retrace amount (positive when P2 < P1)
    w3 = p3 - p2;
    w4 = p3 - p4;  // retrace amount (positive when P4 < P3)
    w5 = p5 - p4;
  } else {
    // P0 high → P1 low → P2 high → P3 low → P4 high → P5 low
    w1 = p0 - p1;
    w2 = p2 - p1;  // retrace amount (positive when P2 > P1)
    w3 = p2 - p3;
    w4 = p4 - p3;  // retrace amount (positive when P4 > P3)
    w5 = p4 - p5;
  }

  return {
    w1, w2, w3, w4, w5,
    w2RetracePct: w1 > 0 ? w2 / w1 : Infinity,
    w4RetracePct: w3 > 0 ? w4 / w3 : Infinity,
  };
}

// ── EW rule checks ────────────────────────────────────────────────────────────

function checkRules(
  pivots: Pivot[],
  isBullish: boolean,
): string[] {
  const violations: string[] = [];
  const prices = pivots.map((p) => p.price);
  const m = measure(prices, isBullish);
  const [_p0, p1, _p2, _p3, p4] = prices;

  // Require positive wave lengths — structural validity gate
  if (m.w1 <= 0 || m.w2 <= 0 || m.w3 <= 0 || m.w4 <= 0 || m.w5 <= 0) {
    violations.push('STRUCTURE: one or more wave lengths are non-positive');
    return violations; // no point checking further
  }

  // Rule 1 — Wave 2 ≤ 100% retracement of Wave 1
  if (m.w2RetracePct > 1.0) {
    violations.push(
      `RULE1: Wave 2 retraces ${(m.w2RetracePct * 100).toFixed(1)}% of Wave 1 (max 100%)`,
    );
  }

  // Rule 2 — Wave 3 not the shortest impulse wave
  const shortest = Math.min(m.w1, m.w3, m.w5);
  if (m.w3 <= shortest + 1e-9) {
    violations.push(
      `RULE2: Wave 3 (${m.w3.toFixed(3)}) is the shortest of [${m.w1.toFixed(3)}, ${m.w3.toFixed(3)}, ${m.w5.toFixed(3)}]`,
    );
  }

  // Rule 3 — Wave 4 no overlap with Wave 1 price territory
  if (isBullish) {
    // P4 (Wave 4 low) must be above P1 (Wave 1 high)
    if (p4 <= p1) {
      violations.push(
        `RULE3: Wave 4 low (${p4.toFixed(3)}) overlaps Wave 1 high (${p1.toFixed(3)})`,
      );
    }
  } else {
    // P4 (Wave 4 high) must be below P1 (Wave 1 low)
    if (p4 >= p1) {
      violations.push(
        `RULE3: Wave 4 high (${p4.toFixed(3)}) overlaps Wave 1 low (${p1.toFixed(3)})`,
      );
    }
  }

  // Rule 4 — Alternation: Wave 2 sharp ↔ Wave 4 flat
  const w2Sharp = m.w2RetracePct > 0.5;
  const w4Sharp = m.w4RetracePct > 0.5;
  if (w2Sharp === w4Sharp) {
    const label = w2Sharp ? 'sharp (>50%)' : 'flat (<50%)';
    violations.push(
      `RULE4: No alternation — both Wave 2 (${(m.w2RetracePct * 100).toFixed(1)}%) and Wave 4 (${(m.w4RetracePct * 100).toFixed(1)}%) are ${label}`,
    );
  }

  return violations;
}

// ── WaveCount builder ─────────────────────────────────────────────────────────

function buildWaveNode(
  label: WaveNode['label'],
  start: Pivot,
  end: Pivot | null,
  structure: WaveNode['structure'],
  degree: WaveDegree,
): WaveNode {
  return { label, degree, structure, startPivot: start, endPivot: end, subwaves: [] };
}

function buildWaveCount(
  pivots: Pivot[],
  isBullish: boolean,
  ticker: string,
  timeframe: string,
): WaveCount {
  const prices = pivots.map((p) => p.price);
  const m = measure(prices, isBullish);
  const [p0, p1, p2, _p3, p4, _p5] = prices;
  const degree: WaveDegree = 'minor';

  const w2Sharp = m.w2RetracePct > 0.5;
  const w4Sharp = m.w4RetracePct > 0.5;

  const allWaves: WaveNode[] = [
    buildWaveNode('1', pivots[0], pivots[1], 'impulse', degree),
    buildWaveNode('2', pivots[1], pivots[2], w2Sharp ? 'zigzag' : 'flat', degree),
    buildWaveNode('3', pivots[2], pivots[3], 'impulse', degree),
    buildWaveNode('4', pivots[3], pivots[4], w4Sharp ? 'zigzag' : 'flat', degree),
    buildWaveNode('5', pivots[4], pivots[5] ?? null, 'impulse', degree),
  ];

  const currentWave = allWaves[allWaves.length - 1];

  // Fibonacci extension targets projected from Wave 2 end (start of Wave 3)
  // using Wave 1 length as the unit
  const dir = isBullish ? 1 : -1;
  const w1Len = Math.abs(p1 - p0);
  const anchorPrice = isBullish ? p2 : p2; // W3 starts at P2
  const targets: [number, number, number] = [
    anchorPrice + dir * w1Len * 1.618,
    anchorPrice + dir * w1Len * 2.618,
    anchorPrice + dir * w1Len * 4.236,
  ];

  // Stop price: just beyond Wave 2 end (the Elliott invalidation level)
  const buffer = w1Len * 0.05;
  const stopPrice = isBullish ? p2 - buffer : p2 + buffer;

  // R/R relative to Wave 4 end (natural trade entry point)
  const riskPerUnit = Math.abs(p4 - stopPrice);
  const rewardUnit = Math.abs(targets[0] - p4);
  const rrRatio = riskPerUnit > 0 ? rewardUnit / riskPerUnit : 0;

  const now = Date.now();
  const id = makeCountId(ticker, timeframe, pivots[0].index, pivots[5].index);

  // Invalidation at Wave 2 end (if bullish count and price breaks below P2,
  // the Wave 2 → Wave 3 narrative is invalid)
  const invalidationPrice = isBullish ? p2 : p2;
  const ciWidth = w1Len * 0.3;
  const confidence_interval: [number, number] = [
    targets[0] - ciWidth,
    targets[0] + ciWidth,
  ];

  const posterior: WavePosterior = {
    countId: id,
    prior: 0.25,
    posterior: 0.25,
    likelihood_components: {
      fib_confluence: 0.5,
      volume_profile: 0.5,
      rsi_divergence: 0.5,
      momentum_alignment: 0.5,
      breadth_alignment: 0.5,
      gex_alignment: 0.5,
      mtf_alignment: 0.5,
      time_symmetry: 0.5,
    },
    decay_factor: 1.0,
    last_updated: now,
    invalidation_price: invalidationPrice,
    confidence_interval,
  };

  return {
    id,
    ticker,
    timeframe,
    degree,
    currentWave,
    allWaves,
    posterior,
    targets,
    stopPrice,
    rrRatio,
    isValid: true,
    violations: [],
    createdAt: now,
    updatedAt: now,
  };
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Generate all valid Elliott Wave impulse counts from the pivot array.
 *
 * Slides a 6-pivot window (= complete 5-wave impulse) across the pivots,
 * applies the four hard EW rules, and returns surviving counts.
 *
 * @param pivots    Alternating high/low Pivot array (from detectPivots)
 * @param ticker    Instrument ticker symbol
 * @param timeframe Timeframe label (e.g. '5m', '1h')
 * @returns         All valid WaveCount objects, up to 8
 */
export function generateWaveCounts(
  pivots: Pivot[],
  ticker: string,
  timeframe: string,
): WaveCount[] {
  const valid: WaveCount[] = [];
  const seen = new Set<string>();

  for (let start = 0; start + 5 < pivots.length; start++) {
    const window = pivots.slice(start, start + 6);

    // Verify strict alternation: each pivot must be opposite polarity to the next
    let alternates = true;
    for (let i = 0; i < window.length - 1; i++) {
      if (isHighPivot(window[i]) === isHighPivot(window[i + 1])) {
        alternates = false;
        break;
      }
    }
    if (!alternates) continue;

    // Determine impulse direction from the first pivot's polarity
    const isBullish = !isHighPivot(window[0]); // bullish starts at a low

    const violations = checkRules(window, isBullish);
    if (violations.length > 0) continue;

    const count = buildWaveCount(window, isBullish, ticker, timeframe);

    if (!seen.has(count.id)) {
      seen.add(count.id);
      valid.push(count);
    }
  }

  return valid.slice(0, 8);
}

// ── Exported helpers used by tests ────────────────────────────────────────────

export { checkRules, measure as measureWaves, isHighPivot };
