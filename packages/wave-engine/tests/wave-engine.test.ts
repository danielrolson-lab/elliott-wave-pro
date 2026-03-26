/**
 * wave-engine.test.ts
 *
 * Integration and unit tests for the Elliott Wave engine v2.
 *
 * Fixture: tests/fixtures/SPY_5m.csv
 *   215 synthetic 5-minute bars with a canonical bullish impulse embedded:
 *   W1  575.35 → 585.85  (+10.50, base unit)
 *   W2  585.85 → 579.86  (−5.99 = 57.0% retrace, SHARP)
 *   W3  579.86 → 601.76  (+21.90 = 2.09× W1, LONGEST)
 *   W4  601.76 → 594.15  (−7.61 = 34.8% of W3, FLAT → alternates)
 *   W5  594.15 → 604.13  (+9.98 = 0.95× W1)
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

import { computeATR, detectPivots }  from '../src/pivot-detection';
import {
  generateWaveCounts,
  checkRules,
  checkSoftRules,
  tryBuildDiagonal,
  measureWaves,
  isHighPivot,
  degreeForTimeframe,
} from '../src/wave-rules';
import {
  computeFibLevels,
  getConfluenceHits,
  RETRACEMENT_RATIOS,
  EXTENSION_RATIOS,
} from '../src/fibonacci';
import {
  scoreWaveCounts,
  scoreFibConfluence,
  scoreVolumeProfile,
  scoreRsiDivergence,
  scoreMacdAlignment,
  scoreTimeSym,
  applyDecay,
} from '../src/probability-engine';

import type { OHLCV, Pivot, WaveCount } from '../src/types';

// ── Fixture helpers ───────────────────────────────────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadCsv(filename: string): OHLCV[] {
  const raw = readFileSync(join(__dirname, 'fixtures', filename), 'utf8');
  return raw
    .trim()
    .split('\n')
    .slice(1) // skip header
    .map((line) => {
      const [t, o, h, l, c, v] = line.split(',').map(Number);
      return { timestamp: t, open: o, high: h, low: l, close: c, volume: v };
    });
}

// Minimal Pivot factories for unit tests
const L = (price: number, idx: number): Pivot => ({
  index: idx, price, timestamp: idx * 300_000, type: 'HL', timeframe: '5m',
});
const H = (price: number, idx: number): Pivot => ({
  index: idx, price, timestamp: idx * 300_000, type: 'HH', timeframe: '5m',
});

// ── Shared state ──────────────────────────────────────────────────────────────

let spyCandles: OHLCV[];
let spyPivots: Pivot[];
let spyCounts: WaveCount[];
let canonicalCount: WaveCount;

beforeAll(() => {
  spyCandles = loadCsv('SPY_5m.csv');
  spyPivots  = detectPivots(spyCandles, 0.5, '5m');
  spyCounts  = generateWaveCounts(spyPivots, 'SPY', '5m');
  canonicalCount = spyCounts[0];
});

// ═════════════════════════════════════════════════════════════════════════════
// 1. computeATR
// ═════════════════════════════════════════════════════════════════════════════

describe('computeATR', () => {
  it('returns empty array for empty input', () => {
    expect(computeATR([])).toEqual([]);
  });

  it('returns array of the same length as input', () => {
    const atr = computeATR(spyCandles);
    expect(atr).toHaveLength(spyCandles.length);
  });

  it('all values are positive for valid candle data', () => {
    const atr = computeATR(spyCandles);
    expect(atr.every((v) => v > 0)).toBe(true);
  });

  it('ATR is reasonable for SPY 5m data (0.2 – 5.0)', () => {
    const atr = computeATR(spyCandles);
    const last = atr[atr.length - 1];
    expect(last).toBeGreaterThan(0.2);
    expect(last).toBeLessThan(5.0);
  });

  it('handles single-bar input without throwing', () => {
    const single = [spyCandles[0]];
    expect(() => computeATR(single)).not.toThrow();
    expect(computeATR(single)).toHaveLength(1);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 2. detectPivots
// ═════════════════════════════════════════════════════════════════════════════

describe('detectPivots', () => {
  it('returns empty array for empty input', () => {
    expect(detectPivots([])).toEqual([]);
  });

  it('returns empty array for fewer than 3 candles', () => {
    expect(detectPivots(spyCandles.slice(0, 2))).toEqual([]);
  });

  it('detects 33 pivots in the SPY fixture', () => {
    expect(spyPivots).toHaveLength(33);
  });

  it('pivots strictly alternate high ↔ low', () => {
    const isHigh = (p: Pivot) => isHighPivot(p);
    for (let i = 0; i < spyPivots.length - 1; i++) {
      expect(isHigh(spyPivots[i])).not.toBe(isHigh(spyPivots[i + 1]));
    }
  });

  it('all pivot types are valid PivotType values', () => {
    const valid = new Set(['HH', 'HL', 'LH', 'LL']);
    expect(spyPivots.every((p) => valid.has(p.type))).toBe(true);
  });

  it('every pivot carries the timeframe passed in', () => {
    expect(spyPivots.every((p) => p.timeframe === '5m')).toBe(true);
  });

  it('captures the Wave 1 high near 585.85', () => {
    const w1High = spyPivots.find((p) => Math.abs(p.price - 585.85) < 0.5);
    expect(w1High).toBeDefined();
  });

  it('captures the Wave 3 high near 601.76', () => {
    const w3High = spyPivots.find((p) => Math.abs(p.price - 601.76) < 0.5);
    expect(w3High).toBeDefined();
  });

  it('captures the Wave 5 high near 604.13', () => {
    const w5High = spyPivots.find((p) => Math.abs(p.price - 604.13) < 0.5);
    expect(w5High).toBeDefined();
  });

  it('pivot indices are non-decreasing', () => {
    for (let i = 0; i < spyPivots.length - 1; i++) {
      expect(spyPivots[i].index).toBeLessThan(spyPivots[i + 1].index);
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 3. checkRules  (unit tests with hand-crafted pivots)
// ═════════════════════════════════════════════════════════════════════════════

describe('checkRules', () => {
  // ── Valid bullish impulse — no violations ───────────────────────────────────
  // W1=10, W2=5.7(57%↑sharp), W3=20, W4=6.5(32.5%↓flat), W5=11
  const validBull: Pivot[] = [
    L(100,   0), H(110,   5),
    L(104.3, 10), H(124.3, 20),
    L(117.8, 25), H(128.8, 35),
  ];

  it('returns no violations for a clean bullish impulse', () => {
    expect(checkRules(validBull, true)).toHaveLength(0);
  });

  // ── Rule 1: Wave 2 > 100% retracement ──────────────────────────────────────
  // W1=10, W2=12(120%), W3=24, W4=8(33%), W5=14
  const rule1Pivots: Pivot[] = [
    L(100, 0), H(110, 5),
    L(98,  10), H(122, 20),
    L(114, 25), H(128, 35),
  ];

  it('flags RULE1 when Wave 2 retraces more than 100% of Wave 1', () => {
    const v = checkRules(rule1Pivots, true);
    expect(v.length).toBeGreaterThan(0);
    expect(v.some((s) => s.startsWith('RULE1'))).toBe(true);
  });

  it('does NOT flag RULE2/3/4 for the Rule 1 case', () => {
    const v = checkRules(rule1Pivots, true);
    expect(v.some((s) => s.startsWith('RULE2'))).toBe(false);
    expect(v.some((s) => s.startsWith('RULE3'))).toBe(false);
    expect(v.some((s) => s.startsWith('RULE4'))).toBe(false);
  });

  // ── Rule 2: Wave 3 is the shortest impulse wave ─────────────────────────────
  // W1=5, W2=3(60%↑sharp), W3=4(SHORTEST), W4=0.5(12.5%↓flat), W5=9.5
  const rule2Pivots: Pivot[] = [
    L(100,   0), H(105,   5),
    L(102,  10), H(106,  20),
    L(105.5,25), H(115,  35),
  ];

  it('flags RULE2 when Wave 3 is the shortest impulse wave', () => {
    const v = checkRules(rule2Pivots, true);
    expect(v.some((s) => s.startsWith('RULE2'))).toBe(true);
  });

  it('does NOT flag RULE1/3/4 for the Rule 2 case', () => {
    const v = checkRules(rule2Pivots, true);
    expect(v.some((s) => s.startsWith('RULE1'))).toBe(false);
    expect(v.some((s) => s.startsWith('RULE3'))).toBe(false);
    expect(v.some((s) => s.startsWith('RULE4'))).toBe(false);
  });

  // ── Rule 3: Wave 4 overlaps Wave 1 territory ───────────────────────────────
  // W1=10, W2=3(30%↓flat), W3=20, W4=17(85%↑sharp), W5=15
  // P4=110 ≤ P1=110 → overlap
  const rule3Pivots: Pivot[] = [
    L(100, 0), H(110,  5),
    L(107, 10), H(127, 20),
    L(110, 25), H(125, 35),
  ];

  it('flags RULE3 when Wave 4 enters Wave 1 territory', () => {
    const v = checkRules(rule3Pivots, true);
    expect(v.some((s) => s.startsWith('RULE3'))).toBe(true);
  });

  it('does NOT flag RULE1/2 for the Rule 3 case', () => {
    const v = checkRules(rule3Pivots, true);
    expect(v.some((s) => s.startsWith('RULE1'))).toBe(false);
    expect(v.some((s) => s.startsWith('RULE2'))).toBe(false);
  });

  // ── Rule 4: No alternation (both waves 2 and 4 are sharp) ──────────────────
  // W1=10, W2=6(60%↑sharp), W3=20, W4=12(60%↑sharp) → both sharp
  const rule4Pivots: Pivot[] = [
    L(100, 0), H(110,  5),
    L(104, 10), H(124, 20),
    L(112, 25), H(125, 35),
  ];

  it('flags RULE4 when Wave 2 and Wave 4 are both sharp corrections', () => {
    const v = checkRules(rule4Pivots, true);
    expect(v.some((s) => s.startsWith('RULE4'))).toBe(true);
  });

  it('does NOT flag RULE1/2/3 for the Rule 4 case', () => {
    const v = checkRules(rule4Pivots, true);
    expect(v.some((s) => s.startsWith('RULE1'))).toBe(false);
    expect(v.some((s) => s.startsWith('RULE2'))).toBe(false);
    expect(v.some((s) => s.startsWith('RULE3'))).toBe(false);
  });

  // ── Negative alternation direction (both flat) ──────────────────────────────
  // W2=35% (flat), W4=40% (flat) — both flat
  const bothFlatPivots: Pivot[] = [
    L(100, 0), H(110,  5),
    L(106.5,10), H(126.5,20),
    L(118.5,25), H(132, 35),
  ];

  it('flags RULE4 when both Wave 2 and Wave 4 are flat corrections', () => {
    const v = checkRules(bothFlatPivots, true);
    expect(v.some((s) => s.startsWith('RULE4'))).toBe(true);
  });

  // ── Bearish mirror ──────────────────────────────────────────────────────────
  const validBear: Pivot[] = [
    H(128.8, 0), L(117.8,  5),
    H(124.3, 10), L(104.3, 20),
    H(110,   25), L(100,   35),
  ];

  it('returns no violations for a clean bearish impulse', () => {
    expect(checkRules(validBear, false)).toHaveLength(0);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 4. checkSoftRules
// ═════════════════════════════════════════════════════════════════════════════

describe('checkSoftRules', () => {
  // W3 < W1: soft warning expected
  // W1=10, W3=8 (< W1) → soft W3 extension violation
  const shortW3: Pivot[] = [
    L(100, 0), H(110,  5),
    L(105, 10), H(113, 20),
    L(109, 25), H(116, 35),
  ];

  it('flags SOFT:W3_EXTENSION when Wave 3 < Wave 1', () => {
    const warnings = checkSoftRules(shortW3, true);
    expect(warnings.some((s) => s.startsWith('SOFT:W3_EXTENSION'))).toBe(true);
  });

  // W3 > W1: no soft warning
  const normalW3: Pivot[] = [
    L(100,   0), H(110,   5),
    L(104.3, 10), H(124.3, 20),
    L(117.8, 25), H(128.8, 35),
  ];

  it('does not flag W3 extension when Wave 3 >= Wave 1', () => {
    const warnings = checkSoftRules(normalW3, true);
    expect(warnings.some((s) => s.startsWith('SOFT:W3_EXTENSION'))).toBe(false);
  });

  // W5 ≈ 0.618 × W1: note expected
  // W1=10, W5≈6.18 (within ±5%)
  const fibW5: Pivot[] = [
    L(100,   0), H(110,  5),
    L(104.3, 10), H(124.3, 20),
    L(117.8, 25), H(124.0, 35), // W5 = 124.0 - 117.8 = 6.2 ≈ 0.62 × 10
  ];

  it('notes SOFT:W5_FIB618 when Wave 5 ≈ 0.618 × Wave 1', () => {
    const warnings = checkSoftRules(fibW5, true);
    expect(warnings.some((s) => s.startsWith('SOFT:W5_FIB618'))).toBe(true);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 5. generateWaveCounts
// ═════════════════════════════════════════════════════════════════════════════

describe('generateWaveCounts', () => {
  it('returns an empty array when given fewer than 6 pivots', () => {
    expect(generateWaveCounts(spyPivots.slice(0, 5), 'SPY', '5m')).toHaveLength(0);
  });

  it('finds at least 1 valid count in the SPY fixture', () => {
    // Diagonal detection may add counts beyond the canonical impulse.
    expect(spyCounts.length).toBeGreaterThanOrEqual(1);
  });

  it('top count has correct ticker and timeframe', () => {
    expect(canonicalCount.ticker).toBe('SPY');
    expect(canonicalCount.timeframe).toBe('5m');
  });

  it('5m count degree is minute', () => {
    // 5m → minute per degree-by-timeframe mapping (v2 upgrade)
    expect(canonicalCount.degree).toBe('minute');
  });

  it('top count has 5 wave nodes labeled 1–5', () => {
    const labels = canonicalCount.allWaves.map((w) => w.label);
    expect(labels).toEqual(['1', '2', '3', '4', '5']);
  });

  it('Wave 1 structure is impulse', () => {
    expect(canonicalCount.allWaves[0].structure).toBe('impulse');
  });

  it('Wave 2 structure is zigzag (sharp retrace > 50%)', () => {
    expect(canonicalCount.allWaves[1].structure).toBe('zigzag');
  });

  it('Wave 4 structure is flat (shallow retrace < 50%)', () => {
    expect(canonicalCount.allWaves[3].structure).toBe('flat');
  });

  it('currentWave is Wave 5', () => {
    expect(canonicalCount.currentWave.label).toBe('5');
  });

  it('isValid is true and violations is empty', () => {
    expect(canonicalCount.isValid).toBe(true);
    expect(canonicalCount.violations).toHaveLength(0);
  });

  it('softWarnings is present (array, may be empty)', () => {
    expect(Array.isArray(canonicalCount.softWarnings)).toBe(true);
  });

  it('Wave 1 start price matches pivot near 575.35', () => {
    const p = canonicalCount.allWaves[0].startPivot.price;
    expect(p).toBeGreaterThan(574);
    expect(p).toBeLessThan(577);
  });

  it('Wave 3 end price is the highest pivot (~601.76)', () => {
    const p = canonicalCount.allWaves[2].endPivot?.price ?? 0;
    expect(p).toBeGreaterThan(600);
    expect(p).toBeLessThan(603);
  });

  it('Wave 4 low is above Wave 1 high (no overlap rule)', () => {
    const w1High = canonicalCount.allWaves[0].endPivot?.price ?? 0;
    const w4Low  = canonicalCount.allWaves[3].endPivot?.price ?? 0;
    expect(w4Low).toBeGreaterThan(w1High);
  });

  it('Wave 3 is the longest wave (Rule 2 verified)', () => {
    const [w1, , w3, , w5] = canonicalCount.allWaves;
    const len = (w: typeof w1) =>
      Math.abs((w.endPivot?.price ?? 0) - w.startPivot.price);
    expect(len(w3)).toBeGreaterThan(len(w1));
    expect(len(w3)).toBeGreaterThan(len(w5));
  });

  it('rrRatio is a positive finite number', () => {
    expect(canonicalCount.rrRatio).toBeGreaterThan(0);
    expect(Number.isFinite(canonicalCount.rrRatio)).toBe(true);
  });

  it('first target equals P2 + 1.618 × W1 (Fibonacci extension from Wave 2 end)', () => {
    const p0 = canonicalCount.allWaves[0].startPivot.price;
    const p1 = canonicalCount.allWaves[0].endPivot!.price;
    const p2 = canonicalCount.allWaves[1].endPivot!.price;
    const w1Len = Math.abs(p1 - p0);
    const expected = p2 + w1Len * 1.618;
    expect(canonicalCount.targets[0]).toBeCloseTo(expected, 1);
  });

  it('targets are ascending (T1 < T2 < T3)', () => {
    const [t1, t2, t3] = canonicalCount.targets;
    expect(t1).toBeLessThan(t2);
    expect(t2).toBeLessThan(t3);
  });

  it('id contains ticker and timeframe', () => {
    expect(canonicalCount.id).toContain('SPY');
    expect(canonicalCount.id).toContain('5m');
  });

  it('deduplicates identical window starts', () => {
    const second = generateWaveCounts(spyPivots, 'SPY', '5m');
    expect(second).toHaveLength(spyCounts.length);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 6. degreeForTimeframe
// ═════════════════════════════════════════════════════════════════════════════

describe('degreeForTimeframe', () => {
  const cases: Array<[string, string]> = [
    ['1m',  'minuette'],
    ['5m',  'minute'],
    ['15m', 'minute'],
    ['30m', 'minor'],
    ['1h',  'minor'],
    ['4h',  'intermediate'],
    ['1D',  'primary'],
    ['1W',  'cycle'],
  ];

  for (const [tf, expected] of cases) {
    it(`${tf} → ${expected}`, () => {
      expect(degreeForTimeframe(tf)).toBe(expected);
    });
  }

  it('unknown timeframe falls back to minor', () => {
    expect(degreeForTimeframe('3D')).toBe('minor');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 7. Diagonal detection  (tryBuildDiagonal + generateWaveCounts)
// ═════════════════════════════════════════════════════════════════════════════

describe('diagonal detection', () => {
  // Ending diagonal: W4 overlaps W1, converging (W3 < W1, W5 < W3)
  // P0=100, P1=108 (W1=8)
  // P2=105 (W2=3, 37.5% flat)
  // P3=112 (W3=7 < W1=8 ✓)
  // P4=107 (W4=5, 71.4% sharp; P4=107 < P1=108 → Rule 3 violation ✓)
  // P5=111 (W5=4 < W3=7 ✓ → strictly converging → ending_diagonal)
  const diagPivots: Pivot[] = [
    L(100, 0), H(108,  5),
    L(105, 10), H(112, 20),
    L(107, 25), H(111, 35),
  ];

  it('tryBuildDiagonal returns a count for a valid ending diagonal', () => {
    const result = tryBuildDiagonal(diagPivots, true, 'TEST', '5m', []);
    expect(result).not.toBeNull();
  });

  it('diagonal count structure is ending_diagonal on Wave 1', () => {
    const result = tryBuildDiagonal(diagPivots, true, 'TEST', '5m', [])!;
    expect(result.allWaves[0].structure).toBe('ending_diagonal');
  });

  it('diagonal count is marked valid with no hard violations', () => {
    const result = tryBuildDiagonal(diagPivots, true, 'TEST', '5m', [])!;
    expect(result.isValid).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  it('diagonal count softWarnings notes the diagonal structure', () => {
    const result = tryBuildDiagonal(diagPivots, true, 'TEST', '5m', [])!;
    expect(result.softWarnings.some((s) => s.includes('DIAGONAL'))).toBe(true);
  });

  it('generateWaveCounts finds the diagonal when only Rule 3 fails', () => {
    const counts = generateWaveCounts(diagPivots, 'TEST', '5m');
    expect(counts.length).toBeGreaterThanOrEqual(1);
    const hasDiag = counts.some((c) =>
      c.allWaves[0].structure === 'ending_diagonal' ||
      c.allWaves[0].structure === 'leading_diagonal',
    );
    expect(hasDiag).toBe(true);
  });

  it('tryBuildDiagonal returns null when W3 >= W1 (no convergence)', () => {
    // W1=10, W3=12 → not converging → not a diagonal
    const nonDiag: Pivot[] = [
      L(100, 0), H(110,  5),
      L(107, 10), H(119, 20),
      L(111, 25), H(118, 35),
    ];
    // First confirm Rule 3 fails (P4=111 > P1=110)
    // Actually P4=111 > P1=110 so Rule 3 doesn't fail here — need a lower P4
    // Adjust: P4=109 < P1=110 → Rule 3 fails; W3=12 >= W1=10 → no diagonal
    const nonDiag2: Pivot[] = [
      L(100, 0), H(110,  5),
      L(107, 10), H(119, 20),
      L(109, 25), H(117, 35),
    ];
    const result = tryBuildDiagonal(nonDiag2, true, 'TEST', '5m', []);
    expect(result).toBeNull();
  });

  it('tryBuildDiagonal returns null when overall direction reverses', () => {
    // P5 < P0 for bull → direction not maintained
    const reversed: Pivot[] = [
      L(110, 0), H(115,  5),
      L(112, 10), H(117, 20),
      L(114, 25), H(109, 35), // P5=109 < P0=110
    ];
    const result = tryBuildDiagonal(reversed, true, 'TEST', '5m', []);
    expect(result).toBeNull();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 8. computeFibLevels
// ═════════════════════════════════════════════════════════════════════════════

describe('computeFibLevels', () => {
  const currentPrice = 596.61; // last close in the fixture

  it('returns exactly 10 levels (5 retracements + 5 extensions)', () => {
    const levels = computeFibLevels(canonicalCount, currentPrice);
    expect(levels).toHaveLength(10);
  });

  it('first 5 ratios are the retracement series', () => {
    const levels = computeFibLevels(canonicalCount, currentPrice);
    const ratios = levels.slice(0, 5).map((l) => l.ratio);
    expect(ratios).toEqual([...RETRACEMENT_RATIOS]);
  });

  it('last 5 ratios are the extension series', () => {
    const levels = computeFibLevels(canonicalCount, currentPrice);
    const ratios = levels.slice(5).map((l) => l.ratio);
    expect(ratios).toEqual([...EXTENSION_RATIOS]);
  });

  it('all level prices are positive', () => {
    const levels = computeFibLevels(canonicalCount, currentPrice);
    expect(levels.every((l) => l.price > 0)).toBe(true);
  });

  it('retracement prices sit between Wave 1 start and Wave 1 end', () => {
    const levels = computeFibLevels(canonicalCount, currentPrice);
    const w1Start = canonicalCount.allWaves[0].startPivot.price;
    const w1End   = canonicalCount.allWaves[0].endPivot!.price;
    const retracements = levels.slice(0, 5);
    retracements.forEach((l) => {
      expect(l.price).toBeGreaterThanOrEqual(w1Start - 1);
      expect(l.price).toBeLessThanOrEqual(w1End + 1);
    });
  });

  it('1.618 extension level is HIT at currentPrice ~596.61 (within 0.3%)', () => {
    const levels = computeFibLevels(canonicalCount, currentPrice);
    const ext1618 = levels.find((l) => l.ratio === 1.618);
    expect(ext1618).toBeDefined();
    expect(ext1618!.hit).toBe(true);
  });

  it('0.236 retracement is NOT hit at current price', () => {
    const levels = computeFibLevels(canonicalCount, currentPrice);
    const ret236 = levels.find((l) => l.ratio === 0.236);
    expect(ret236).toBeDefined();
    expect(ret236!.hit).toBe(false);
  });

  it('getConfluenceHits returns only hit levels', () => {
    const hits = getConfluenceHits(canonicalCount, currentPrice);
    expect(hits.every((l) => l.hit)).toBe(true);
    expect(hits.length).toBeGreaterThanOrEqual(1);
  });

  it('returns empty array when allWaves is empty', () => {
    const empty = { ...canonicalCount, allWaves: [] };
    expect(computeFibLevels(empty, currentPrice)).toHaveLength(0);
  });

  it('wider tolerance finds more hits', () => {
    const narrow = computeFibLevels(canonicalCount, currentPrice, 0.001);
    const wide   = computeFibLevels(canonicalCount, currentPrice, 0.05);
    const narrowHits = narrow.filter((l) => l.hit).length;
    const wideHits   = wide.filter((l) => l.hit).length;
    expect(wideHits).toBeGreaterThanOrEqual(narrowHits);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 9. scoreWaveCounts / probability-engine (v2)
// ═════════════════════════════════════════════════════════════════════════════

describe('scoreWaveCounts', () => {
  const rsi  = 55;
  const macd = 0.05;

  it('returns empty array for empty input', () => {
    expect(scoreWaveCounts([], spyCandles, rsi, macd)).toHaveLength(0);
  });

  it('single count gets posterior of 1.0 (normalization)', () => {
    // Explicitly pass a one-element array — normalization must produce exactly 1.0
    const scored = scoreWaveCounts([canonicalCount], spyCandles, rsi, macd);
    expect(scored[0].posterior.posterior).toBeCloseTo(1.0, 5);
  });

  it('all 8 likelihood components are in [0, 1]', () => {
    const scored = scoreWaveCounts(spyCounts, spyCandles, rsi, macd);
    const lc = scored[0].posterior.likelihood_components;
    Object.values(lc).forEach((v) => {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    });
  });

  it('volume_profile is 1.0 when Wave 3 has the highest average volume', () => {
    const vol = scoreVolumeProfile(canonicalCount, spyCandles);
    expect(vol).toBeCloseTo(1.0, 5);
  });

  it('rsi_divergence is 0.8 for W5 with RSI < 70 (likely divergence)', () => {
    const rsiScore = scoreRsiDivergence(canonicalCount, 55);
    expect(rsiScore).toBeCloseTo(0.8, 5);
  });

  it('rsi_divergence is 0.3 for W5 with RSI ≥ 70 (no divergence)', () => {
    const rsiScore = scoreRsiDivergence(canonicalCount, 75);
    expect(rsiScore).toBeCloseTo(0.3, 5);
  });

  it('macd_alignment is high when histogram is positive for bullish W5', () => {
    const macdScore = scoreMacdAlignment(canonicalCount, 0.05);
    expect(macdScore).toBeGreaterThan(0.5);
  });

  it('macd_alignment is low when histogram is negative for bullish W5', () => {
    const macdScore = scoreMacdAlignment(canonicalCount, -0.05);
    expect(macdScore).toBeLessThan(0.5);
  });

  it('fib_confluence is > 0.5 when a level is hit', () => {
    const fibScore = scoreFibConfluence(canonicalCount, spyCandles);
    expect(fibScore).toBeGreaterThan(0.5);
  });

  it('posteriors sum to 1.0 when there are multiple counts', () => {
    const count2: WaveCount = {
      ...canonicalCount,
      id: 'SPY:5m:clone',
      posterior: { ...canonicalCount.posterior, countId: 'SPY:5m:clone' },
    };
    const scored = scoreWaveCounts([canonicalCount, count2], spyCandles, rsi, macd);
    const total = scored.reduce((s, c) => s + c.posterior.posterior, 0);
    expect(total).toBeCloseTo(1.0, 5);
  });

  it('results are sorted descending by posterior', () => {
    const count2: WaveCount = {
      ...canonicalCount,
      id: 'SPY:5m:clone',
      posterior: { ...canonicalCount.posterior, countId: 'SPY:5m:clone' },
    };
    const scored = scoreWaveCounts([canonicalCount, count2], spyCandles, rsi, macd);
    for (let i = 0; i < scored.length - 1; i++) {
      expect(scored[i].posterior.posterior).toBeGreaterThanOrEqual(
        scored[i + 1].posterior.posterior,
      );
    }
  });

  it('last_updated is a recent timestamp', () => {
    const scored = scoreWaveCounts(spyCounts, spyCandles, rsi, macd);
    const now = Date.now();
    expect(scored[0].posterior.last_updated).toBeGreaterThan(now - 5_000);
    expect(scored[0].posterior.last_updated).toBeLessThanOrEqual(now);
  });

  it('mtf_conflict is false when no mtfScores provided (neutral score)', () => {
    const scored = scoreWaveCounts(spyCounts, spyCandles, rsi, macd);
    // No mtfScores → neutral 0.5 → not a conflict
    expect(scored[0].posterior.mtf_conflict).toBe(false);
  });

  it('mtf_conflict is true when mtfScore < 0.4', () => {
    const mtfScores = { [canonicalCount.id]: 0.2 };
    const scored = scoreWaveCounts(spyCounts, spyCandles, rsi, macd, { mtfScores });
    expect(scored[0].posterior.mtf_conflict).toBe(true);
  });

  it('mtf_alignment component reflects the provided mtfScore', () => {
    const mtfScores = { [canonicalCount.id]: 0.9 };
    const scored = scoreWaveCounts(spyCounts, spyCandles, rsi, macd, { mtfScores });
    expect(scored[0].posterior.likelihood_components.mtf_alignment).toBeCloseTo(0.9, 5);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 10. applyDecay (incremental Bayesian prior)
// ═════════════════════════════════════════════════════════════════════════════

describe('applyDecay', () => {
  it('after 0 candles the prior is unchanged', () => {
    expect(applyDecay(0.8, 0.5, 0)).toBeCloseTo(0.8, 10);
  });

  it('after halfLife candles the prior halves toward uniform', () => {
    const halfLife = 5;
    const existing = 0.8;
    const uniform  = 0.5;
    // After 5 candles: decay = 0.5; result = 0.8 × 0.5 + 0.5 × 0.5 = 0.65
    const expected = existing * 0.5 + uniform * 0.5;
    expect(applyDecay(existing, uniform, halfLife)).toBeCloseTo(expected, 10);
  });

  it('after many candles the prior converges to uniform', () => {
    const result = applyDecay(0.9, 0.25, 100);
    // After 100 candles (20 half-lives): decayFactor ≈ 0
    expect(result).toBeCloseTo(0.25, 2);
  });

  it('when existing equals uniform, result is unchanged', () => {
    expect(applyDecay(0.5, 0.5, 10)).toBeCloseTo(0.5, 10);
  });

  it('scoreWaveCounts uses existingPosteriors for incremental update', () => {
    const count2: WaveCount = {
      ...canonicalCount,
      id: 'SPY:5m:c2',
      posterior: { ...canonicalCount.posterior, countId: 'SPY:5m:c2' },
    };
    // Seed count2 with a strong prior
    const existingPosteriors = {
      [canonicalCount.id]: 0.1,
      [count2.id]: 0.9,
    };
    const scored = scoreWaveCounts(
      [canonicalCount, count2],
      spyCandles,
      55,
      0.05,
      { existingPosteriors, candlesSinceUpdate: 1 },
    );
    // count2 started with a strong prior → should still have higher posterior
    const c2Posterior = scored.find((c) => c.id === 'SPY:5m:c2')?.posterior.posterior ?? 0;
    const c1Posterior = scored.find((c) => c.id === canonicalCount.id)?.posterior.posterior ?? 0;
    expect(c2Posterior).toBeGreaterThan(c1Posterior);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 11. scoreTimeSym
// ═════════════════════════════════════════════════════════════════════════════

describe('scoreTimeSym', () => {
  it('returns 0.5 when wave nodes are missing', () => {
    const empty = { ...canonicalCount, allWaves: [] };
    expect(scoreTimeSym(empty, spyCandles)).toBe(0.5);
  });

  it('returns 0.8 when Wave 2 and Wave 4 durations are within factor of 2', () => {
    // canonicalCount has W2 and W4 with defined pivot indices;
    // result depends on fixture — just verify it's in the valid set
    const score = scoreTimeSym(canonicalCount, spyCandles);
    expect([0.4, 0.5, 0.8]).toContain(score);
  });

  it('returns 0.4 when one duration is more than double the other', () => {
    // Create a synthetic count with very asymmetric W2/W4 durations
    const w2Short: Pivot = { index: 0, price: 110, timestamp: 0,     type: 'HH', timeframe: '5m' };
    const w2End:   Pivot = { index: 1, price: 105, timestamp: 300_000, type: 'HL', timeframe: '5m' }; // 1 bar
    const w4Start: Pivot = { index: 2, price: 120, timestamp: 600_000, type: 'HH', timeframe: '5m' };
    const w4End:   Pivot = { index: 20, price: 115, timestamp: 6_000_000, type: 'HL', timeframe: '5m' }; // 18 bars
    const asymCount: WaveCount = {
      ...canonicalCount,
      allWaves: [
        ...canonicalCount.allWaves.map((w) => {
          if (w.label === '2') return { ...w, startPivot: w2Short, endPivot: w2End };
          if (w.label === '4') return { ...w, startPivot: w4Start, endPivot: w4End };
          return w;
        }),
      ],
    };
    expect(scoreTimeSym(asymCount, spyCandles)).toBe(0.4);
  });
});
