/**
 * generate-fixture.ts
 *
 * Generates a synthetic SPY-like 5-minute OHLCV dataset with a canonical
 * 5-wave Elliott impulse embedded.  Wave relationships are deliberately
 * sized to satisfy all four hard EW rules — the test suite asserts against
 * these known properties.
 *
 * Impulse design (prices approximate SPY levels ~580):
 *
 *   Phase     Bars  Start   End    |Δ|    Notes
 *   ────────  ────  ──────  ─────  ─────  ──────────────────────────────
 *   Pre       30    575.00  575.5  —      Sideways noise, seeds ATR
 *   Wave 1    25    575.00  586.0  11.0   Base impulse unit
 *   Wave 2    18    586.00  579.8   6.2   54.5% retrace → SHARP
 *   Wave 3    42    579.80  601.8  22.0   2.0× W1 → LONGEST ✓
 *   Wave 4    22    601.80  594.3   7.5   34.1% of W3 → FLAT ✓ (alternates)
 *   Wave 5    28    594.30  604.0   9.7   0.88× W1
 *   Corr.     30    604.00  596.0  —      Simple A-wave correction
 *   Tail      20    596.00  596.0  —      Sideways, lets ATR settle
 *
 * EW hard-rule verification:
 *   Rule 1  W2 retrace: 6.2/11.0 = 56.4% ≤ 100% ✓
 *   Rule 2  W3 (22.0) is longest of {11.0, 22.0, 9.7} ✓
 *   Rule 3  W4 low (594.3) > W1 high (586.0) ✓  (no overlap)
 *   Rule 4  W2 sharp (56%), W4 flat (34%) → alternation ✓
 */

import { writeFileSync, mkdirSync } from 'fs';
import { resolve, join, dirname } from 'path';

const OUT_PATH = join(
  dirname(resolve(import.meta.url.replace('file://', ''))),
  '../tests/fixtures/SPY_5m.csv',
);

// ── Seeded PRNG (reproducible noise) ─────────────────────────────────────────

function mulberry32(seed: number): () => number {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = mulberry32(0xdeadbeef);

// ── Bar builder ───────────────────────────────────────────────────────────────

interface BarSpec {
  open: number;
  direction: number;   // +1 up, -1 down, 0 flat
  volatility: number;  // noise amplitude
  volume: number;      // base volume
}

function buildBar(
  timestamp: number,
  spec: BarSpec,
  prevClose: number,
): string {
  const noise = () => (rand() - 0.5) * 2 * spec.volatility;

  const open  = prevClose + noise() * 0.3;
  const drift = spec.direction * (rand() * spec.volatility * 0.5 + 0.02);
  const close = open + drift + noise() * 0.2;

  const bodyHi = Math.max(open, close);
  const bodyLo = Math.min(open, close);
  const high   = bodyHi + rand() * spec.volatility * 0.6;
  const low    = bodyLo - rand() * spec.volatility * 0.6;
  const vol    = Math.round(spec.volume * (0.7 + rand() * 0.6));

  return `${timestamp},${open.toFixed(2)},${high.toFixed(2)},${low.toFixed(2)},${close.toFixed(2)},${vol}`;
}

// ── Phase definitions ─────────────────────────────────────────────────────────

interface Phase {
  label: string;
  bars: number;
  startPrice: number;
  endPrice: number;
  volMultiplier: number; // relative to base volume 80_000
}

const BASE_VOL = 80_000;
const ATR_VOL  = 0.55; // volatility amplitude per bar (≈ SPY 5m ATR)

const PHASES: Phase[] = [
  { label: 'pre',    bars: 30, startPrice: 575.00, endPrice: 575.50, volMultiplier: 0.9 },
  { label: 'wave1',  bars: 25, startPrice: 575.00, endPrice: 586.00, volMultiplier: 1.2 },
  { label: 'wave2',  bars: 18, startPrice: 586.00, endPrice: 579.80, volMultiplier: 0.8 },
  { label: 'wave3',  bars: 42, startPrice: 579.80, endPrice: 601.80, volMultiplier: 1.8 },
  { label: 'wave4',  bars: 22, startPrice: 601.80, endPrice: 594.30, volMultiplier: 0.75 },
  { label: 'wave5',  bars: 28, startPrice: 594.30, endPrice: 604.00, volMultiplier: 1.1 },
  { label: 'corr',   bars: 30, startPrice: 604.00, endPrice: 596.00, volMultiplier: 0.85 },
  { label: 'tail',   bars: 20, startPrice: 596.00, endPrice: 596.50, volMultiplier: 0.7 },
];

// ── Generate ──────────────────────────────────────────────────────────────────

// SPY market open on 2025-03-17 09:30 ET → Unix ms
const SESSION_START_MS = 1742217000000; // 2025-03-17 09:30:00 ET
const BAR_MS = 5 * 60 * 1000;

const rows: string[] = ['timestamp,open,high,low,close,volume'];

let ts      = SESSION_START_MS;
let prevClose = PHASES[0].startPrice;

for (const phase of PHASES) {
  const totalMove  = phase.endPrice - phase.startPrice;
  const dirSign    = totalMove >= 0 ? 1 : -1;
  const movePerBar = totalMove / phase.bars;

  for (let b = 0; b < phase.bars; b++) {
    // Linearly interpolate open target toward phase end
    const targetClose = phase.startPrice + movePerBar * (b + 1);
    const spec: BarSpec = {
      open: prevClose,
      direction: dirSign,
      volatility: ATR_VOL * (0.8 + rand() * 0.4),
      volume: BASE_VOL * phase.volMultiplier,
    };

    const row = buildBar(ts, spec, prevClose);
    // Nudge close toward the target to keep the trend on track
    const parts = row.split(',');
    const rawClose = parseFloat(parts[4]);
    const blendedClose = rawClose * 0.4 + targetClose * 0.6;
    parts[4] = blendedClose.toFixed(2);

    // Ensure high ≥ open,close and low ≤ open,close
    const o = parseFloat(parts[1]);
    const h = parseFloat(parts[2]);
    const l = parseFloat(parts[3]);
    const c = blendedClose;
    parts[2] = Math.max(h, o, c).toFixed(2);
    parts[3] = Math.min(l, o, c).toFixed(2);

    rows.push(parts.join(','));
    prevClose = c;
    ts += BAR_MS;
  }
}

mkdirSync(dirname(OUT_PATH), { recursive: true });
writeFileSync(OUT_PATH, rows.join('\n') + '\n', 'utf8');

console.log(`Generated ${rows.length - 1} bars → ${OUT_PATH}`);
console.log('Embedded 5-wave impulse: 575→586→579.8→601.8→594.3→604.0');
