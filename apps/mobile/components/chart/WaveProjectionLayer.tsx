/**
 * WaveProjectionLayer.tsx
 *
 * Part 3 — Wave projections drawn on the Skia canvas.
 *
 * From the most recent confirmed pivot:
 *   • T1 / T2 / T3 target zones — thin horizontal filled bands
 *       T1: rgba(38,166,154,0.15)  green, 15 % opacity
 *       T2: rgba(38,166,154,0.10)  green, 10 % opacity
 *       T3: rgba(38,166,154,0.08)  green,  8 % opacity
 *   • Invalidation zone — red shaded area from stop price to chart edge
 *       rgba(239,83,80,0.10)
 *   • Projected path — dashed teal line from current candle to T1,
 *     extending to the right edge of the chart
 *   • T1 / T2 / T3 price labels on the right axis
 *
 * All drawing happens in useDerivedValue worklets on the UI thread, so
 * everything pans / zooms correctly with no JS thread involvement.
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

const T1_COLOR     = 'rgba(38,166,154,0.15)';
const T2_COLOR     = 'rgba(38,166,154,0.10)';
const T3_COLOR     = 'rgba(38,166,154,0.08)';
const INV_COLOR    = 'rgba(239,83,80,0.10)';
const PATH_COLOR   = 'rgba(38,211,238,0.80)';   // bright teal dashed line
const LABEL_T_COLOR  = 'rgba(38,211,238,0.90)';
const LABEL_INV_COLOR = 'rgba(239,83,80,0.80)';

const BAND_H = 4; // px — height of each target band

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

// ── Serialised form ───────────────────────────────────────────────────────────

interface ProjectionData {
  isBullish:   boolean;
  t1:          number;
  t2:          number;
  t3:          number;
  stopPrice:   number;
  currentPrice: number;
  lastBarIdx:  number;  // candles.length - 1
}

const EMPTY_PROJECTION: ProjectionData = {
  isBullish:    true,
  t1:           0,
  t2:           0,
  t3:           0,
  stopPrice:    0,
  currentPrice: 0,
  lastBarIdx:   0,
};

function buildProjectionData(
  primaryCount: WaveCount | undefined,
  candles:      readonly OHLCV[],
): ProjectionData {
  if (!primaryCount || candles.length === 0) return EMPTY_PROJECTION;
  const targets  = primaryCount.targets;
  const t1 = targets[0] ?? 0;
  const t2 = targets[1] ?? 0;
  const t3 = targets[2] ?? 0;
  if (t1 <= 0) return EMPTY_PROJECTION;

  const last    = candles[candles.length - 1];
  const w1      = primaryCount.allWaves[0];
  const isBull  = w1 ? w1.startPivot.price < (w1.endPivot?.price ?? w1.startPivot.price) : true;

  return {
    isBullish:    isBull,
    t1,
    t2,
    t3,
    stopPrice:    primaryCount.stopPrice,
    currentPrice: last.close,
    lastBarIdx:   candles.length - 1,
  };
}

// ── Path builders (worklets) ──────────────────────────────────────────────────

function buildBandPath(
  price:     number,
  layout:    ChartLayoutParams,
  chartTop:  number,
  chartH:    number,
  areaW:     number,
): SkPath {
  'worklet';
  const path = Skia.Path.Make();
  if (price <= 0) return path;
  const { minP, maxP } = layout;
  if (!inRange(price, minP, maxP)) return path;
  const y = pToY(price, minP, maxP, chartTop, chartH);
  const rect = Skia.XYWHRect(0, y - BAND_H / 2, areaW, BAND_H);
  path.addRect(rect);
  return path;
}

function buildInvZonePath(
  proj:      ProjectionData,
  layout:    ChartLayoutParams,
  chartTop:  number,
  chartH:    number,
  areaW:     number,
): SkPath {
  'worklet';
  const path = Skia.Path.Make();
  const stop = proj.stopPrice;
  if (stop <= 0) return path;
  const { minP, maxP } = layout;

  if (proj.isBullish) {
    // Shade below stop price — anything below is invalidation territory
    const topY = pToY(stop, minP, maxP, chartTop, chartH);
    const botY = chartTop + chartH;
    if (topY >= botY) return path;
    path.addRect(Skia.XYWHRect(0, topY, areaW, botY - topY));
  } else {
    // Shade above stop price for bearish counts
    const botY = pToY(stop, minP, maxP, chartTop, chartH);
    if (botY <= chartTop) return path;
    path.addRect(Skia.XYWHRect(0, chartTop, areaW, botY - chartTop));
  }
  return path;
}

function buildProjectedLinePath(
  proj:      ProjectionData,
  layout:    ChartLayoutParams,
  chartTop:  number,
  chartH:    number,
  tx:        number,
  cw:        number,
  areaW:     number,
): SkPath {
  'worklet';
  const path = Skia.Path.Make();
  if (proj.t1 <= 0 || proj.lastBarIdx < 0) return path;
  const { minP, maxP } = layout;

  const startX = tx + proj.lastBarIdx * cw + cw * 0.5;
  const startY = pToY(proj.currentPrice, minP, maxP, chartTop, chartH);
  const endY   = pToY(proj.t1, minP, maxP, chartTop, chartH);

  // Only draw if start is within visible area and T1 is in range
  if (startX > areaW) return path;
  if (!inRange(proj.t1, minP, maxP)) return path;

  const clampedStartX = Math.max(0, startX);
  path.moveTo(clampedStartX, startY);
  path.lineTo(areaW, endY);
  return path;
}

// Label Y helper (clamped to chart, hidden if out of range)
function labelY(
  price:    number,
  layout:   ChartLayoutParams,
  chartTop: number,
  chartH:   number,
): number {
  'worklet';
  const { minP, maxP } = layout;
  if (!inRange(price, minP, maxP)) return -200;
  return pToY(price, minP, maxP, chartTop, chartH) - 3;
}

// ── Sub-label component ───────────────────────────────────────────────────────

interface ProjLabelProps {
  text:      string;
  price:     SharedValue<number>;
  layoutDV:  SharedValue<ChartLayoutParams>;
  chartTop:  number;
  chartH:    number;
  chartAreaW: number;
  color:     string;
  font:      SkFont;
}

function ProjLabel({
  text, price, layoutDV, chartTop, chartH, chartAreaW, color, font,
}: ProjLabelProps) {
  const y = useDerivedValue((): number => {
    'worklet';
    return labelY(price.value, layoutDV.value, chartTop, chartH);
  });
  return (
    <Text
      x={chartAreaW + 2}
      y={y}
      text={text}
      font={font}
      color={color}
    />
  );
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

  const projSV = useSharedValue<ProjectionData>(EMPTY_PROJECTION);
  useEffect(() => {
    projSV.value = projData;
  }, [projData, projSV]);

  // T1 / T2 / T3 / stopPrice as individual SharedValues (for ProjLabel)
  const t1SV   = useSharedValue(projData.t1);
  const t2SV   = useSharedValue(projData.t2);
  const t3SV   = useSharedValue(projData.t3);
  const invSV  = useSharedValue(projData.stopPrice);

  useEffect(() => {
    t1SV.value  = projData.t1;
    t2SV.value  = projData.t2;
    t3SV.value  = projData.t3;
    invSV.value = projData.stopPrice;
  }, [projData, t1SV, t2SV, t3SV, invSV]);

  // ── Target band paths ───────────────────────────────────────────────────────
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

  // ── Invalidation zone ───────────────────────────────────────────────────────
  const invZonePath = useDerivedValue((): SkPath => {
    'worklet';
    return buildInvZonePath(projSV.value, layoutDV.value, chartTop, chartDrawH, chartAreaW);
  });

  // ── Projected dashed line ───────────────────────────────────────────────────
  const projLinePath = useDerivedValue((): SkPath => {
    'worklet';
    return buildProjectedLinePath(
      projSV.value, layoutDV.value, chartTop, chartDrawH,
      translateX.value, candleW.value, chartAreaW,
    );
  });

  if (projData.t1 <= 0) return null;

  // Format labels
  const t1Label  = `T1 $${projData.t1.toFixed(2)}`;
  const t2Label  = projData.t2 > 0 ? `T2 $${projData.t2.toFixed(2)}` : '';
  const t3Label  = projData.t3 > 0 ? `T3 $${projData.t3.toFixed(2)}` : '';
  const invLabel = projData.stopPrice > 0 ? `Inv $${projData.stopPrice.toFixed(2)}` : '';

  return (
    <Group>
      {/* Invalidation zone (draw first — lowest layer) */}
      <Path path={invZonePath} color={INV_COLOR} style="fill" />

      {/* Target bands */}
      <Path path={t3Path} color={T3_COLOR} style="fill" />
      <Path path={t2Path} color={T2_COLOR} style="fill" />
      <Path path={t1Path} color={T1_COLOR} style="fill" />

      {/* Projected path dashed line */}
      <Path
        path={projLinePath}
        color={PATH_COLOR}
        style="stroke"
        strokeWidth={1.5}
      >
        <DashPathEffect intervals={[6, 4]} phase={0} />
      </Path>

      {/* Right-axis labels */}
      {font !== null && (
        <>
          <ProjLabel
            text={t1Label}
            price={t1SV}
            layoutDV={layoutDV}
            chartTop={chartTop}
            chartH={chartDrawH}
            chartAreaW={chartAreaW}
            color={LABEL_T_COLOR}
            font={font}
          />
          {t2Label !== '' && (
            <ProjLabel
              text={t2Label}
              price={t2SV}
              layoutDV={layoutDV}
              chartTop={chartTop}
              chartH={chartDrawH}
              chartAreaW={chartAreaW}
              color={LABEL_T_COLOR}
              font={font}
            />
          )}
          {t3Label !== '' && (
            <ProjLabel
              text={t3Label}
              price={t3SV}
              layoutDV={layoutDV}
              chartTop={chartTop}
              chartH={chartDrawH}
              chartAreaW={chartAreaW}
              color={LABEL_T_COLOR}
              font={font}
            />
          )}
          {invLabel !== '' && (
            <ProjLabel
              text={invLabel}
              price={invSV}
              layoutDV={layoutDV}
              chartTop={chartTop}
              chartH={chartDrawH}
              chartAreaW={chartAreaW}
              color={LABEL_INV_COLOR}
              font={font}
            />
          )}
        </>
      )}
    </Group>
  );
}
