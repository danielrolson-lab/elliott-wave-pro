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

const CHANNEL_STROKE  = 'rgba(147,51,234,0.55)';   // purple/violet
const CHANNEL_LABEL   = 'rgba(192,132,252,0.9)';
const TARGET_DOT      = 'rgba(192,132,252,0.85)';

// ── Internal serialized form ──────────────────────────────────────────────────

interface ChannelPivots {
  p0Bar: number; p0Price: number;  // wave start
  p1Bar: number; p1Price: number;  // wave 1 end (high)
  p2Bar: number; p2Price: number;  // wave 2 end (low)
  valid: boolean;
}

const NULL_CHANNEL: ChannelPivots = {
  p0Bar: 0, p0Price: 0,
  p1Bar: 0, p1Price: 0,
  p2Bar: 0, p2Price: 0,
  valid: false,
};

function extractChannelPivots(count: WaveCount, sliceOffset: number): ChannelPivots {
  const w1 = count.allWaves.find((w) => w.label === '1');
  const w2 = count.allWaves.find((w) => w.label === '2');
  if (!w1 || !w2 || !w1.endPivot || !w2.endPivot) return NULL_CHANNEL;
  return {
    p0Bar:   w1.startPivot.index + sliceOffset,
    p0Price: w1.startPivot.price,
    p1Bar:   w1.endPivot.index + sliceOffset,
    p1Price: w1.endPivot.price,
    p2Bar:   w2.endPivot.index + sliceOffset,
    p2Price: w2.endPivot.price,
    valid:   true,
  };
}

// ── Worklet helpers ───────────────────────────────────────────────────────────

function pToY(price: number, minP: number, maxP: number, top: number, h: number): number {
  'worklet';
  const range = maxP - minP;
  if (range < 1e-9) return top + h * 0.5;
  return top + ((maxP - price) / range) * h;
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
  if (!pivots.valid) return path;

  const { minP, maxP } = layout;
  const half = cw * 0.5;
  const p0x = tx + pivots.p0Bar * cw + half;
  const p0y = pToY(pivots.p0Price, minP, maxP, chartTop, chartH);
  const p2x = tx + pivots.p2Bar * cw + half;
  const p2y = pToY(pivots.p2Price, minP, maxP, chartTop, chartH);

  const dx = p2x - p0x;
  if (Math.abs(dx) < 1) return path;

  const slope = (p2y - p0y) / dx;
  const intercept = p0y - slope * p0x;

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
  if (!pivots.valid) return path;

  const { minP, maxP } = layout;
  const half = cw * 0.5;
  const p0x = tx + pivots.p0Bar * cw + half;
  const p0y = pToY(pivots.p0Price, minP, maxP, chartTop, chartH);
  const p1x = tx + pivots.p1Bar * cw + half;
  const p1y = pToY(pivots.p1Price, minP, maxP, chartTop, chartH);
  const p2x = tx + pivots.p2Bar * cw + half;
  const p2y = pToY(pivots.p2Price, minP, maxP, chartTop, chartH);

  const dx = p2x - p0x;
  if (Math.abs(dx) < 1) return path;
  const slope = (p2y - p0y) / dx;

  // Parallel line through p1
  const intercept = p1y - slope * p1x;
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
  if (!pivots.valid) return -200;

  const { minP, maxP } = layout;
  const half = cw * 0.5;
  const p0x = tx + pivots.p0Bar * cw + half;
  const p0y = pToY(pivots.p0Price, minP, maxP, chartTop, chartH);
  const p1x = tx + pivots.p1Bar * cw + half;
  const p1y = pToY(pivots.p1Price, minP, maxP, chartTop, chartH);
  const p2x = tx + pivots.p2Bar * cw + half;
  const p2y = pToY(pivots.p2Price, minP, maxP, chartTop, chartH);

  const dx = p2x - p0x;
  if (Math.abs(dx) < 1) return -200;
  const slope = (p2y - p0y) / dx;
  const intercept = p1y - slope * p1x;

  const y = intercept + slope * (chartAreaW - 8);
  return y < chartTop || y > chartTop + chartH ? -200 : y;
}

// ── Public component ──────────────────────────────────────────────────────────

export interface WaveChannelLayerProps {
  waveCounts:  readonly WaveCount[];
  sliceOffset: number;
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
  sliceOffset,
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
    pivotsSV.value = primary ? extractChannelPivots(primary, sliceOffset) : NULL_CHANNEL;
  }, [waveCounts, sliceOffset, pivotsSV]);

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

  return (
    <Group>
      {/* Base channel (P0 → P2 extended) */}
      <Path path={basePath} color={CHANNEL_STROKE} style="stroke" strokeWidth={1.2}>
        <DashPathEffect intervals={[10, 6]} phase={0} />
      </Path>

      {/* Parallel channel (through P1) */}
      <Path path={parallelPath} color={CHANNEL_STROKE} style="stroke" strokeWidth={1.5}>
        <DashPathEffect intervals={[10, 6]} phase={0} />
      </Path>

      {/* Wave 5 target dot on the parallel line */}
      <Circle cx={targetDotX} cy={targetDotY} r={4} color={TARGET_DOT} />

      {/* "EW Channel" label */}
      {font !== null && (
        <Text
          x={chartAreaW - 72}
          y={targetDotY}
          text="EW Channel"
          font={font}
          color={CHANNEL_LABEL}
        />
      )}
    </Group>
  );
}
