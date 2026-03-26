/**
 * WaveOverlayLayer.tsx
 *
 * Renders Elliott Wave count overlays inside the Skia Canvas.
 *
 * For each WaveCount (primary + optional secondary):
 *   - Polyline connecting P0→P1→P2→P3→P4→P5
 *   - Wave labels (1/2/3/4/5 or A/B/C) at each wave endpoint
 *   - Bull counts → green (#26A69A); bear counts → red (#EF5350)
 *   - Secondary count rendered at 35% opacity
 *
 * Font: JetBrains Mono Bold is the target typeface. Load it in the host
 * component via expo-font or Skia.Typeface.  Until the asset is bundled,
 * the system monospace font is used as a drop-in replacement.
 *
 * All positions recalculate on the UI thread when translateX / candleW
 * change (pan / pinch), so the overlay tracks candles without janking.
 */

import React from 'react';
import { Path, Text, Group, Skia, type SkFont, type SkPath } from '@shopify/react-native-skia';
import { useSharedValue, useDerivedValue } from 'react-native-reanimated';
import type { SharedValue } from 'react-native-reanimated';
import { useEffect } from 'react';
import type { WaveCount } from '@elliott-wave-pro/wave-engine';
import { CHART_COLORS } from './chartTypes';
import type { ChartLayoutParams } from './chartTypes';

// ── Internal serialised form (safe to store in a SharedValue) ─────────────────

interface PivotData {
  barIndex: number;  // absolute index in the full candles array
  price:    number;
}

interface SerializedCount {
  isBullish: boolean;
  pivots:    PivotData[];   // 6 entries: P0..P5
  labels:    string[];      // 5 entries: label at end of each wave
}

const NULL_COUNT: SerializedCount = {
  isBullish: true,
  pivots:    [],
  labels:    [],
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function pToY(price: number, minP: number, maxP: number, top: number, h: number): number {
  'worklet';
  const range = maxP - minP;
  if (range < 1e-9) return top + h * 0.5;
  return top + ((maxP - price) / range) * h;
}

/** Convert a serialized wave count into a Skia polyline Path. */
function buildWavePolyline(
  count: SerializedCount,
  tx: number,
  cw: number,
  layout: ChartLayoutParams,
  chartTop: number,
  chartH: number,
): SkPath {
  'worklet';
  const p = Skia.Path.Make();
  const { minP, maxP } = layout;
  const pivots = count.pivots;
  if (pivots.length < 2) return p;

  const half = cw * 0.5;
  let first = true;
  for (let i = 0; i < pivots.length; i++) {
    const x = tx + pivots[i].barIndex * cw + half;
    const y = pToY(pivots[i].price, minP, maxP, chartTop, chartH);
    if (first) {
      p.moveTo(x, y);
      first = false;
    } else {
      p.lineTo(x, y);
    }
  }
  return p;
}

/** Pixel position for the i-th wave label (placed at pivots[i+1], the wave endpoint). */
function labelPos(
  count: SerializedCount,
  pivotIdx: number,         // 1..5
  tx: number,
  cw: number,
  layout: ChartLayoutParams,
  chartTop: number,
  chartH: number,
): { x: number; y: number } {
  'worklet';
  const pivot = count.pivots[pivotIdx];
  if (!pivot) return { x: -200, y: -200 };
  const { minP, maxP } = layout;
  const x = tx + pivot.barIndex * cw + cw * 0.5 - 5;
  const y = pToY(pivot.price, minP, maxP, chartTop, chartH);

  // For bull: odd-index pivots are highs → label above; even → below
  // For bear: even-index pivots are highs → label above; odd → below
  const isHigh = count.isBullish ? pivotIdx % 2 === 1 : pivotIdx % 2 === 0;
  const offsetY = isHigh ? -14 : 16;
  return { x, y: y + offsetY };
}

// ── Serialiser ────────────────────────────────────────────────────────────────

function serializeCount(count: WaveCount, sliceOffset: number): SerializedCount {
  const waves = count.allWaves;
  if (!waves || waves.length < 5) return NULL_COUNT;

  const w1 = waves[0];
  if (!w1.startPivot || !w1.endPivot) return NULL_COUNT;

  const pivots: PivotData[] = [
    { barIndex: w1.startPivot.index + sliceOffset, price: w1.startPivot.price },
  ];
  for (const wave of waves) {
    if (!wave.endPivot) break;
    pivots.push({
      barIndex: wave.endPivot.index + sliceOffset,
      price:    wave.endPivot.price,
    });
  }
  if (pivots.length < 6) return NULL_COUNT;

  return {
    isBullish: w1.startPivot.price < w1.endPivot.price,
    pivots,
    labels: waves.map((w) => w.label as string),
  };
}

// ── Per-count sub-component ───────────────────────────────────────────────────

interface WaveCountOverlayProps {
  serialized:  SharedValue<SerializedCount>;
  translateX:  SharedValue<number>;
  candleW:     SharedValue<number>;
  layoutDV:    SharedValue<ChartLayoutParams>;
  chartTop:    number;
  chartDrawH:  number;
  opacity:     number;
  font:        SkFont | null;
}

function WaveCountOverlay({
  serialized,
  translateX,
  candleW,
  layoutDV,
  chartTop,
  chartDrawH,
  opacity,
  font,
}: WaveCountOverlayProps) {
  const polyline = useDerivedValue((): SkPath => {
    'worklet';
    const count = serialized.value;
    return buildWavePolyline(count, translateX.value, candleW.value, layoutDV.value, chartTop, chartDrawH);
  });

  // Pre-compute all 5 label positions in one worklet pass
  const positions = useDerivedValue(() => {
    'worklet';
    const count = serialized.value;
    const tx = translateX.value;
    const cw = candleW.value;
    const layout = layoutDV.value;
    return [1, 2, 3, 4, 5].map((i) => labelPos(count, i, tx, cw, layout, chartTop, chartDrawH));
  });

  // Extract x / y for each of the 5 labels into separate derived values
  const x1 = useDerivedValue(() => positions.value[0].x);
  const y1 = useDerivedValue(() => positions.value[0].y);
  const x2 = useDerivedValue(() => positions.value[1].x);
  const y2 = useDerivedValue(() => positions.value[1].y);
  const x3 = useDerivedValue(() => positions.value[2].x);
  const y3 = useDerivedValue(() => positions.value[2].y);
  const x4 = useDerivedValue(() => positions.value[3].x);
  const y4 = useDerivedValue(() => positions.value[3].y);
  const x5 = useDerivedValue(() => positions.value[4].x);
  const y5 = useDerivedValue(() => positions.value[4].y);

  const color      = useDerivedValue(() => serialized.value.isBullish ? CHART_COLORS.bullBody : CHART_COLORS.bearBody);
  const labels     = useDerivedValue(() => serialized.value.labels);
  const lbl        = (i: number): string => labels.value[i] ?? '';

  if (font === null) {
    return (
      <Group opacity={opacity}>
        <Path path={polyline} color={color} style="stroke" strokeWidth={1.5} />
      </Group>
    );
  }

  return (
    <Group opacity={opacity}>
      {/* Wave polyline */}
      <Path path={polyline} color={color} style="stroke" strokeWidth={1.5} />

      {/* Wave labels at each pivot endpoint */}
      <Text x={x1} y={y1} text={lbl(0)} font={font} color={color} />
      <Text x={x2} y={y2} text={lbl(1)} font={font} color={color} />
      <Text x={x3} y={y3} text={lbl(2)} font={font} color={color} />
      <Text x={x4} y={y4} text={lbl(3)} font={font} color={color} />
      <Text x={x5} y={y5} text={lbl(4)} font={font} color={color} />
    </Group>
  );
}

// ── Public component ──────────────────────────────────────────────────────────

export interface WaveOverlayLayerProps {
  waveCounts:  readonly WaveCount[];
  sliceOffset: number;
  translateX:  SharedValue<number>;
  candleW:     SharedValue<number>;
  layoutDV:    SharedValue<ChartLayoutParams>;
  chartTop:    number;
  chartDrawH:  number;
  /** JetBrains Mono Bold or system monospace fallback. */
  font:        SkFont | null;
}

export function WaveOverlayLayer({
  waveCounts,
  sliceOffset,
  translateX,
  candleW,
  layoutDV,
  chartTop,
  chartDrawH,
  font,
}: WaveOverlayLayerProps) {
  const primarySV   = useSharedValue<SerializedCount>(NULL_COUNT);
  const secondarySV = useSharedValue<SerializedCount>(NULL_COUNT);

  useEffect(() => {
    primarySV.value   = waveCounts[0] ? serializeCount(waveCounts[0], sliceOffset) : NULL_COUNT;
    secondarySV.value = waveCounts[1] ? serializeCount(waveCounts[1], sliceOffset) : NULL_COUNT;
  }, [waveCounts, sliceOffset, primarySV, secondarySV]);

  return (
    <>
      {/* Secondary count — dimmed */}
      <WaveCountOverlay
        serialized={secondarySV}
        translateX={translateX}
        candleW={candleW}
        layoutDV={layoutDV}
        chartTop={chartTop}
        chartDrawH={chartDrawH}
        opacity={0.35}
        font={font}
      />
      {/* Primary count — full opacity */}
      <WaveCountOverlay
        serialized={primarySV}
        translateX={translateX}
        candleW={candleW}
        layoutDV={layoutDV}
        chartTop={chartTop}
        chartDrawH={chartDrawH}
        opacity={1.0}
        font={font}
      />
    </>
  );
}
