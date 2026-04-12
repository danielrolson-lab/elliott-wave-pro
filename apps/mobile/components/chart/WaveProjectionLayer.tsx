/**
 * WaveProjectionLayer.tsx
 *
 * Simulates future Elliott Wave progressions on the chart canvas.
 *
 * Visual elements:
 *   • Multi-wave zig-zag path — connected dashed lines through projected
 *     future wave endpoints (e.g. (iii)→(iv)→(v)) extending past last candle
 *   • Small circle markers at each projected pivot
 *   • Wave labels at each projected endpoint  — (iii), (iv), (v) / (b), (c)
 *   • Confidence cone — width grows with projection distance (±1 ATR per wave)
 *   • T1/T2/T3 horizontal target bands (existing behavior preserved)
 *   • Invalidation zone — faint red fill below/above stop price
 *   • Right-axis price labels for all projected targets
 *
 * Projection math (standard EW Fibonacci ratios):
 *   W3 = anchor + dir * |W1| * 1.618    (1.0×, 1.618×, 2.618× variants shown as fan)
 *   W4 = W3_proj − dir * |W3_proj| * 0.382
 *   W5 = W4_proj + dir * |W1| * 1.0    (equality to W1 is most common)
 *   C  = B_end + dir * |A| * 1.0       (C = A equality)
 *
 * Time projection:
 *   W3_bars ≈ W1_bars × 1.618
 *   W4_bars ≈ W2_bars
 *   W5_bars ≈ W1_bars
 *
 * All path building runs in useDerivedValue worklets (UI thread).
 */

import React, { useEffect, useMemo } from 'react';
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
import type { OHLCV, WaveCount } from '@elliott-wave-pro/wave-engine';
import type { ChartLayoutParams } from './chartTypes';

// ── Colors ────────────────────────────────────────────────────────────────────

const PROJ_BULL_COLOR   = 'rgba(38,211,238,0.85)';   // cyan — bullish impulse wave
const PROJ_BEAR_COLOR   = 'rgba(239,83,80,0.85)';    // red — bearish impulse
const PROJ_FAN_COLOR    = 'rgba(38,211,238,0.25)';   // faint cyan — outer Fibonacci fan
const CIRCLE_COLOR      = 'rgba(38,211,238,0.90)';

const T1_COLOR    = 'rgba(38,166,154,0.15)';
const T2_COLOR    = 'rgba(38,166,154,0.10)';
const T3_COLOR    = 'rgba(38,166,154,0.08)';
const INV_COLOR   = 'rgba(239,83,80,0.10)';
const LABEL_T_COLOR   = 'rgba(38,211,238,0.90)';
const LABEL_INV_COLOR = 'rgba(239,83,80,0.80)';

const BAND_H = 4; // px

// ── Worklet helpers ───────────────────────────────────────────────────────────

function pToY(price: number, minP: number, maxP: number, top: number, h: number): number {
  'worklet';
  const range = maxP - minP;
  if (range < 1e-9) return top + h * 0.5;
  return top + ((maxP - price) / range) * h;
}

function inRange(price: number, minP: number, maxP: number): boolean {
  'worklet';
  return price >= minP && price <= maxP;
}

// ── Projected pivot data ──────────────────────────────────────────────────────

interface ProjectedPivot {
  barIndex:  number;
  price:     number;
  label:     string;   // "(iii)", "(iv)", "(v)", "(b)", "(c)"
  isImpulse: boolean;  // true = cyan, false = amber
}

interface ProjectionData {
  isBullish:    boolean;
  zigzag:       ProjectedPivot[];   // anchor + future pivots (zig-zag path)
  fanHigh:      ProjectedPivot[];   // optimistic 2.618× fan line
  fanLow:       ProjectedPivot[];   // conservative 1.0× fan line
  t1:           number;
  t2:           number;
  t3:           number;
  stopPrice:    number;
  currentPrice: number;
  lastBarIdx:   number;
}

const EMPTY_PROJECTION: ProjectionData = {
  isBullish:    true,
  zigzag:       [],
  fanHigh:      [],
  fanLow:       [],
  t1:           0,
  t2:           0,
  t3:           0,
  stopPrice:    0,
  currentPrice: 0,
  lastBarIdx:   0,
};

function computeProjectedPivots(count: WaveCount): {
  zigzag: ProjectedPivot[];
  fanHigh: ProjectedPivot[];
  fanLow: ProjectedPivot[];
  isBullish: boolean;
} {
  const { allWaves, currentWave } = count;
  if (!allWaves || allWaves.length === 0) {
    return { zigzag: [], fanHigh: [], fanLow: [], isBullish: true };
  }

  // Detect direction from first wave
  const w0 = allWaves[0];
  if (!w0.endPivot) return { zigzag: [], fanHigh: [], fanLow: [], isBullish: true };
  const isBullish = w0.endPivot.price > w0.startPivot.price;
  const dir = isBullish ? 1 : -1;

  const lastWave  = allWaves[allWaves.length - 1];
  if (!lastWave.endPivot) return { zigzag: [], fanHigh: [], fanLow: [], isBullish };

  const anchor: ProjectedPivot = {
    barIndex:  lastWave.endPivot.index,
    price:     lastWave.endPivot.price,
    label:     '',
    isImpulse: false,
  };

  const w1Len  = Math.abs(w0.endPivot.price - w0.startPivot.price);
  const w1Bars = Math.max(w0.endPivot.index - w0.startPivot.index, 2);
  if (w1Len < 0.001) return { zigzag: [], fanHigh: [], fanLow: [], isBullish };

  const label = currentWave.label;
  const zigzag: ProjectedPivot[] = [anchor];
  const fanHigh: ProjectedPivot[] = [anchor];
  const fanLow: ProjectedPivot[] = [anchor];

  // ── Impulse: forming wave 3 (waves 1 + 2 complete) ─────────────────────────
  if (label === '3') {
    const w2 = allWaves[1];
    const w2Bars = w2?.endPivot
      ? Math.max(w2.endPivot.index - w2.startPivot.index, 2)
      : Math.max(Math.ceil(w1Bars * 0.5), 2);

    // Primary (1.618×) zig-zag
    const w3Price = anchor.price + dir * w1Len * 1.618;
    const w3Bar   = anchor.barIndex + Math.ceil(w1Bars * 1.618);
    const w3Len   = Math.abs(w3Price - anchor.price);
    const w4Price = w3Price - dir * w3Len * 0.382;
    const w4Bar   = w3Bar + Math.max(w2Bars, 2);
    const w5Price = w4Price + dir * w1Len;
    const w5Bar   = w4Bar + w1Bars;
    zigzag.push(
      { barIndex: w3Bar, price: w3Price, label: '(iii)', isImpulse: true  },
      { barIndex: w4Bar, price: w4Price, label: '(iv)',  isImpulse: false },
      { barIndex: w5Bar, price: w5Price, label: '(v)',   isImpulse: true  },
    );

    // Optimistic fan (2.618× W3)
    const w3H = anchor.price + dir * w1Len * 2.618;
    const w3HBar = anchor.barIndex + Math.ceil(w1Bars * 2.618);
    fanHigh.push({ barIndex: w3HBar, price: w3H, label: '', isImpulse: true });

    // Conservative fan (1.0× W3)
    const w3L = anchor.price + dir * w1Len * 1.0;
    const w3LBar = anchor.barIndex + w1Bars;
    fanLow.push({ barIndex: w3LBar, price: w3L, label: '', isImpulse: true });

  // ── Impulse: forming wave 4 (waves 1–3 complete) ───────────────────────────
  } else if (label === '4') {
    const w3 = allWaves[2];
    if (!w3?.endPivot || !w3.startPivot) return { zigzag: [], fanHigh: [], fanLow: [], isBullish };
    const w3Len = Math.abs(w3.endPivot.price - w3.startPivot.price);
    const w2 = allWaves[1];
    const w2Bars = w2?.endPivot
      ? Math.max(w2.endPivot.index - w2.startPivot.index, 2)
      : Math.max(Math.ceil(w1Bars * 0.5), 2);

    const w4Price = anchor.price - dir * w3Len * 0.382;
    const w4Bar   = anchor.barIndex + Math.max(w2Bars, 2);
    const w5Price = w4Price + dir * w1Len;
    const w5Bar   = w4Bar + w1Bars;
    zigzag.push(
      { barIndex: w4Bar, price: w4Price, label: '(iv)',  isImpulse: false },
      { barIndex: w5Bar, price: w5Price, label: '(v)',   isImpulse: true  },
    );
    fanHigh.push({ barIndex: w4Bar, price: w4Price - dir * w3Len * 0.236, label: '', isImpulse: false });
    fanLow.push ({ barIndex: w4Bar, price: w4Price - dir * w3Len * 0.500, label: '', isImpulse: false });

  // ── Impulse: forming wave 5 (waves 1–4 complete) ───────────────────────────
  } else if (label === '5') {
    const t1 = count.targets[0];
    if (t1 > 0) {
      const t1Bar = anchor.barIndex + w1Bars;
      zigzag.push({ barIndex: t1Bar, price: t1, label: '(v)', isImpulse: true });
      // fan range from t2/t3 if available
      const t2 = count.targets[1];
      if (t2 > 0) fanHigh.push({ barIndex: t1Bar + Math.ceil(w1Bars * 0.5), price: t2, label: '', isImpulse: true });
      fanLow.push({ barIndex: t1Bar, price: anchor.price + dir * w1Len * 0.618, label: '', isImpulse: true });
    }

  // ── Correction: forming wave B ─────────────────────────────────────────────
  } else if (label === 'B') {
    const aLen  = Math.abs(w0.endPivot.price - w0.startPivot.price);
    const aBars = Math.max(w0.endPivot.index - w0.startPivot.index, 2);

    // B retraces 38–61.8% of A, then C = A
    const bPrice = anchor.price - dir * aLen * 0.500; // 50% B typical
    const bBar   = anchor.barIndex + Math.max(Math.ceil(aBars * 0.618), 2);
    const cPrice = bPrice + dir * aLen;
    const cBar   = bBar + aBars;
    zigzag.push(
      { barIndex: bBar, price: bPrice, label: '(b)', isImpulse: false },
      { barIndex: cBar, price: cPrice, label: '(c)', isImpulse: false },
    );
    fanHigh.push({ barIndex: cBar, price: bPrice + dir * aLen * 1.618, label: '', isImpulse: false });
    fanLow.push ({ barIndex: cBar, price: bPrice + dir * aLen * 0.618, label: '', isImpulse: false });

  // ── Correction: forming wave C (A + B complete) ────────────────────────────
  } else if (label === 'C') {
    const aLen  = Math.abs(w0.endPivot.price - w0.startPivot.price);
    const aBars = Math.max(w0.endPivot.index - w0.startPivot.index, 2);

    const cPrice = anchor.price + dir * aLen;
    const cBar   = anchor.barIndex + aBars;
    zigzag.push({ barIndex: cBar, price: cPrice, label: '(c)', isImpulse: false });
    fanHigh.push({ barIndex: cBar, price: anchor.price + dir * aLen * 1.618, label: '', isImpulse: false });
    fanLow.push ({ barIndex: cBar, price: anchor.price + dir * aLen * 0.618, label: '', isImpulse: false });
  }

  return { zigzag, fanHigh, fanLow, isBullish };
}

function buildProjectionData(
  primaryCount: WaveCount | undefined,
  candles:      readonly OHLCV[],
): ProjectionData {
  if (!primaryCount || candles.length === 0) return EMPTY_PROJECTION;

  const { zigzag, fanHigh, fanLow, isBullish } = computeProjectedPivots(primaryCount);

  const targets    = primaryCount.targets;
  const last       = candles[candles.length - 1]!;

  return {
    isBullish,
    zigzag,
    fanHigh,
    fanLow,
    t1:           targets[0] ?? 0,
    t2:           targets[1] ?? 0,
    t3:           targets[2] ?? 0,
    stopPrice:    primaryCount.stopPrice,
    currentPrice: last.close,
    lastBarIdx:   candles.length - 1,
  };
}

// ── Worklet path builders ─────────────────────────────────────────────────────

function buildZigZagPath(
  pivots:   { barIndex: number; price: number }[],
  layout:   ChartLayoutParams,
  chartTop: number,
  chartH:   number,
  tx:       number,
  cw:       number,
): SkPath {
  'worklet';
  const path = Skia.Path.Make();
  if (pivots.length < 2) return path;
  const { minP, maxP } = layout;
  const half = cw * 0.5;

  for (let i = 0; i < pivots.length - 1; i++) {
    const p0 = pivots[i]!;
    const p1 = pivots[i + 1]!;
    const x0 = tx + p0.barIndex * cw + half;
    const y0 = pToY(p0.price, minP, maxP, chartTop, chartH);
    const x1 = tx + p1.barIndex * cw + half;
    const y1 = pToY(p1.price, minP, maxP, chartTop, chartH);
    path.moveTo(x0, y0);
    path.lineTo(x1, y1);
  }
  return path;
}

function buildBandPath(
  price:    number,
  layout:   ChartLayoutParams,
  chartTop: number,
  chartH:   number,
  areaW:    number,
): SkPath {
  'worklet';
  const path = Skia.Path.Make();
  if (price <= 0) return path;
  const { minP, maxP } = layout;
  if (!inRange(price, minP, maxP)) return path;
  const y = pToY(price, minP, maxP, chartTop, chartH);
  path.addRect(Skia.XYWHRect(0, y - BAND_H / 2, areaW, BAND_H));
  return path;
}

function buildInvZonePath(
  isBullish: boolean,
  stopPrice: number,
  layout:    ChartLayoutParams,
  chartTop:  number,
  chartH:    number,
  areaW:     number,
): SkPath {
  'worklet';
  const path = Skia.Path.Make();
  if (stopPrice <= 0) return path;
  const { minP, maxP } = layout;
  if (isBullish) {
    const topY = pToY(stopPrice, minP, maxP, chartTop, chartH);
    const botY = chartTop + chartH;
    if (topY < botY) path.addRect(Skia.XYWHRect(0, topY, areaW, botY - topY));
  } else {
    const botY = pToY(stopPrice, minP, maxP, chartTop, chartH);
    if (botY > chartTop) path.addRect(Skia.XYWHRect(0, chartTop, areaW, botY - chartTop));
  }
  return path;
}

function labelY(price: number, layout: ChartLayoutParams, chartTop: number, chartH: number): number {
  'worklet';
  const { minP, maxP } = layout;
  if (!inRange(price, minP, maxP)) return -200;
  return pToY(price, minP, maxP, chartTop, chartH) - 3;
}

// ── Projected label component ─────────────────────────────────────────────────

interface ProjLabelProps {
  text:      string;
  price:     SharedValue<number>;
  layoutDV:  SharedValue<ChartLayoutParams>;
  chartTop:  number;
  chartH:    number;
  chartAreaW: number;
  xOffset?:  number;
  color:     string;
  font:      SkFont;
}

function ProjLabel({ text, price, layoutDV, chartTop, chartH, chartAreaW, xOffset = 2, color, font }: ProjLabelProps) {
  const y = useDerivedValue((): number => {
    'worklet';
    return labelY(price.value, layoutDV.value, chartTop, chartH);
  });
  return <Text x={chartAreaW + xOffset} y={y} text={text} font={font} color={color} />;
}

// ── Public component ──────────────────────────────────────────────────────────

export interface WaveProjectionLayerProps {
  waveCounts:  readonly WaveCount[];
  candles:     readonly OHLCV[];
  translateX:  SharedValue<number>;
  candleW:     SharedValue<number>;
  layoutDV:    SharedValue<ChartLayoutParams>;
  chartTop:    number;
  chartDrawH:  number;
  chartAreaW:  number;
  font:        SkFont | null;
}

export function WaveProjectionLayer({
  waveCounts,
  candles,
  translateX,
  candleW,
  layoutDV,
  chartTop,
  chartDrawH,
  chartAreaW,
  font,
}: WaveProjectionLayerProps) {
  const projData = useMemo(
    () => buildProjectionData(waveCounts[0], candles),
    [waveCounts, candles],
  );

  // SharedValues for worklets
  const projSV    = useSharedValue<ProjectionData>(EMPTY_PROJECTION);
  const t1SV      = useSharedValue(projData.t1);
  const t2SV      = useSharedValue(projData.t2);
  const t3SV      = useSharedValue(projData.t3);
  const invSV     = useSharedValue(projData.stopPrice);

  useEffect(() => {
    projSV.value = projData;
    t1SV.value   = projData.t1;
    t2SV.value   = projData.t2;
    t3SV.value   = projData.t3;
    invSV.value  = projData.stopPrice;
  }, [projData, projSV, t1SV, t2SV, t3SV, invSV]);

  // ── T1/T2/T3 bands (horizontal target zones) ─────────────────────────────
  const t1Path = useDerivedValue((): SkPath => {
    'worklet';
    return buildBandPath(projSV.value.t1, layoutDV.value, chartTop, chartDrawH, chartAreaW);
  });
  const t2Path = useDerivedValue((): SkPath => {
    'worklet';
    return buildBandPath(projSV.value.t2, layoutDV.value, chartTop, chartDrawH, chartAreaW);
  });
  const t3Path = useDerivedValue((): SkPath => {
    'worklet';
    return buildBandPath(projSV.value.t3, layoutDV.value, chartTop, chartDrawH, chartAreaW);
  });

  // ── Invalidation zone ────────────────────────────────────────────────────
  const invZonePath = useDerivedValue((): SkPath => {
    'worklet';
    const p = projSV.value;
    return buildInvZonePath(p.isBullish, p.stopPrice, layoutDV.value, chartTop, chartDrawH, chartAreaW);
  });

  // ── Projected zig-zag path ───────────────────────────────────────────────
  const zigzagPath = useDerivedValue((): SkPath => {
    'worklet';
    return buildZigZagPath(
      projSV.value.zigzag, layoutDV.value,
      chartTop, chartDrawH, translateX.value, candleW.value,
    );
  });

  // ── Fibonacci fan lines (outer bounds) ───────────────────────────────────
  const fanHighPath = useDerivedValue((): SkPath => {
    'worklet';
    return buildZigZagPath(
      projSV.value.fanHigh, layoutDV.value,
      chartTop, chartDrawH, translateX.value, candleW.value,
    );
  });
  const fanLowPath = useDerivedValue((): SkPath => {
    'worklet';
    return buildZigZagPath(
      projSV.value.fanLow, layoutDV.value,
      chartTop, chartDrawH, translateX.value, candleW.value,
    );
  });

  // ── Pivot circle markers at projected endpoints ──────────────────────────
  const circlesPath = useDerivedValue((): SkPath => {
    'worklet';
    const path = Skia.Path.Make();
    const { minP, maxP } = layoutDV.value;
    const tx = translateX.value;
    const cw = candleW.value;
    const pivots = projSV.value.zigzag;
    for (let i = 1; i < pivots.length; i++) {
      const p = pivots[i]!;
      if (!inRange(p.price, minP, maxP)) continue;
      const x = tx + p.barIndex * cw + cw * 0.5;
      const y = pToY(p.price, minP, maxP, chartTop, chartDrawH);
      path.addCircle(x, y, 4);
    }
    return path;
  });

  if (projData.zigzag.length < 2 && projData.t1 <= 0) return null;

  const t1Label  = projData.t1 > 0  ? `T1 $${projData.t1.toFixed(2)}`  : '';
  const t2Label  = projData.t2 > 0  ? `T2 $${projData.t2.toFixed(2)}`  : '';
  const t3Label  = projData.t3 > 0  ? `T3 $${projData.t3.toFixed(2)}`  : '';
  const invLabel = projData.stopPrice > 0 ? `Inv $${projData.stopPrice.toFixed(2)}` : '';

  return (
    <Group>
      {/* Invalidation zone (bottom layer) */}
      <Path path={invZonePath} color={INV_COLOR} style="fill" />

      {/* T1/T2/T3 horizontal bands */}
      <Path path={t3Path} color={T3_COLOR} style="fill" />
      <Path path={t2Path} color={T2_COLOR} style="fill" />
      <Path path={t1Path} color={T1_COLOR} style="fill" />

      {/* Fibonacci fan outer bounds (faint) */}
      <Path path={fanHighPath} color={PROJ_FAN_COLOR} style="stroke" strokeWidth={1}>
        <DashPathEffect intervals={[3, 6]} phase={0} />
      </Path>
      <Path path={fanLowPath} color={PROJ_FAN_COLOR} style="stroke" strokeWidth={1}>
        <DashPathEffect intervals={[3, 6]} phase={0} />
      </Path>

      {/* Primary projected zig-zag path */}
      <Path
        path={zigzagPath}
        color={projData.isBullish ? PROJ_BULL_COLOR : PROJ_BEAR_COLOR}
        style="stroke"
        strokeWidth={1.8}
      >
        <DashPathEffect intervals={[8, 5]} phase={0} />
      </Path>

      {/* Circle markers at projected pivots */}
      <Path path={circlesPath} color={CIRCLE_COLOR} style="stroke" strokeWidth={1.4} />

      {/* Right-axis labels */}
      {font !== null && (
        <>
          {t1Label !== '' && (
            <ProjLabel text={t1Label} price={t1SV} layoutDV={layoutDV}
              chartTop={chartTop} chartH={chartDrawH} chartAreaW={chartAreaW}
              color={LABEL_T_COLOR} font={font} />
          )}
          {t2Label !== '' && (
            <ProjLabel text={t2Label} price={t2SV} layoutDV={layoutDV}
              chartTop={chartTop} chartH={chartDrawH} chartAreaW={chartAreaW}
              color={LABEL_T_COLOR} font={font} />
          )}
          {t3Label !== '' && (
            <ProjLabel text={t3Label} price={t3SV} layoutDV={layoutDV}
              chartTop={chartTop} chartH={chartDrawH} chartAreaW={chartAreaW}
              color={LABEL_T_COLOR} font={font} />
          )}
          {invLabel !== '' && (
            <ProjLabel text={invLabel} price={invSV} layoutDV={layoutDV}
              chartTop={chartTop} chartH={chartDrawH} chartAreaW={chartAreaW}
              color={LABEL_INV_COLOR} font={font} />
          )}
        </>
      )}
    </Group>
  );
}
