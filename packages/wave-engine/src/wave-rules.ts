/**
 * wave-rules.ts
 *
 * Generates all valid Elliott Wave impulse and diagonal counts from a pivot
 * array.
 *
 * Strategy:
 *   - Slide a 6-pivot window across the pivot array (6 pivots = complete
 *     5-wave structure: P0 start, P1 W1-end, P2 W2-end, P3 W3-end,
 *     P4 W4-end, P5 W5-end).
 *   - For each window, verify:
 *       a. Pivots strictly alternate high ↔ low.
 *       b. All four EW hard rules hold (impulse path).
 *   - Hard violations from Rule 3 only → attempt diagonal detection.
 *   - Soft rules (W3 extension, W5 typical extension) annotated as warnings.
 *   - Returns all valid WaveCount objects (up to 8); the probability engine
 *     trims to the top 4 after scoring.
 *
 * Hard rules (per spec EW_RULES):
 *   1. Wave 2 retracement ≤ 100% of Wave 1.
 *   2. Wave 3 is NOT the shortest of {W1, W3, W5}.
 *   3. Wave 4 low does NOT enter Wave 1 high territory (no overlap).
 *      Exception: diagonal triangles — detected via tryBuildDiagonal.
 *   4. Alternation: Wave 2 and Wave 4 must differ in depth
 *      (one sharp >50%, the other flat <50%).
 *
 * Soft rules (annotated in softWarnings, do not reject):
 *   5. Wave 3 ≥ 1.0× Wave 1 (scored down if violated).
 *   6. Wave 5 ≈ 0.618× Wave 1 (scoring bonus when met).
 */

import type {
  Pivot,
  WaveCount,
  WaveNode,
  WavePosterior,
  WaveDegree,
} from './types';

// ── Degree inference ──────────────────────────────────────────────────────────

const DEGREE_BY_TF: Readonly<Record<string, WaveDegree>> = {
  '1m':  'minuette',
  '5m':  'minute',
  '15m': 'minute',
  '30m': 'minor',
  '1h':  'minor',
  '4h':  'intermediate',
  '1D':  'primary',
  '1W':  'cycle',
};

function degreeForTimeframe(tf: string): WaveDegree {
  return DEGREE_BY_TF[tf] ?? 'minor';
}

// ── Helpers ───────────────────────────────────────────────────────────────────

export function isHighPivot(p: Pivot): boolean {
  return p.type === 'HH' || p.type === 'LH';
}

/** Simple deterministic ID — no external dep needed. */
function makeCountId(
  ticker: string,
  tf: string,
  startIdx: number,
  endIdx: number,
  suffix = '',
): string {
  return `${ticker}:${tf}:${startIdx}-${endIdx}${suffix}`;
}

// ── Wave measurement ──────────────────────────────────────────────────────────

export interface WaveMeasurements {
  w1: number;           // absolute length of Wave 1
  w2: number;           // absolute retrace of Wave 2
  w3: number;           // absolute length of Wave 3
  w4: number;           // absolute retrace of Wave 4
  w5: number;           // absolute length of Wave 5
  w2RetracePct: number; // w2 / w1  (fraction, 0-1+)
  w4RetracePct: number; // w4 / w3
}

export function measureWaves(prices: number[], isBullish: boolean): WaveMeasurements {
  const [p0, p1, p2, p3, p4, p5] = prices;

  let w1: number, w2: number, w3: number, w4: number, w5: number;

  if (isBullish) {
    // P0 low → P1 high → P2 low → P3 high → P4 low → P5 high
    w1 = p1 - p0;
    w2 = p1 - p2;
    w3 = p3 - p2;
    w4 = p3 - p4;
    w5 = p5 - p4;
  } else {
    // P0 high → P1 low → P2 high → P3 low → P4 high → P5 low
    w1 = p0 - p1;
    w2 = p2 - p1;
    w3 = p2 - p3;
    w4 = p4 - p3;
    w5 = p4 - p5;
  }

  return {
    w1, w2, w3, w4, w5,
    w2RetracePct: w1 > 0 ? w2 / w1 : Infinity,
    w4RetracePct: w3 > 0 ? w4 / w3 : Infinity,
  };
}

// ── Hard EW rule checks ───────────────────────────────────────────────────────

/**
 * Returns hard rule violation strings.
 * A non-empty result means the window should be discarded as a regular impulse.
 * (Rule 3 violations alone may still qualify as a diagonal — see tryBuildDiagonal.)
 */
export function checkRules(
  pivots: Pivot[],
  isBullish: boolean,
): string[] {
  const violations: string[] = [];
  const prices = pivots.map((p) => p.price);
  const m = measureWaves(prices, isBullish);
  const [_p0, p1, _p2, _p3, p4] = prices;

  // Structural validity gate — must have positive wave lengths
  if (m.w1 <= 0 || m.w2 <= 0 || m.w3 <= 0 || m.w4 <= 0 || m.w5 <= 0) {
    violations.push('STRUCTURE: one or more wave lengths are non-positive');
    return violations;
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
    if (p4 <= p1) {
      violations.push(
        `RULE3: Wave 4 low (${p4.toFixed(3)}) overlaps Wave 1 high (${p1.toFixed(3)})`,
      );
    }
  } else {
    if (p4 >= p1) {
      violations.push(
        `RULE3: Wave 4 high (${p4.toFixed(3)}) overlaps Wave 1 low (${p1.toFixed(3)})`,
      );
    }
  }

  // Rule 4 moved to checkSoftRules — alternation is common to violate in real markets

  return violations;
}

// ── Soft rule checks ──────────────────────────────────────────────────────────

/**
 * Returns soft rule warnings.
 * These do NOT reject the count but lower its probability score.
 */
export function checkSoftRules(
  pivots: Pivot[],
  isBullish: boolean,
): string[] {
  const warnings: string[] = [];
  const prices = pivots.map((p) => p.price);
  const m = measureWaves(prices, isBullish);

  if (m.w1 <= 0 || m.w3 <= 0) return warnings;

  // Soft rule 5: Wave 3 should extend at least 100% of Wave 1
  if (m.w3 < m.w1) {
    warnings.push(
      `SOFT:W3_EXTENSION: Wave 3 (${m.w3.toFixed(3)}) < Wave 1 (${m.w1.toFixed(3)}) — extension rule not met`,
    );
  }

  // Soft rule 6: Wave 5 ≈ 0.618× Wave 1 (annotate when close; no warning for miss)
  const w5Ratio = m.w5 / m.w1;
  const FIB618_TOL = 0.05;
  if (Math.abs(w5Ratio - 0.618) <= FIB618_TOL) {
    // Positive note — not a warning, just informational
    warnings.push(
      `SOFT:W5_FIB618: Wave 5 ≈ 0.618× Wave 1 (ratio ${w5Ratio.toFixed(3)}) — classic target`,
    );
  }

  // Rule 4 (soft): Alternation — W2 and W4 should differ in retracement depth
  if (m.w1 > 0 && m.w3 > 0) {
    const w2Sharp = m.w2RetracePct > 0.5;
    const w4Sharp = m.w4RetracePct > 0.5;
    if (w2Sharp === w4Sharp) {
      const lbl = w2Sharp ? 'sharp (>50%)' : 'flat (<50%)';
      warnings.push(
        `SOFT:RULE4_ALTERNATION: Both W2 (${(m.w2RetracePct * 100).toFixed(1)}%) and W4 (${(m.w4RetracePct * 100).toFixed(1)}%) are ${lbl}`,
      );
    }
  }

  return warnings;
}

// ── WaveNode builder ──────────────────────────────────────────────────────────

function buildWaveNode(
  label: WaveNode['label'],
  start: Pivot,
  end: Pivot | null,
  structure: WaveNode['structure'],
  degree: WaveDegree,
): WaveNode {
  return { label, degree, structure, startPivot: start, endPivot: end, subwaves: [] };
}

// ── Shared posterior/target builder ──────────────────────────────────────────

function buildPosteriorAndTargets(
  prices: number[],
  isBullish: boolean,
  id: string,
): {
  posterior: WavePosterior;
  targets: [number, number, number];
  stopPrice: number;
  rrRatio: number;
} {
  const [p0, p1, p2, _p3, p4] = prices;

  const dir = isBullish ? 1 : -1;
  const w1Len = Math.abs(p1 - p0);
  const anchorPrice = p2; // Wave 3 starts at P2
  const targets: [number, number, number] = [
    anchorPrice + dir * w1Len * 1.618,
    anchorPrice + dir * w1Len * 2.618,
    anchorPrice + dir * w1Len * 4.236,
  ];

  const buffer = w1Len * 0.05;
  const stopPrice = isBullish ? p2 - buffer : p2 + buffer;

  const riskPerUnit = Math.abs(p4 - stopPrice);
  const rewardUnit = Math.abs(targets[0] - p4);
  const rrRatio = riskPerUnit > 0 ? rewardUnit / riskPerUnit : 0;

  const invalidationPrice = p2;
  const ciWidth = w1Len * 0.3;
  const confidence_interval: [number, number] = [
    targets[0] - ciWidth,
    targets[0] + ciWidth,
  ];

  const now = Date.now();
  const posterior: WavePosterior = {
    countId: id,
    prior: 0.25,
    posterior: 0.25,
    likelihood_components: {
      fib_confluence:     0.5,
      volume_profile:     0.5,
      rsi_divergence:     0.5,
      momentum_alignment: 0.5,
      breadth_alignment:  0.5,
      gex_alignment:      0.5,
      mtf_alignment:      0.5,
      time_symmetry:      0.5,
    },
    decay_factor: 1.0,
    last_updated: now,
    invalidation_price: invalidationPrice,
    confidence_interval,
    mtf_conflict: false,
  };

  return { posterior, targets, stopPrice, rrRatio };
}

// ── WaveCount builder (impulse) ───────────────────────────────────────────────

function buildWaveCount(
  pivots: Pivot[],
  isBullish: boolean,
  ticker: string,
  timeframe: string,
  softViolations: string[],
): WaveCount {
  const prices = pivots.map((p) => p.price);
  const m = measureWaves(prices, isBullish);
  const degree = degreeForTimeframe(timeframe);

  const w2Sharp = m.w2RetracePct > 0.5;
  const w4Sharp = m.w4RetracePct > 0.5;

  const allWaves: WaveNode[] = [
    buildWaveNode('1', pivots[0], pivots[1], 'impulse', degree),
    buildWaveNode('2', pivots[1], pivots[2], w2Sharp ? 'zigzag' : 'flat', degree),
    buildWaveNode('3', pivots[2], pivots[3], 'impulse', degree),
    buildWaveNode('4', pivots[3], pivots[4], w4Sharp ? 'zigzag' : 'flat', degree),
    buildWaveNode('5', pivots[4], pivots[5] ?? null, 'impulse', degree),
  ];

  const now = Date.now();
  const id = makeCountId(ticker, timeframe, pivots[0].index, pivots[5].index);
  const { posterior, targets, stopPrice, rrRatio } = buildPosteriorAndTargets(
    prices, isBullish, id,
  );

  return {
    id,
    ticker,
    timeframe,
    degree,
    currentWave: allWaves[allWaves.length - 1],
    allWaves,
    posterior,
    targets,
    stopPrice,
    rrRatio,
    isValid: true,
    violations: [],
    softWarnings: softViolations,
    createdAt: now,
    updatedAt: now,
  };
}

// ── Diagonal detection ────────────────────────────────────────────────────────

/**
 * Attempts to build an ending/leading diagonal WaveCount from a pivot window
 * that failed Rule 3 (Wave 4 overlaps Wave 1 territory).
 *
 * Diagonal validity conditions:
 *   - All five waves have positive length.
 *   - Overall direction maintained (P5 higher than P0 for bull).
 *   - Wave 3 < Wave 1 (converging — a mandatory wedge property).
 *   - Wave 2 still retraces ≤ 100% of Wave 1.
 *
 * Returns null if the window does not qualify as a diagonal.
 */
export function tryBuildDiagonal(
  pivots: Pivot[],
  isBullish: boolean,
  ticker: string,
  timeframe: string,
  softViolations: string[],
): WaveCount | null {
  const prices = pivots.map((p) => p.price);
  const m = measureWaves(prices, isBullish);
  const [p0, , , , , p5] = prices;

  // All waves must have positive length
  if (m.w1 <= 0 || m.w2 <= 0 || m.w3 <= 0 || m.w4 <= 0 || m.w5 <= 0) return null;

  // Overall trend must be maintained (P5 beyond P0 in impulse direction)
  const overallBull = p5 > p0;
  if (overallBull !== isBullish) return null;

  // Wave 3 < Wave 1 — converging (required for both leading and ending diagonal)
  if (m.w3 >= m.w1) return null;

  // Wave 2 still can't retrace more than Wave 1
  if (m.w2RetracePct > 1.0) return null;

  const degree = degreeForTimeframe(timeframe);
  const w2Sharp = m.w2RetracePct > 0.5;
  const w4Sharp = m.w4RetracePct > 0.5;

  // Strictly converging (W5 < W3 < W1) → ending diagonal
  // Otherwise → leading diagonal
  const strictlyConverging = m.w5 < m.w3;
  const diagStructure = strictlyConverging ? 'ending_diagonal' : 'leading_diagonal';

  const allWaves: WaveNode[] = [
    buildWaveNode('1', pivots[0], pivots[1], diagStructure, degree),
    buildWaveNode('2', pivots[1], pivots[2], w2Sharp ? 'zigzag' : 'flat', degree),
    buildWaveNode('3', pivots[2], pivots[3], diagStructure, degree),
    buildWaveNode('4', pivots[3], pivots[4], w4Sharp ? 'zigzag' : 'flat', degree),
    buildWaveNode('5', pivots[4], pivots[5] ?? null, diagStructure, degree),
  ];

  const now = Date.now();
  const id = makeCountId(ticker, timeframe, pivots[0].index, pivots[5].index, ':diag');
  const { posterior, targets, stopPrice, rrRatio } = buildPosteriorAndTargets(
    prices, isBullish, id,
  );

  return {
    id,
    ticker,
    timeframe,
    degree,
    currentWave: allWaves[allWaves.length - 1],
    allWaves,
    posterior,
    targets,
    stopPrice,
    rrRatio,
    isValid: true,
    violations: [],
    softWarnings: [
      `DIAGONAL:${diagStructure.toUpperCase()}: Wave 4 overlaps Wave 1 territory (valid for diagonal structure)`,
      ...softViolations,
    ],
    createdAt: now,
    updatedAt: now,
  };
}

// ── Partial (in-progress) count builder ──────────────────────────────────────

/**
 * Attempts to build an in-progress WaveCount from a trailing 3–5 pivot window.
 *
 * k=3 → W1 + W2 complete, currently in Wave 3
 * k=4 → W1-W3 complete, currently in Wave 4
 * k=5 → W1-W4 complete, currently in Wave 5
 *
 * Returns null if the minimal validity constraints aren't met.
 */
function buildPartialCount(
  pivots: Pivot[],
  isBullish: boolean,
  ticker: string,
  timeframe: string,
): WaveCount | null {
  const k = pivots.length;
  if (k < 3 || k > 5) return null;

  const prices = pivots.map((p) => p.price);
  const degree = degreeForTimeframe(timeframe);

  // Validate completed waves
  if (isBullish) {
    if (prices[1] <= prices[0]) return null;                          // W1 must go up
    if (k >= 3 && prices[2] >= prices[1]) return null;               // W2 must retrace
    if (k >= 3 && prices[2] < prices[0]) return null;                // W2 ≤ 100% of W1
    if (k >= 4 && prices[3] <= prices[2]) return null;               // W3 must go up
    if (k >= 5 && prices[4] >= prices[3]) return null;               // W4 must retrace
    if (k >= 5 && prices[4] <= prices[1]) return null;               // W4 no overlap W1
  } else {
    if (prices[1] >= prices[0]) return null;
    if (k >= 3 && prices[2] <= prices[1]) return null;
    if (k >= 3 && prices[2] > prices[0]) return null;
    if (k >= 4 && prices[3] >= prices[2]) return null;
    if (k >= 5 && prices[4] <= prices[3]) return null;
    if (k >= 5 && prices[4] >= prices[1]) return null;
  }

  const waveLabels: Array<WaveNode['label']> = ['1', '2', '3', '4', '5'];
  const impulseLabels = new Set(['1', '3', '5']);

  const allWaves: WaveNode[] = [];

  // Build completed waves (pivots[i] → pivots[i+1])
  for (let i = 0; i < k - 1; i++) {
    const label = waveLabels[i];
    const retracePct = i > 0 && i < k - 1
      ? Math.abs(prices[i] - prices[i - 1]) / Math.abs(prices[i - 1] - prices[i - 2] || 1)
      : 0;
    const structure: WaveNode['structure'] = impulseLabels.has(label)
      ? 'impulse'
      : (retracePct > 0.5 ? 'zigzag' : 'flat');
    allWaves.push(buildWaveNode(label, pivots[i], pivots[i + 1], structure, degree));
  }

  // Add the in-progress wave (no endPivot)
  const inProgressLabel = waveLabels[k - 1];
  const inProgressStructure: WaveNode['structure'] = impulseLabels.has(inProgressLabel) ? 'impulse' : 'zigzag';
  allWaves.push(buildWaveNode(inProgressLabel, pivots[k - 1], null, inProgressStructure, degree));

  const now = Date.now();
  const w1Len = Math.abs(prices[1] - prices[0]);
  const dir = isBullish ? 1 : -1;
  const anchor = prices[k - 1];
  const targets: [number, number, number] = [
    anchor + dir * w1Len * 1.618,
    anchor + dir * w1Len * 2.618,
    anchor + dir * w1Len * 4.236,
  ];

  const id = makeCountId(ticker, timeframe, pivots[0].index, pivots[k - 1].index, `:p${k}`);
  const stopPrice = isBullish ? prices[0] - w1Len * 0.05 : prices[0] + w1Len * 0.05;
  const riskPerUnit = Math.abs(anchor - stopPrice);
  const rewardUnit  = Math.abs(targets[0] - anchor);
  const rrRatio = riskPerUnit > 0 ? rewardUnit / riskPerUnit : 0;
  const ciWidth = w1Len * 0.3;

  const posterior: WavePosterior = {
    countId: id,
    prior: 0.25,
    posterior: 0.25,
    likelihood_components: {
      fib_confluence: 0.5, volume_profile: 0.5, rsi_divergence: 0.5,
      momentum_alignment: 0.5, breadth_alignment: 0.5, gex_alignment: 0.5,
      mtf_alignment: 0.5, time_symmetry: 0.5,
    },
    decay_factor: 1.0,
    last_updated: now,
    invalidation_price: prices[0],
    confidence_interval: [targets[0] - ciWidth, targets[0] + ciWidth],
    mtf_conflict: false,
  };

  return {
    id,
    ticker,
    timeframe,
    degree,
    currentWave: allWaves[allWaves.length - 1],
    allWaves,
    posterior,
    targets,
    stopPrice,
    rrRatio,
    isValid: true,
    violations: [],
    softWarnings: [`PARTIAL:WAVE${inProgressLabel}_FORMING`],
    createdAt: now,
    updatedAt: now,
  };
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Generate all valid Elliott Wave counts (impulse + diagonal) from the pivot
 * array.
 *
 * Slides a 6-pivot window (= complete 5-wave structure) across the pivots,
 * applies the four hard EW rules for impulse counts, and falls back to
 * diagonal detection when only Rule 3 fails.
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

    const hardViolations = checkRules(window, isBullish);
    const softViolations = checkSoftRules(window, isBullish);

    if (hardViolations.length === 0) {
      // Valid impulse count
      const count = buildWaveCount(window, isBullish, ticker, timeframe, softViolations);
      if (!seen.has(count.id)) {
        seen.add(count.id);
        valid.push(count);
      }
    } else {
      // Only Rule 3 failing → check for diagonal structure
      const nonRule3 = hardViolations.filter((v) => !v.startsWith('RULE3'));
      const hasRule3 = hardViolations.some((v) => v.startsWith('RULE3'));

      if (hasRule3 && nonRule3.length === 0) {
        const diag = tryBuildDiagonal(window, isBullish, ticker, timeframe, softViolations);
        if (diag && !seen.has(diag.id)) {
          seen.add(diag.id);
          valid.push(diag);
        }
      }
    }
  }

  // ── Trailing partial counts (in-progress wave detection) ─────────────────────
  // Try the most recent 5, 4, or 3 pivots to detect what wave is forming now.
  // Only add the longest valid partial count (stops at first success).
  for (const k of [5, 4, 3]) {
    if (pivots.length < k) continue;
    const tail = pivots.slice(-k);

    // Must alternate
    let tailAlternates = true;
    for (let i = 0; i < tail.length - 1; i++) {
      if (isHighPivot(tail[i]) === isHighPivot(tail[i + 1])) {
        tailAlternates = false;
        break;
      }
    }
    if (!tailAlternates) continue;

    const isBull = !isHighPivot(tail[0]);
    const partial = buildPartialCount(tail, isBull, ticker, timeframe);
    if (partial && !seen.has(partial.id)) {
      seen.add(partial.id);
      valid.push(partial);
      break; // one partial count is enough
    }
  }

  return valid.slice(0, 8);
}

// ── Exported helpers used by tests ────────────────────────────────────────────

export { degreeForTimeframe };
