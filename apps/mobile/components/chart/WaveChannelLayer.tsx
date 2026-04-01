/**
 * WaveChannelLayer.tsx
 *
 * Draws the classic Elliott Wave channel on the Skia Canvas:
 *
 *   Base channel:  line through P0 (wave 0 start) and P2 (wave 2 end)
 *   Parallel line: same slope, passes through P1 (wave 1 high)
 *
 * These define the expected corridor for waves 3 and 5.
 * Wave 5 often terminates at the upper channel (parallel line) — a target
 * marker dot is drawn on the parallel line at the rightmost visible bar.
 *
 * Color: semi-transparent violet / purple.
 */

import React, { useEffect } from 'react';
import {
  Path,
  Text,
  Circle,
  DashPathEffect,
  Group,
  Skia,
  type SkFont,
  type SkPath,
} from '@shopify/react-native-skia';
import { useSharedValue, useDerivedValue } from 'react-native-reanimated';
import type { SharedValue } from 'react-native-reanimated';
import type { WaveCount } from '@elliott-wave-pro/wave-engine';
import type { ChartLayoutParams } from './chartTypes';

// ── Colors ────────────────────────────────────────────────────────────────────
// Channel color is direction-aware: teal for bullish trend, red for bearish.

const CHANNEL_BULL_STROKE  = 'rgba(0,206,209,0.55)';    // dark teal — bullish channel
const CHANNEL_BEAR_STROKE  = 'rgba(239,83,80,0.45)';    // red — bearish channel
const CHANNEL_BULL_LABEL   = 'rgba(0,206,209,0.90)';
const CHANNEL_BEAR_LABEL   = 'rgba(239,83,80,0.90)';
const TARGET_DOT_BULL      = 'rgba(0,206,209,0.85)';
const TARGET_DOT_BEAR      = 'rgba(239,83,80,0.85)';

// ── Internal serialized form ──────────────────────────────────────────────────
//
// Elliott Wave trend channel construction:
//   Phase 1 (waves 1-2 known): base = P0→P2, parallel through P1
//   Phase 2 (waves 1-4 known): base = P2→P4, parallel through P3  ← preferred
//
// The Phase 2 channel (0-2-4 base, 1-3-5 parallel) is the classic EW channel.
// Wave 5 often terminates at the upper parallel line.

interface ChannelPivots {
  // Phase 1 pivots (always required)
  p0Bar: number; p0Price: number;  // wave start
  p1Bar: number; p1Price: number;  // wave 1 end (high in bullish)
  p2Bar: number; p2Price: number;  // wave 2 end (low in bullish)
  // Phase 2 pivots (used when wave 4 is confirmed)
  p3Bar: number; p3Price: number;  // wave 3 end (high in bullish)
  p4Bar: number; p4Price: number;  // wave 4 end (low in bullish)
  hasW4: boolean;   // if true: use P2→P4 base, parallel through P3
  isBullish: boolean;
  valid: boolean;
}

const NULL_CHANNEL: ChannelPivots = {
  p0Bar: 0, p0Price: 0,
  p1Bar: 0, p1Price: 0,
  p2Bar: 0, p2Price: 0,
  p3Bar: 0, p3Price: 0,
  p4Bar: 0, p4Price: 0,
  hasW4: false,
  isBullish: true,
  valid: false,
};

function extractChannelPivots(count: WaveCount): ChannelPivots {
  const w1 = count.allWaves.find((w) => w.label === '1');
  const w2 = count.allWaves.find((w) => w.label === '2');
  const w3 = count.allWaves.find((w) => w.label === '3');
  const w4 = count.allWaves.find((w) => w.label === '4');

  if (!w1 || !w2 || !w1.endPivot || !w2.endPivot) return NULL_CHANNEL;

  const isBullish = w1.startPivot.price < w1.endPivot.price;
  const hasW4 = !!(w3?.endPivot && w4?.endPivot);

  return {
    p0Bar:   w1.startPivot.index,
    p0Price: w1.startPivot.price,
    p1Bar:   w1.endPivot.index,
    p1Price: w1.endPivot.price,
    p2Bar:   w2.endPivot.index,
    p2Price: w2.endPivot.price,
    p3Bar:   w3?.endPivot?.index ?? 0,
    p3Price: w3?.endPivot?.price ?? 0,
    p4Bar:   w4?.endPivot?.index ?? 0,
    p4Price: w4?.endPivot?.price ?? 0,
    hasW4,
    isBullish,
    valid: true,
  };
}

// ── Worklet helpers ───────────────────────────────────────────────────────────

function pToY(price: number, minP: number, maxP: number, top: number, h: number): number {
  'worklet';
  const range = maxP - minP;
  if (range < 1e-9) return top + h * 0.5;
  return top + ((maxP - price) / range) * h;
}

/**
 * Compute slope+intercept for the base line.
 * Phase 2 (hasW4): base through P2 and P4.
 * Phase 1 (no W4): base through P0 and P2.
 */
function baseLineParams(
  pivots: ChannelPivots,
  tx: number,
  cw: number,
  layout: ChartLayoutParams,
  chartTop: number,
  chartH: number,
): { slope: number; intercept: number } | null {
  'worklet';
  if (!pivots.valid) return null;
  const { minP, maxP } = layout;
  const half = cw * 0.5;

  let ax: number, ay: number, bx: number, by: number;
  if (pivots.hasW4) {
    // Phase 2: 0-2-4 line (P2 → P4)
    ax = tx + pivots.p2Bar * cw + half;
    ay = pToY(pivots.p2Price, minP, maxP, chartTop, chartH);
    bx = tx + pivots.p4Bar * cw + half;
    by = pToY(pivots.p4Price, minP, maxP, chartTop, chartH);
  } else {
    // Phase 1: P0 → P2
    ax = tx + pivots.p0Bar * cw + half;
    ay = pToY(pivots.p0Price, minP, maxP, chartTop, chartH);
    bx = tx + pivots.p2Bar * cw + half;
    by = pToY(pivots.p2Price, minP, maxP, chartTop, chartH);
  }
  const dx = bx - ax;
  if (Math.abs(dx) < 1) return null;
  const slope = (by - ay) / dx;
  const intercept = ay - slope * ax;
  return { slope, intercept };
}

function buildBasePath(
  pivots: ChannelPivots,
  tx: number,
  cw: number,
  layout: ChartLayoutParams,
  chartTop: number,
  chartH: number,
  chartAreaW: number,
): SkPath {
  'worklet';
  const path = Skia.Path.Make();
  const params = baseLineParams(pivots, tx, cw, layout, chartTop, chartH);
  if (!params) return path;
  const { slope, intercept } = params;
  path.moveTo(0, intercept);
  path.lineTo(chartAreaW, intercept + slope * chartAreaW);
  return path;
}

function buildParallelPath(
  pivots: ChannelPivots,
  tx: number,
  cw: number,
  layout: ChartLayoutParams,
  chartTop: number,
  chartH: number,
  chartAreaW: number,
): SkPath {
  'worklet';
  const path = Skia.Path.Make();
  const params = baseLineParams(pivots, tx, cw, layout, chartTop, chartH);
  if (!params) return path;
  const { slope } = params;

  const { minP, maxP } = layout;
  const half = cw * 0.5;

  // Parallel point: through P3 (hasW4) or P1 (phase 1)
  const px = pivots.hasW4
    ? tx + pivots.p3Bar * cw + half
    : tx + pivots.p1Bar * cw + half;
  const py = pivots.hasW4
    ? pToY(pivots.p3Price, minP, maxP, chartTop, chartH)
    : pToY(pivots.p1Price, minP, maxP, chartTop, chartH);

  const intercept = py - slope * px;
  path.moveTo(0, intercept);
  path.lineTo(chartAreaW, intercept + slope * chartAreaW);
  return path;
}

/** Y of the parallel channel at the rightmost edge — for the target dot. */
function parallelYAtRight(
  pivots: ChannelPivots,
  tx: number,
  cw: number,
  layout: ChartLayoutParams,
  chartTop: number,
  chartH: number,
  chartAreaW: number,
): number {
  'worklet';
  const params = baseLineParams(pivots, tx, cw, layout, chartTop, chartH);
  if (!params) return -200;
  const { slope } = params;

  const { minP, maxP } = layout;
  const half = cw * 0.5;
  const px = pivots.hasW4
    ? tx + pivots.p3Bar * cw + half
    : tx + pivots.p1Bar * cw + half;
  const py = pivots.hasW4
    ? pToY(pivots.p3Price, minP, maxP, chartTop, chartH)
    : pToY(pivots.p1Price, minP, maxP, chartTop, chartH);

  const intercept = py - slope * px;
  const y = intercept + slope * (chartAreaW - 8);
  return y < chartTop || y > chartTop + chartH ? -200 : y;
}

// ── Public component ──────────────────────────────────────────────────────────

export interface WaveChannelLayerProps {
  waveCounts:  readonly WaveCount[];
  translateX:  SharedValue<number>;
  candleW:     SharedValue<number>;
  layoutDV:    SharedValue<ChartLayoutParams>;
  chartTop:    number;
  chartDrawH:  number;
  chartAreaW:  number;
  font:        SkFont | null;
}

export function WaveChannelLayer({
  waveCounts,
  translateX,
  candleW,
  layoutDV,
  chartTop,
  chartDrawH,
  chartAreaW,
  font,
}: WaveChannelLayerProps) {
  const pivotsSV = useSharedValue<ChannelPivots>(NULL_CHANNEL);

  useEffect(() => {
    const primary = waveCounts[0];
    pivotsSV.value = primary ? extractChannelPivots(primary) : NULL_CHANNEL;
  }, [waveCounts, pivotsSV]);

  const basePath = useDerivedValue((): SkPath => {
    'worklet';
    return buildBasePath(
      pivotsSV.value,
      translateX.value, candleW.value,
      layoutDV.value,
      chartTop, chartDrawH, chartAreaW,
    );
  });

  const parallelPath = useDerivedValue((): SkPath => {
    'worklet';
    return buildParallelPath(
      pivotsSV.value,
      translateX.value, candleW.value,
      layoutDV.value,
      chartTop, chartDrawH, chartAreaW,
    );
  });

  // Target dot Y on the parallel line at the right edge
  const targetDotY = useDerivedValue((): number => {
    'worklet';
    return parallelYAtRight(
      pivotsSV.value,
      translateX.value, candleW.value,
      layoutDV.value,
      chartTop, chartDrawH, chartAreaW,
    );
  });

  const targetDotX = chartAreaW - 8;

  if (waveCounts.length === 0) return null;

  const primary  = waveCounts[0];
  const w1       = primary?.allWaves.find((w) => w.label === '1');
  const isBull   = w1 ? w1.startPivot.price < (w1.endPivot?.price ?? w1.startPivot.price) : true;
  const stroke   = isBull ? CHANNEL_BULL_STROKE  : CHANNEL_BEAR_STROKE;
  const labelClr = isBull ? CHANNEL_BULL_LABEL   : CHANNEL_BEAR_LABEL;
  const dotClr   = isBull ? TARGET_DOT_BULL      : TARGET_DOT_BEAR;

  // Show which phase the channel is in
  const channelLabel = (waveCounts[0] && waveCounts[0].allWaves.find(w => w.label === '4')?.endPivot)
    ? 'EW Channel (W2-W4)'
    : 'EW Channel (W0-W2)';

  return (
    <Group>
      {/* Base channel */}
      <Path path={basePath} color={stroke} style="stroke" strokeWidth={1.2}>
        <DashPathEffect intervals={[10, 6]} phase={0} />
      </Path>

      {/* Parallel channel (W5 target zone) */}
      <Path path={parallelPath} color={stroke} style="stroke" strokeWidth={1.5}>
        <DashPathEffect intervals={[10, 6]} phase={0} />
      </Path>

      {/* Wave 5 target dot on the parallel line */}
      <Circle cx={targetDotX} cy={targetDotY} r={4} color={dotClr} />

      {/* Channel label */}
      {font !== null && (
        <Text
          x={chartAreaW - 96}
          y={targetDotY}
          text={channelLabel}
          font={font}
          color={labelClr}
        />
      )}
    </Group>
  );
}
