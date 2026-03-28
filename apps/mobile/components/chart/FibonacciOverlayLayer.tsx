/**
 * FibonacciOverlayLayer.tsx
 *
 * Renders Fibonacci retracement and extension levels inside the Skia Canvas.
 *
 * For the top-scored WaveCount:
 *   - 5 retracement levels (0.236 → 0.786) — measured from Wave 1
 *     Rendered as dashed lines in a neutral grey-blue
 *   - 5 extension levels (1.0 → 2.618) — projected from Wave 2 end
 *     Rendered as dashed lines in gold
 *   - Each line labeled on the right with ratio + price
 *     e.g.  "0.618  $581.90"
 *
 * The Y position of each level recalculates on the UI thread when the price
 * scale changes (zoom / pan), so labels stay anchored to the correct price.
 */

import React, { useMemo } from 'react';
import {
  Path,
  Text,
  DashPathEffect,
  Group,
  Skia,
  type SkFont,
  type SkPath,
} from '@shopify/react-native-skia';
import { useSharedValue, useDerivedValue } from 'react-native-reanimated';
import type { SharedValue } from 'react-native-reanimated';
import { useEffect } from 'react';
import type { WaveCount, FibLevel } from '@elliott-wave-pro/wave-engine';
import { computeFibLevels } from '@elliott-wave-pro/wave-engine';
import type { ChartLayoutParams } from './chartTypes';

// ── Colours ───────────────────────────────────────────────────────────────────

const RETRACE_COLOR   = 'rgba(251,146,60,0.65)';  // amber/orange — retracements
const EXTENSION_COLOR = 'rgba(34,211,238,0.65)';  // cyan/teal   — extensions
const LABEL_RETRACE   = 'rgba(251,146,60,0.95)';
const LABEL_EXTENSION = 'rgba(34,211,238,0.95)';

// ── Worklet helpers ───────────────────────────────────────────────────────────

function pToY(price: number, minP: number, maxP: number, top: number, h: number): number {
  'worklet';
  const range = maxP - minP;
  if (range < 1e-9) return top + h * 0.5;
  return top + ((maxP - price) / range) * h;
}

function buildHLines(
  prices: number[],
  layout: ChartLayoutParams,
  chartTop: number,
  chartH: number,
  chartAreaW: number,
): SkPath {
  'worklet';
  const path = Skia.Path.Make();
  const { minP, maxP } = layout;
  for (const price of prices) {
    // Only render levels inside the visible price range
    if (price < minP || price > maxP) continue;
    const y = pToY(price, minP, maxP, chartTop, chartH);
    path.moveTo(0, y);
    path.lineTo(chartAreaW, y);
  }
  return path;
}

// ── Hook to derive level prices ───────────────────────────────────────────────

interface FibData {
  retracePrices: number[];
  extPrices:     number[];
  labels:        string[];    // formatted "0.618  $581.90" — parallel to prices
  labelPrices:   number[];    // price of each label (for Y calculation)
  labelColors:   string[];
}

const EMPTY_FIB_DATA: FibData = {
  retracePrices: [],
  extPrices:     [],
  labels:        [],
  labelPrices:   [],
  labelColors:   [],
};

function buildFibData(count: WaveCount | undefined): FibData {
  if (!count) return EMPTY_FIB_DATA;

  // Use last candle price to evaluate hits (pass 0 to skip — we don't use hits here)
  const levels: FibLevel[] = computeFibLevels(count, 0);
  if (levels.length < 10) return EMPTY_FIB_DATA;

  const retraces = levels.slice(0, 5);
  const exts     = levels.slice(5, 10);

  const retracePrices = retraces.map((l) => l.price);
  const extPrices     = exts.map((l) => l.price);

  const labels: string[]      = [];
  const labelPrices: number[] = [];
  const labelColors: string[] = [];

  for (const l of retraces) {
    labels.push(`${l.ratio.toFixed(3)}  $${l.price.toFixed(2)}`);
    labelPrices.push(l.price);
    labelColors.push(LABEL_RETRACE);
  }
  for (const l of exts) {
    labels.push(`${l.ratio.toFixed(3)}  $${l.price.toFixed(2)}`);
    labelPrices.push(l.price);
    labelColors.push(LABEL_EXTENSION);
  }

  return { retracePrices, extPrices, labels, labelPrices, labelColors };
}

// ── Label Y positions (one per level, computed on UI thread) ──────────────────

function useLabelY(
  price: number,
  layoutDV: SharedValue<ChartLayoutParams>,
  chartTop: number,
  chartH: number,
): SharedValue<number> {
  return useDerivedValue((): number => {
    'worklet';
    const { minP, maxP } = layoutDV.value;
    const y = pToY(price, minP, maxP, chartTop, chartH);
    // Hide labels outside the visible range
    return y < chartTop || y > chartTop + chartH ? -200 : y - 3;
  });
}

// ── Label sub-component (one per fib level) ───────────────────────────────────

interface FibLabelProps {
  text:    string;
  color:   string;
  price:   number;
  layoutDV: SharedValue<ChartLayoutParams>;
  chartTop: number;
  chartH:   number;
  chartAreaW: number;
  font:    SkFont;
}

function FibLabel({ text, color, price, layoutDV, chartTop, chartH, chartAreaW, font }: FibLabelProps) {
  const y = useLabelY(price, layoutDV, chartTop, chartH);
  return <Text x={chartAreaW + 2} y={y} text={text} font={font} color={color} />;
}

// ── Public component ──────────────────────────────────────────────────────────

export interface FibonacciOverlayLayerProps {
  waveCounts:  readonly WaveCount[];
  layoutDV:    SharedValue<ChartLayoutParams>;
  chartTop:    number;
  chartDrawH:  number;
  chartAreaW:  number;
  font:        SkFont | null;
}

export function FibonacciOverlayLayer({
  waveCounts,
  layoutDV,
  chartTop,
  chartDrawH,
  chartAreaW,
  font,
}: FibonacciOverlayLayerProps) {
  const primaryCount = waveCounts[0];

  // Fib level prices computed on JS thread (don't change with pan/zoom)
  const fibData = useMemo(() => buildFibData(primaryCount), [primaryCount]);

  // Store price arrays as SharedValues for worklet access
  const retracePricesSV = useSharedValue<number[]>([]);
  const extPricesSV     = useSharedValue<number[]>([]);

  useEffect(() => {
    retracePricesSV.value = fibData.retracePrices;
    extPricesSV.value     = fibData.extPrices;
  }, [fibData, retracePricesSV, extPricesSV]);

  // Dashed line paths — recomputed when price scale or level prices change
  const retracePath = useDerivedValue((): SkPath => {
    'worklet';
    return buildHLines(retracePricesSV.value, layoutDV.value, chartTop, chartDrawH, chartAreaW);
  });

  const extPath = useDerivedValue((): SkPath => {
    'worklet';
    return buildHLines(extPricesSV.value, layoutDV.value, chartTop, chartDrawH, chartAreaW);
  });

  if (fibData.retracePrices.length === 0) return null;

  return (
    <Group>
      {/* Retracement dashed lines */}
      <Path path={retracePath} style="stroke" strokeWidth={1} color={RETRACE_COLOR}>
        <DashPathEffect intervals={[6, 4]} phase={0} />
      </Path>

      {/* Extension dashed lines */}
      <Path path={extPath} style="stroke" strokeWidth={1} color={EXTENSION_COLOR}>
        <DashPathEffect intervals={[6, 4]} phase={0} />
      </Path>

      {/* Labels — one per level, clipped to visible price range */}
      {font !== null &&
        fibData.labels.map((label, i) => (
          <FibLabel
            key={`fib-${i}`}
            text={label}
            color={fibData.labelColors[i]}
            price={fibData.labelPrices[i]}
            layoutDV={layoutDV}
            chartTop={chartTop}
            chartH={chartDrawH}
            chartAreaW={chartAreaW}
            font={font}
          />
        ))}
    </Group>
  );
}
