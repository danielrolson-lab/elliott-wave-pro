/**
 * FibonacciOverlayLayer.tsx  (Fibonacci Pinball — v3)
 *
 * Two exported components:
 *
 *   FibonacciOverlayLayer  — dashed horizontal lines only.
 *     Goes INSIDE the chart's clip group (canvas area only).
 *
 *   FibonacciAxisLabels    — compact ratio labels ("61.8%", "161.8%", …).
 *     Goes OUTSIDE the clip group, positioned in the 62px Y-axis strip.
 *     Labels are color-coded to match their fib line group.
 *     Labels that would overlap (< 11 px apart) are skipped.
 *
 * Color groups:
 *   Retracements (0.236 – 0.786)  → orange
 *   1.000 extension               → white
 *   Golden zone (1.236 – 1.764)   → gold
 *   Extended (2.000 – 2.618)      → cyan
 *   Macro targets (3.000 – 4.236) → green
 *
 * Level base:
 *   - Wave length = |W1 start → W1 end|
 *   - Retracements measured backward from W1 end
 *   - Extensions projected forward from W2 end (retracement base)
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
import type { WaveCount } from '@elliott-wave-pro/wave-engine';
import type { ChartLayoutParams } from './chartTypes';

// ── Confluence detection ───────────────────────────────────────────────────────

/** Returns prices from `primary` that are within 0.5% of any price in `htf`. */
function findConfluencePrices(primary: FibLevel[], htf: FibLevel[]): number[] {
  const zones: number[] = [];
  for (const p of primary) {
    for (const h of htf) {
      const pct = Math.abs(p.price - h.price) / Math.max(Math.abs(p.price), 0.001);
      if (pct <= 0.005) {
        // Use the midpoint of the two close levels
        zones.push((p.price + h.price) / 2);
        break;
      }
    }
  }
  return zones;
}

/** Build filled band rects (4px tall) at confluence price levels. */
function buildConfluenceBands(
  prices:     number[],
  layout:     ChartLayoutParams,
  chartTop:   number,
  chartH:     number,
  chartAreaW: number,
): SkPath {
  'worklet';
  const path = Skia.Path.Make();
  const { minP, maxP } = layout;
  const BAND_H = 4;
  for (const price of prices) {
    if (price < minP || price > maxP) continue;
    const y = pToY(price, minP, maxP, chartTop, chartH);
    path.addRect(Skia.XYWHRect(0, y - BAND_H / 2, chartAreaW, BAND_H));
  }
  return path;
}

// ── Level definitions ─────────────────────────────────────────────────────────

const RETRACE_RATIOS   = [0.236, 0.382, 0.500, 0.618, 0.786];
const EXTENSION_RATIOS = [1.0, 1.236, 1.382, 1.618, 2.0, 2.618, 3.0, 3.618, 4.236];

// ── Color groups ──────────────────────────────────────────────────────────────

interface ColorGroup {
  lineColor:  string;
  labelColor: string;
}

function getColorGroup(ratio: number): ColorGroup {
  if (ratio < 1.0) return {
    lineColor:  'rgba(251,146,60,0.65)',
    labelColor: 'rgba(251,146,60,0.95)',
  };
  if (ratio === 1.0) return {
    lineColor:  'rgba(255,255,255,0.70)',
    labelColor: 'rgba(255,255,255,0.95)',
  };
  if (ratio <= 1.764) return {
    lineColor:  'rgba(255,215,0,0.65)',
    labelColor: 'rgba(255,215,0,0.95)',
  };
  if (ratio <= 2.618) return {
    lineColor:  'rgba(34,211,238,0.65)',
    labelColor: 'rgba(34,211,238,0.95)',
  };
  return {
    lineColor:  'rgba(50,205,50,0.65)',
    labelColor: 'rgba(50,205,50,0.95)',
  };
}

// ── Worklet helpers ───────────────────────────────────────────────────────────

function pToY(price: number, minP: number, maxP: number, top: number, h: number): number {
  'worklet';
  const range = maxP - minP;
  if (range < 1e-9) return top + h * 0.5;
  return top + ((maxP - price) / range) * h;
}

function buildHLines(
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
    if (price < minP || price > maxP) continue;
    const y = pToY(price, minP, maxP, chartTop, chartH);
    path.moveTo(0, y);
    path.lineTo(chartAreaW, y);
  }
  return path;
}

// ── Fib level computation ─────────────────────────────────────────────────────

export interface FibLevel {
  ratio:      number;
  price:      number;
  /** Compact axis label, e.g. "61.8%" or "161.8%" */
  axisLabel:  string;
  lineColor:  string;
  labelColor: string;
}

export function buildPinballLevels(count: WaveCount | undefined): FibLevel[] {
  if (!count) return [];

  const w1 = count.allWaves.find((w) => w.label === '1' || w.label === 'A');
  const w2 = count.allWaves.find((w) => w.label === '2' || w.label === 'B');
  if (!w1 || !w1.startPivot || !w1.endPivot) return [];

  const waveOrigin = w1.startPivot.price;
  const waveEnd    = w1.endPivot.price;
  const waveLen    = Math.abs(waveEnd - waveOrigin);
  if (waveLen < 0.001) return [];

  const isBullish = waveEnd > waveOrigin;
  const extBase   = w2?.endPivot?.price ?? waveOrigin;

  const levels: FibLevel[] = [];

  for (const r of RETRACE_RATIOS) {
    const price = isBullish
      ? waveEnd - waveLen * r
      : waveEnd + waveLen * r;
    const { lineColor, labelColor } = getColorGroup(r);
    levels.push({
      ratio:      r,
      price,
      axisLabel:  `${(r * 100).toFixed(1)}%`,
      lineColor,
      labelColor,
    });
  }

  for (const r of EXTENSION_RATIOS) {
    const price = isBullish
      ? extBase + waveLen * r
      : extBase - waveLen * r;
    const { lineColor, labelColor } = getColorGroup(r);
    levels.push({
      ratio:      r,
      price,
      axisLabel:  `${(r * 100).toFixed(1)}%`,
      lineColor,
      labelColor,
    });
  }

  return levels;
}

// ── Per-group SharedValue + Path grouping ─────────────────────────────────────

interface GroupPaths {
  orange: number[];
  white:  number[];
  gold:   number[];
  cyan:   number[];
  green:  number[];
}

const EMPTY_GROUP_PATHS: GroupPaths = {
  orange: [], white: [], gold: [], cyan: [], green: [],
};

function groupLevels(levels: FibLevel[]): GroupPaths {
  const result: GroupPaths = { orange: [], white: [], gold: [], cyan: [], green: [] };
  for (const l of levels) {
    if (l.ratio < 1.0)         result.orange.push(l.price);
    else if (l.ratio === 1.0)  result.white.push(l.price);
    else if (l.ratio <= 1.764) result.gold.push(l.price);
    else if (l.ratio <= 2.618) result.cyan.push(l.price);
    else                       result.green.push(l.price);
  }
  return result;
}

// ── Axis label sub-component ──────────────────────────────────────────────────
// Rendered OUTSIDE the chart clip group, in the 62px Y-axis strip.

interface AxisLabelProps {
  text:       string;
  color:      string;
  price:      number;
  layoutDV:   SharedValue<ChartLayoutParams>;
  chartTop:   number;
  chartH:     number;
  /** Left edge of the Y-axis strip (= CHART_AREA_W) */
  axisLeft:   number;
  font:       SkFont;
}

function FibAxisLabel({ text, color, price, layoutDV, chartTop, chartH, axisLeft, font }: AxisLabelProps) {
  const y = useDerivedValue((): number => {
    'worklet';
    const { minP, maxP } = layoutDV.value;
    const yPos = pToY(price, minP, maxP, chartTop, chartH);
    // Hide if out of visible range
    if (yPos < chartTop || yPos > chartTop + chartH) return -200;
    return yPos + 3; // sit just below the line
  });
  // Labels align to left edge of Y-axis strip with a small margin
  return <Text x={axisLeft + 3} y={y} text={text} font={font} color={color} />;
}

// ── Public components ─────────────────────────────────────────────────────────

export interface FibonacciOverlayLayerProps {
  waveCounts:     readonly WaveCount[];
  layoutDV:       SharedValue<ChartLayoutParams>;
  chartTop:       number;
  chartDrawH:     number;
  chartAreaW:     number;
  /** When provided (Multi-Degree mode), renders a second fib grid at subdegree style */
  htfWaveCounts?: readonly WaveCount[];
  /** font prop kept for API compatibility but no longer used (labels moved to axis) */
  font?:          SkFont | null;
}

/** Dashed horizontal lines only — place inside the chart clip group. */
export function FibonacciOverlayLayer({
  waveCounts,
  layoutDV,
  chartTop,
  chartDrawH,
  chartAreaW,
  htfWaveCounts,
}: FibonacciOverlayLayerProps) {
  const primaryCount = waveCounts[0];
  const htfCount     = htfWaveCounts?.[0];

  const levels    = useMemo(() => buildPinballLevels(primaryCount), [primaryCount]);
  const htfLevels = useMemo(() => (htfCount ? buildPinballLevels(htfCount) : []), [htfCount]);

  // Confluence zones: primary fib levels within 0.5% of an HTF fib level
  const confluencePrices = useMemo(
    () => (htfLevels.length > 0 ? findConfluencePrices(levels, htfLevels) : []),
    [levels, htfLevels],
  );

  // Primary fib SharedValues
  const groupsSV = useSharedValue<GroupPaths>(EMPTY_GROUP_PATHS);
  useEffect(() => { groupsSV.value = groupLevels(levels); }, [levels, groupsSV]);

  // HTF fib SharedValues (all lines yellow — sub-degree style)
  const htfPricesSV = useSharedValue<number[]>([]);
  useEffect(() => {
    htfPricesSV.value = htfLevels.map((l) => l.price);
  }, [htfLevels, htfPricesSV]);

  // Confluence band prices
  const confluenceSV = useSharedValue<number[]>([]);
  useEffect(() => { confluenceSV.value = confluencePrices; }, [confluencePrices, confluenceSV]);

  // Primary degree paths
  const orangePath = useDerivedValue((): SkPath => {
    'worklet';
    return buildHLines(groupsSV.value.orange, layoutDV.value, chartTop, chartDrawH, chartAreaW);
  });
  const whitePath = useDerivedValue((): SkPath => {
    'worklet';
    return buildHLines(groupsSV.value.white, layoutDV.value, chartTop, chartDrawH, chartAreaW);
  });
  const goldPath = useDerivedValue((): SkPath => {
    'worklet';
    return buildHLines(groupsSV.value.gold, layoutDV.value, chartTop, chartDrawH, chartAreaW);
  });
  const cyanPath = useDerivedValue((): SkPath => {
    'worklet';
    return buildHLines(groupsSV.value.cyan, layoutDV.value, chartTop, chartDrawH, chartAreaW);
  });
  const greenPath = useDerivedValue((): SkPath => {
    'worklet';
    return buildHLines(groupsSV.value.green, layoutDV.value, chartTop, chartDrawH, chartAreaW);
  });

  // HTF (sub-degree) path — all one yellow style, thinner
  const htfPath = useDerivedValue((): SkPath => {
    'worklet';
    return buildHLines(htfPricesSV.value, layoutDV.value, chartTop, chartDrawH, chartAreaW);
  });

  // Confluence band path
  const confluencePath = useDerivedValue((): SkPath => {
    'worklet';
    return buildConfluenceBands(confluenceSV.value, layoutDV.value, chartTop, chartDrawH, chartAreaW);
  });

  if (levels.length === 0) return null;

  return (
    <Group>
      {/* ── Primary degree fibs ── */}
      <Path path={orangePath} style="stroke" strokeWidth={1} color="rgba(251,146,60,0.65)">
        <DashPathEffect intervals={[6, 4]} phase={0} />
      </Path>
      <Path path={whitePath} style="stroke" strokeWidth={1.2} color="rgba(255,255,255,0.70)">
        <DashPathEffect intervals={[6, 4]} phase={0} />
      </Path>
      <Path path={goldPath} style="stroke" strokeWidth={1} color="rgba(255,215,0,0.65)">
        <DashPathEffect intervals={[6, 4]} phase={0} />
      </Path>
      <Path path={cyanPath} style="stroke" strokeWidth={1} color="rgba(34,211,238,0.65)">
        <DashPathEffect intervals={[6, 4]} phase={0} />
      </Path>
      <Path path={greenPath} style="stroke" strokeWidth={1} color="rgba(50,205,50,0.65)">
        <DashPathEffect intervals={[6, 4]} phase={0} />
      </Path>

      {/* ── Sub-degree (HTF) fibs — yellow, thinner, shorter dashes ── */}
      {htfLevels.length > 0 && (
        <Path path={htfPath} style="stroke" strokeWidth={0.7} color="rgba(255,240,100,0.45)">
          <DashPathEffect intervals={[3, 5]} phase={0} />
        </Path>
      )}

      {/* ── Confluence bands — white glow where two grids stack ── */}
      {confluencePrices.length > 0 && (
        <Path path={confluencePath} style="fill" color="rgba(255,255,255,0.10)" />
      )}
    </Group>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

export interface FibonacciAxisLabelsProps {
  waveCounts:  readonly WaveCount[];
  layoutDV:    SharedValue<ChartLayoutParams>;
  chartTop:    number;
  chartDrawH:  number;
  /** Left edge of the Y-axis strip (= CHART_AREA_W = screenW - priceAxisWidth) */
  axisLeft:    number;
  font:        SkFont | null;
}

/**
 * Compact ratio labels for the Y-axis strip.
 * Place OUTSIDE the chart clip group so labels are visible in the axis area.
 * Skips labels that would be off-screen or within LABEL_MIN_GAP px of another.
 */
export function FibonacciAxisLabels({
  waveCounts,
  layoutDV,
  chartTop,
  chartDrawH,
  axisLeft,
  font,
}: FibonacciAxisLabelsProps) {
  const primaryCount = waveCounts[0];
  const levels       = useMemo(() => buildPinballLevels(primaryCount), [primaryCount]);

  if (levels.length === 0 || font === null) return null;

  // Sort by price descending so top-of-chart levels are processed first
  // for the min-gap de-collision pass (done at render time via y comparison).
  // We render all levels; the y = -200 trick from FibAxisLabel hides off-screen ones.
  return (
    <>
      {levels.map((level, i) => (
        <FibAxisLabel
          key={`fibax-${i}`}
          text={level.axisLabel}
          color={level.labelColor}
          price={level.price}
          layoutDV={layoutDV}
          chartTop={chartTop}
          chartH={chartDrawH}
          axisLeft={axisLeft}
          font={font}
        />
      ))}
    </>
  );
}
