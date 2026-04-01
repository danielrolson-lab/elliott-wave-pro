/**
 * SupportResistanceLayer.tsx
 *
 * Draws key support and resistance zones derived from confirmed Elliott Wave
 * pivot prices on the Skia canvas.
 *
 *   Resistance zones  — blue  rgba(30,144,255,0.18)  with blue border
 *   Support zones     — purple rgba(139,0,139,0.18)   with purple border
 *
 * Zones are centered on prior pivot prices with a height equal to ±ZONE_HALF_PCT
 * of that price. Only zones within the current visible price range are drawn.
 * Labels are rendered on the right edge inside the clip rect.
 *
 * For bullish counts:
 *   - Prior wave highs (W1, W3, W5 endpoints) = resistance
 *   - Prior wave lows  (W2, W4 endpoints)     = support
 * For bearish counts the polarity is reversed.
 */

import React, { useMemo } from 'react';
import {
  Path,
  Text,
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

// ── Constants ─────────────────────────────────────────────────────────────────

const ZONE_HALF_PCT   = 0.003;  // ±0.3% of price = zone half-height

const RESIST_FILL     = 'rgba(30,144,255,0.18)';
const RESIST_BORDER   = 'rgba(30,144,255,0.70)';
const RESIST_LABEL    = 'rgba(30,144,255,0.90)';

const SUPPORT_FILL    = 'rgba(139,0,139,0.18)';
const SUPPORT_BORDER  = 'rgba(139,0,139,0.70)';
const SUPPORT_LABEL   = 'rgba(139,0,139,0.90)';

// ── Types ─────────────────────────────────────────────────────────────────────

interface SRData {
  resistance: number[];
  support:    number[];
}

const EMPTY_SR_DATA: SRData = { resistance: [], support: [] };

// ── Zone extraction from wave count ──────────────────────────────────────────

const IMPULSE_HIGHS  = ['1', '3', '5', 'B'];   // wave labels that end at highs (bullish)
const IMPULSE_LOWS   = ['2', '4', 'A', 'C'];   // wave labels that end at lows  (bullish)

function buildSRData(count: WaveCount | undefined): SRData {
  if (!count || !count.allWaves.length) return EMPTY_SR_DATA;

  const w1 = count.allWaves[0];
  if (!w1?.startPivot || !w1?.endPivot) return EMPTY_SR_DATA;
  const isBullish = w1.startPivot.price < w1.endPivot.price;

  const resistance: number[] = [];
  const support:    number[] = [];

  for (const wave of count.allWaves) {
    if (!wave.endPivot) continue;
    const price = wave.endPivot.price;
    const lbl   = wave.label as string;

    const isHigh = isBullish ? IMPULSE_HIGHS.includes(lbl) : IMPULSE_LOWS.includes(lbl);
    if (isHigh) {
      resistance.push(price);
    } else {
      support.push(price);
    }
  }

  // Deduplicate prices that are within 0.1% of each other
  function dedup(arr: number[]): number[] {
    const sorted = [...arr].sort((a, b) => a - b);
    const result: number[] = [];
    for (const p of sorted) {
      if (result.length === 0 || Math.abs(p - result[result.length - 1]) / p > 0.001) {
        result.push(p);
      }
    }
    return result;
  }

  return {
    resistance: dedup(resistance),
    support:    dedup(support),
  };
}

// ── Worklet helpers ───────────────────────────────────────────────────────────

function pToY(price: number, minP: number, maxP: number, top: number, h: number): number {
  'worklet';
  const range = maxP - minP;
  if (range < 1e-9) return top + h * 0.5;
  return top + ((maxP - price) / range) * h;
}

function buildZoneFillPath(
  prices:     number[],
  layout:     ChartLayoutParams,
  chartTop:   number,
  chartH:     number,
  chartAreaW: number,
): SkPath {
  'worklet';
  const path = Skia.Path.Make();
  const { minP, maxP } = layout;
  for (const price of prices) {
    const zoneH = price * ZONE_HALF_PCT;
    const top   = price + zoneH;
    const bot   = price - zoneH;
    if (top < minP || bot > maxP) continue;
    const y1 = pToY(top, minP, maxP, chartTop, chartH);
    const y2 = pToY(bot, minP, maxP, chartTop, chartH);
    path.addRect(Skia.XYWHRect(0, y1, chartAreaW, y2 - y1));
  }
  return path;
}

function buildZoneBorderPath(
  prices:     number[],
  layout:     ChartLayoutParams,
  chartTop:   number,
  chartH:     number,
  chartAreaW: number,
): SkPath {
  'worklet';
  const path = Skia.Path.Make();
  const { minP, maxP } = layout;
  for (const price of prices) {
    const zoneH = price * ZONE_HALF_PCT;
    const top   = price + zoneH;
    const bot   = price - zoneH;
    if (top < minP || bot > maxP) continue;
    const y1 = pToY(top, minP, maxP, chartTop, chartH);
    const y2 = pToY(bot, minP, maxP, chartTop, chartH);
    // Top border
    path.moveTo(0, y1);
    path.lineTo(chartAreaW, y1);
    // Bottom border
    path.moveTo(0, y2);
    path.lineTo(chartAreaW, y2);
  }
  return path;
}

// ── Label sub-component ───────────────────────────────────────────────────────

interface SRLabelProps {
  price:      number;
  label:      string;
  color:      string;
  layoutDV:   SharedValue<ChartLayoutParams>;
  chartTop:   number;
  chartH:     number;
  chartAreaW: number;
  font:       SkFont;
}

function SRLabel({ price, label, color, layoutDV, chartTop, chartH, chartAreaW, font }: SRLabelProps) {
  const y = useDerivedValue((): number => {
    'worklet';
    const { minP, maxP } = layoutDV.value;
    const yPos = pToY(price, minP, maxP, chartTop, chartH);
    return yPos < chartTop || yPos > chartTop + chartH ? -200 : yPos - 2;
  });
  return (
    <Text
      x={chartAreaW - 48}
      y={y}
      text={label}
      font={font}
      color={color}
    />
  );
}

// ── Public component ──────────────────────────────────────────────────────────

export interface SupportResistanceLayerProps {
  waveCounts:  readonly WaveCount[];
  layoutDV:    SharedValue<ChartLayoutParams>;
  chartTop:    number;
  chartDrawH:  number;
  chartAreaW:  number;
  font:        SkFont | null;
}

export function SupportResistanceLayer({
  waveCounts,
  layoutDV,
  chartTop,
  chartDrawH,
  chartAreaW,
  font,
}: SupportResistanceLayerProps) {
  const primaryCount = waveCounts[0];

  const srData = useMemo(() => buildSRData(primaryCount), [primaryCount]);

  const resistSV  = useSharedValue<number[]>([]);
  const supportSV = useSharedValue<number[]>([]);

  useEffect(() => {
    resistSV.value  = srData.resistance;
    supportSV.value = srData.support;
  }, [srData, resistSV, supportSV]);

  // Fill paths
  const resistFillPath = useDerivedValue((): SkPath => {
    'worklet';
    return buildZoneFillPath(resistSV.value, layoutDV.value, chartTop, chartDrawH, chartAreaW);
  });
  const supportFillPath = useDerivedValue((): SkPath => {
    'worklet';
    return buildZoneFillPath(supportSV.value, layoutDV.value, chartTop, chartDrawH, chartAreaW);
  });

  // Border paths
  const resistBorderPath = useDerivedValue((): SkPath => {
    'worklet';
    return buildZoneBorderPath(resistSV.value, layoutDV.value, chartTop, chartDrawH, chartAreaW);
  });
  const supportBorderPath = useDerivedValue((): SkPath => {
    'worklet';
    return buildZoneBorderPath(supportSV.value, layoutDV.value, chartTop, chartDrawH, chartAreaW);
  });

  if (srData.resistance.length === 0 && srData.support.length === 0) return null;

  return (
    <Group>
      {/* Support zone fills + borders */}
      <Path path={supportFillPath}   color={SUPPORT_FILL}   style="fill" />
      <Path path={supportBorderPath} color={SUPPORT_BORDER} style="stroke" strokeWidth={0.5} />

      {/* Resistance zone fills + borders */}
      <Path path={resistFillPath}   color={RESIST_FILL}   style="fill" />
      <Path path={resistBorderPath} color={RESIST_BORDER} style="stroke" strokeWidth={0.5} />

      {/* Labels on right edge */}
      {font !== null && (
        <>
          {srData.resistance.map((price, i) => (
            <SRLabel
              key={`r-${i}`}
              price={price}
              label={`R $${price.toFixed(2)}`}
              color={RESIST_LABEL}
              layoutDV={layoutDV}
              chartTop={chartTop}
              chartH={chartDrawH}
              chartAreaW={chartAreaW}
              font={font}
            />
          ))}
          {srData.support.map((price, i) => (
            <SRLabel
              key={`s-${i}`}
              price={price}
              label={`S $${price.toFixed(2)}`}
              color={SUPPORT_LABEL}
              layoutDV={layoutDV}
              chartTop={chartTop}
              chartH={chartDrawH}
              chartAreaW={chartAreaW}
              font={font}
            />
          ))}
        </>
      )}
    </Group>
  );
}
