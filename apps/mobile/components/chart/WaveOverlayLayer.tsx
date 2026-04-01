/**
 * WaveOverlayLayer.tsx  (v2 — full wave count visualization)
 *
 * Part 1 — Primary wave count on chart:
 *   • Per-wave colored line segments
 *       Impulse  (1, 3, 5, B) → green  (#26A69A)
 *       Corrective (2, 4)     → amber  (#FF9800)
 *       Bearish (A, C)        → red    (#EF5350)
 *   • 6 px-diameter circle markers at each pivot (stroked ring)
 *   • Degree-specific label notation based on WaveCount.timeframe:
 *       1m / 5m  → (i)(ii)(iii)(iv)(v)
 *       15m/30m  → i ii iii iv v
 *       1h / 4h  → [1][2][3][4][5]
 *       1D       → ①②③④⑤
 *       1W       → (I)(II)(III)(IV)(V)
 *       default  → 1 2 3 4 5
 *   • Labels 16 px above high pivots, 18 px below low pivots (≥8 px clearance)
 *
 * Part 2 — Alternate wave count:
 *   • Gray (#8888a0) at 40 % opacity
 *   • Labels prefixed with "alt-"
 *   • Only rendered when `showAlt` prop is true AND
 *     (primaryProb − altProb) ≤ 0.30
 *
 * Invalidation / stop-price line unchanged from v1.
 */

import React from 'react';
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
import type { WaveCount } from '@elliott-wave-pro/wave-engine';
import type { ChartLayoutParams } from './chartTypes';

// ── Colors ────────────────────────────────────────────────────────────────────

const WAVE_IMPULSE_COLOR    = '#26A69A';   // green — impulse waves (1,3,5,B)
const WAVE_CORRECTIVE_COLOR = '#FF9800';   // amber — corrective waves (2,4)
const WAVE_BEARISH_COLOR    = '#EF5350';   // red   — bearish waves (A,C)
const WAVE_ALT_COLOR        = '#FF69B4';   // hot pink — alt count
const INVALIDATION_COLOR    = 'rgba(239,83,80,0.80)';

// ── Degree-based label colors ─────────────────────────────────────────────────
// Wave NUMBER labels use degree color; segment LINES use impulse/corrective/bearish.
// This gives instant visual feedback on both degree and wave type.

function getDegreeColor(timeframe: string): string {
  switch (timeframe) {
    case '1W':  return '#FFD700';   // gold    — Primary
    case '1D':  return '#FFFFFF';   // white   — Intermediate
    case '4h':  return '#00CED1';   // dark cyan — Minor
    case '1h':  return '#20B2AA';   // teal    — Minute
    case '30m': return '#B57BEE';   // lavender — Minuette
    case '15m': return '#B57BEE';   // lavender — Minuette
    case '5m':  return '#87CEEB';   // light blue — Sub-minuette
    case '1m':  return '#90EE90';   // light green — Micro
    default:    return '#AAAAAA';
  }
}

// ── Degree notation ───────────────────────────────────────────────────────────

function applyDegreeNotation(label: string, timeframe: string): string {
  const lower: Record<string, string> = {
    '1': 'i', '2': 'ii', '3': 'iii', '4': 'iv', '5': 'v',
    'A': 'a', 'B': 'b',  'C': 'c',
  };
  const roman: Record<string, string> = {
    '1': 'I', '2': 'II', '3': 'III', '4': 'IV', '5': 'V',
  };
  const circled: Record<string, string> = {
    '1': '\u2460', '2': '\u2461', '3': '\u2462', '4': '\u2463', '5': '\u2464',
  };
  switch (timeframe) {
    case '1m': case '5m':
      return `(${lower[label] ?? label.toLowerCase()})`;
    case '15m': case '30m':
      return lower[label] ?? label.toLowerCase();
    case '1h': case '4h':
      return `[${label}]`;
    case '1D':
      return circled[label] ?? label;
    case '1W':
      return `(${roman[label] ?? label})`;
    default:
      return label;
  }
}

// ── Wave color type ───────────────────────────────────────────────────────────
// 0 = impulse/green  1 = corrective/amber  2 = bearish/red

function getWaveColorType(label: string): number {
  if (label === '1' || label === '3' || label === '5' || label === 'B') return 0;
  if (label === '2' || label === '4') return 1;
  if (label === 'A' || label === 'C') return 2;
  return 0;
}

// ── Serialised form ───────────────────────────────────────────────────────────

interface PivotData {
  barIndex: number;
  price:    number;
}

interface SerializedCount {
  isBullish:   boolean;
  pivots:      PivotData[];
  labels:      string[];       // degree-notated, "alt-" prefix if alt
  colorTypes:  number[];       // 0/1/2 per wave segment
  isAlt:       boolean;
  degreeColor: string;         // label color based on timeframe degree
}

const NULL_COUNT: SerializedCount = {
  isBullish:   true,
  pivots:      [],
  labels:      [],
  colorTypes:  [],
  isAlt:       false,
  degreeColor: '#AAAAAA',
};

function serializeCount(
  count:  WaveCount,
  isAlt:  boolean,
): SerializedCount {
  const waves = count.allWaves;
  if (!waves || waves.length < 2) return NULL_COUNT;

  const w1 = waves[0];
  if (!w1.startPivot || !w1.endPivot) return NULL_COUNT;

  const pivots: PivotData[] = [
    { barIndex: w1.startPivot.index, price: w1.startPivot.price },
  ];
  for (const wave of waves) {
    if (!wave.endPivot) break;
    pivots.push({
      barIndex: wave.endPivot.index,
      price:    wave.endPivot.price,
    });
  }
  if (pivots.length < 2) return NULL_COUNT;

  const tf         = count.timeframe;
  const isBullish  = w1.startPivot.price < w1.endPivot.price;
  const colorTypes = waves.map((w) => getWaveColorType(w.label as string));
  const labels     = waves.map((w) => {
    const notated = applyDegreeNotation(w.label as string, tf);
    return isAlt ? `alt-${notated}` : notated;
  });

  const degreeColor = isAlt ? WAVE_ALT_COLOR : getDegreeColor(tf);
  return { isBullish, pivots, labels, colorTypes, isAlt, degreeColor };
}

// ── Worklet helpers ───────────────────────────────────────────────────────────

function pToY(price: number, minP: number, maxP: number, top: number, h: number): number {
  'worklet';
  const range = maxP - minP;
  if (range < 1e-9) return top + h * 0.5;
  return top + ((maxP - price) / range) * h;
}

// Segment path for one color type (0/1/2)
function buildSegmentPath(
  count:      SerializedCount,
  colorType:  number,
  tx:         number,
  cw:         number,
  layout:     ChartLayoutParams,
  chartTop:   number,
  chartH:     number,
): SkPath {
  'worklet';
  const path   = Skia.Path.Make();
  const { minP, maxP } = layout;
  const half   = cw * 0.5;
  const pivots = count.pivots;

  for (let i = 0; i < pivots.length - 1; i++) {
    const ct = count.colorTypes[i] ?? 0;
    if (ct !== colorType) continue;
    const p0 = pivots[i];
    const p1 = pivots[i + 1];
    const x0 = tx + p0.barIndex * cw + half;
    const y0 = pToY(p0.price, minP, maxP, chartTop, chartH);
    const x1 = tx + p1.barIndex * cw + half;
    const y1 = pToY(p1.price, minP, maxP, chartTop, chartH);
    path.moveTo(x0, y0);
    path.lineTo(x1, y1);
  }
  return path;
}

// Circle markers at each pivot (stroked = ring appearance)
function buildCirclePath(
  count:    SerializedCount,
  tx:       number,
  cw:       number,
  layout:   ChartLayoutParams,
  chartTop: number,
  chartH:   number,
): SkPath {
  'worklet';
  const path = Skia.Path.Make();
  const { minP, maxP } = layout;
  const half = cw * 0.5;

  for (const pivot of count.pivots) {
    const x = tx + pivot.barIndex * cw + half;
    const y = pToY(pivot.price, minP, maxP, chartTop, chartH);
    path.addCircle(x, y, 3); // 3 px radius → 6 px diameter per spec
  }
  return path;
}

// Label position: placed at pivots[pivotIdx] (1-based, endpoint of wave)
function labelPos(
  count:    SerializedCount,
  idx:      number,   // 1..5
  tx:       number,
  cw:       number,
  layout:   ChartLayoutParams,
  chartTop: number,
  chartH:   number,
): { x: number; y: number } {
  'worklet';
  const pivot = count.pivots[idx];
  if (!pivot) return { x: -200, y: -200 };
  const { minP, maxP } = layout;
  const x = tx + pivot.barIndex * cw + cw * 0.5 - 5;
  const y = pToY(pivot.price, minP, maxP, chartTop, chartH);
  const isHigh = count.isBullish ? idx % 2 === 1 : idx % 2 === 0;
  const offsetY = isHigh ? -16 : 18;   // 8 px clearance + font height
  return { x, y: y + offsetY };
}

// ── Per-count overlay component ───────────────────────────────────────────────

interface WaveCountOverlayProps {
  serialized:   SharedValue<SerializedCount>;
  translateX:   SharedValue<number>;
  candleW:      SharedValue<number>;
  layoutDV:     SharedValue<ChartLayoutParams>;
  chartTop:     number;
  chartDrawH:   number;
  opacity:      number;
  showLabels:   boolean;
  font:         SkFont | null;
}

function WaveCountOverlay({
  serialized,
  translateX,
  candleW,
  layoutDV,
  chartTop,
  chartDrawH,
  opacity,
  showLabels,
  font,
}: WaveCountOverlayProps) {

  // ── Segment paths (one per color type) ────────────────────────────────────
  const impulsePath = useDerivedValue((): SkPath => {
    'worklet';
    return buildSegmentPath(
      serialized.value, 0,
      translateX.value, candleW.value, layoutDV.value, chartTop, chartDrawH,
    );
  });
  const correctivePath = useDerivedValue((): SkPath => {
    'worklet';
    return buildSegmentPath(
      serialized.value, 1,
      translateX.value, candleW.value, layoutDV.value, chartTop, chartDrawH,
    );
  });
  const bearishPath = useDerivedValue((): SkPath => {
    'worklet';
    return buildSegmentPath(
      serialized.value, 2,
      translateX.value, candleW.value, layoutDV.value, chartTop, chartDrawH,
    );
  });

  // ── Circle markers ─────────────────────────────────────────────────────────
  const circlePath = useDerivedValue((): SkPath => {
    'worklet';
    return buildCirclePath(
      serialized.value,
      translateX.value, candleW.value, layoutDV.value, chartTop, chartDrawH,
    );
  });

  // ── Label positions ────────────────────────────────────────────────────────
  const positions = useDerivedValue(() => {
    'worklet';
    const count  = serialized.value;
    const tx     = translateX.value;
    const cw     = candleW.value;
    const layout = layoutDV.value;
    return [1, 2, 3, 4, 5].map((i) =>
      labelPos(count, i, tx, cw, layout, chartTop, chartDrawH),
    );
  });

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

  // ── Label texts ────────────────────────────────────────────────────────────
  const lbl0 = useDerivedValue(() => serialized.value.labels[0] ?? '');
  const lbl1 = useDerivedValue(() => serialized.value.labels[1] ?? '');
  const lbl2 = useDerivedValue(() => serialized.value.labels[2] ?? '');
  const lbl3 = useDerivedValue(() => serialized.value.labels[3] ?? '');
  const lbl4 = useDerivedValue(() => serialized.value.labels[4] ?? '');

  // ── Label colors — degree-based for primary, pink for alt ─────────────────
  // Segment LINES keep impulse/corrective/bearish color for wave-type signal.
  // Wave NUMBER labels use degree color so you can read both degree AND direction.
  const lbl0Color = useDerivedValue((): string => {
    'worklet'; return serialized.value.degreeColor;
  });
  const lbl1Color = useDerivedValue((): string => {
    'worklet'; return serialized.value.degreeColor;
  });
  const lbl2Color = useDerivedValue((): string => {
    'worklet'; return serialized.value.degreeColor;
  });
  const lbl3Color = useDerivedValue((): string => {
    'worklet'; return serialized.value.degreeColor;
  });
  const lbl4Color = useDerivedValue((): string => {
    'worklet'; return serialized.value.degreeColor;
  });

  // ── Segment / circle colors (pink for alt, wave-type for primary) ──────────
  const impulseColor    = useDerivedValue((): string => {
    'worklet';
    return serialized.value.isAlt ? WAVE_ALT_COLOR : WAVE_IMPULSE_COLOR;
  });
  const correctiveColor = useDerivedValue((): string => {
    'worklet';
    return serialized.value.isAlt ? WAVE_ALT_COLOR : WAVE_CORRECTIVE_COLOR;
  });
  const bearishColor    = useDerivedValue((): string => {
    'worklet';
    return serialized.value.isAlt ? WAVE_ALT_COLOR : WAVE_BEARISH_COLOR;
  });
  const circleColor     = useDerivedValue((): string => {
    'worklet';
    return serialized.value.isAlt ? WAVE_ALT_COLOR : WAVE_IMPULSE_COLOR;
  });

  // ── Render ─────────────────────────────────────────────────────────────────
  const strokeW = serialized.value.isAlt ? 1.0 : 1.8;

  if (font === null) {
    return (
      <Group opacity={opacity}>
        <Path path={impulsePath}    color={impulseColor}    style="stroke" strokeWidth={strokeW} />
        <Path path={correctivePath} color={correctiveColor} style="stroke" strokeWidth={strokeW} />
        <Path path={bearishPath}    color={bearishColor}    style="stroke" strokeWidth={strokeW} />
        <Path path={circlePath}     color={circleColor}     style="stroke" strokeWidth={1.2} />
      </Group>
    );
  }

  return (
    <Group opacity={opacity}>
      {/* Wave segments — each in its own color */}
      <Path path={impulsePath}    color={impulseColor}    style="stroke" strokeWidth={strokeW} />
      <Path path={correctivePath} color={correctiveColor} style="stroke" strokeWidth={strokeW} />
      <Path path={bearishPath}    color={bearishColor}    style="stroke" strokeWidth={strokeW} />

      {/* Circle markers at each pivot */}
      <Path path={circlePath} color={circleColor} style="stroke" strokeWidth={1.2} />

      {/* Wave labels — hidden when showLabels=false */}
      {showLabels && <Text x={x1} y={y1} text={lbl0} font={font} color={lbl0Color} />}
      {showLabels && <Text x={x2} y={y2} text={lbl1} font={font} color={lbl1Color} />}
      {showLabels && <Text x={x3} y={y3} text={lbl2} font={font} color={lbl2Color} />}
      {showLabels && <Text x={x4} y={y4} text={lbl3} font={font} color={lbl3Color} />}
      {showLabels && <Text x={x5} y={y5} text={lbl4} font={font} color={lbl4Color} />}
    </Group>
  );
}

// ── Public component ──────────────────────────────────────────────────────────

export interface WaveOverlayLayerProps {
  waveCounts:      readonly WaveCount[];
  translateX:      SharedValue<number>;
  candleW:         SharedValue<number>;
  layoutDV:        SharedValue<ChartLayoutParams>;
  chartTop:        number;
  chartDrawH:      number;
  chartAreaW:      number;
  activeStopPrice: number;
  /** Show the second-probability alternate count (Part 2). */
  showAlt:         boolean;
  /** Show wave number labels (1-5 / A-B-C) on pivot points. */
  showWaveLabels:  boolean;
  font:            SkFont | null;
}

export function WaveOverlayLayer({
  waveCounts,
  translateX,
  candleW,
  layoutDV,
  chartTop,
  chartDrawH,
  chartAreaW,
  activeStopPrice,
  showAlt,
  showWaveLabels,
  font,
}: WaveOverlayLayerProps) {
  const primarySV   = useSharedValue<SerializedCount>(NULL_COUNT);
  const secondarySV = useSharedValue<SerializedCount>(NULL_COUNT);
  const stopPriceSV = useSharedValue<number>(0);

  // Sync serialized counts whenever inputs change
  useEffect(() => {
    primarySV.value = waveCounts[0]
      ? serializeCount(waveCounts[0], false)
      : NULL_COUNT;

    if (showAlt && waveCounts[0] && waveCounts[1]) {
      const pProb = waveCounts[0].posterior.posterior;
      const aProb = waveCounts[1].posterior.posterior;
      const withinThreshold = pProb - aProb <= 0.30;
      secondarySV.value = withinThreshold
        ? serializeCount(waveCounts[1], true)
        : NULL_COUNT;
    } else {
      secondarySV.value = NULL_COUNT;
    }
  }, [waveCounts, showAlt, primarySV, secondarySV]);

  useEffect(() => {
    stopPriceSV.value = activeStopPrice;
  }, [activeStopPrice, stopPriceSV]);

  // ── Invalidation line ───────────────────────────────────────────────────────
  const invalidationPath = useDerivedValue((): SkPath => {
    'worklet';
    const stopP = stopPriceSV.value;
    const path  = Skia.Path.Make();
    if (stopP <= 0) return path;
    const { minP, maxP } = layoutDV.value;
    const range = maxP - minP;
    if (range < 1e-9) return path;
    const y = chartTop + ((maxP - stopP) / range) * chartDrawH;
    if (y < chartTop || y > chartTop + chartDrawH) return path;
    path.moveTo(0, y);
    path.lineTo(chartAreaW, y);
    return path;
  });

  const invalidationLabelY = useDerivedValue((): number => {
    'worklet';
    const stopP = stopPriceSV.value;
    if (stopP <= 0) return -200;
    const { minP, maxP } = layoutDV.value;
    const range = maxP - minP;
    if (range < 1e-9) return -200;
    const y = chartTop + ((maxP - stopP) / range) * chartDrawH;
    return y < chartTop || y > chartTop + chartDrawH ? -200 : y - 3;
  });

  const invalidationLabel = activeStopPrice > 0
    ? `Inv: $${activeStopPrice.toFixed(2)}`
    : '';

  return (
    <>
      {/* Alternate count — dimmed, gray, "alt-" labels */}
      <WaveCountOverlay
        serialized={secondarySV}
        translateX={translateX}
        candleW={candleW}
        layoutDV={layoutDV}
        chartTop={chartTop}
        chartDrawH={chartDrawH}
        opacity={0.40}
        showLabels={showWaveLabels}
        font={font}
      />

      {/* Primary count — full opacity, per-wave colors */}
      <WaveCountOverlay
        serialized={primarySV}
        translateX={translateX}
        candleW={candleW}
        layoutDV={layoutDV}
        chartTop={chartTop}
        chartDrawH={chartDrawH}
        opacity={1.0}
        showLabels={showWaveLabels}
        font={font}
      />

      {/* Invalidation / stop-price dashed line */}
      {activeStopPrice > 0 && (
        <Group>
          <Path
            path={invalidationPath}
            color={INVALIDATION_COLOR}
            style="stroke"
            strokeWidth={1.5}
          >
            <DashPathEffect intervals={[8, 5]} phase={0} />
          </Path>
          {font !== null && invalidationLabel !== '' && (
            <Text
              x={4}
              y={invalidationLabelY}
              text={invalidationLabel}
              font={font}
              color={INVALIDATION_COLOR}
            />
          )}
        </Group>
      )}
    </>
  );
}
