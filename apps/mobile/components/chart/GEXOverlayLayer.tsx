/**
 * GEXOverlayLayer.tsx
 *
 * Renders three horizontal GEX levels inside the Skia Canvas:
 *
 *   Zero GEX  — amber dashed line  — the gamma flip level
 *   Call Wall — green dashed line  — strike with max positive GEX (resistance)
 *   Put Wall  — red dashed line    — strike with max negative GEX (support / acceleration)
 *
 * Each line is labeled on the right axis: "ZERO GEX  $581.00"
 *
 * Y positions recompute on the UI thread via useDerivedValue whenever the
 * price scale changes (pan / zoom), so labels stay pinned to the correct price.
 *
 * Lines outside the visible price range are omitted from the path (not drawn).
 */

import React, { useEffect } from 'react';
import {
  Path,
  Text,
  DashPathEffect,
  Group,
  Skia,
  type SkFont,
  type SkPath,
} from '@shopify/react-native-skia';
import {
  useSharedValue,
  useDerivedValue,
} from 'react-native-reanimated';
import type { SharedValue } from 'react-native-reanimated';
import type { GEXLevels } from '../../utils/gexCalculator';
import type { ChartLayoutParams } from './chartTypes';

// ── Colours ───────────────────────────────────────────────────────────────────

const ZERO_GEX_COLOR  = 'rgba(255,193,7,0.75)';   // amber
const CALL_WALL_COLOR = 'rgba(76,175,80,0.75)';    // green
const PUT_WALL_COLOR  = 'rgba(239,83,80,0.75)';    // red

const ZERO_GEX_LABEL  = 'rgba(255,193,7,0.95)';
const CALL_WALL_LABEL = 'rgba(76,175,80,0.95)';
const PUT_WALL_LABEL  = 'rgba(239,83,80,0.95)';

// ── Worklet helpers ───────────────────────────────────────────────────────────

function pToY(price: number, minP: number, maxP: number, top: number, h: number): number {
  'worklet';
  const range = maxP - minP;
  if (range < 1e-9) return top + h * 0.5;
  return top + ((maxP - price) / range) * h;
}

function buildSingleHLine(
  price:      number,
  layout:     ChartLayoutParams,
  chartTop:   number,
  chartH:     number,
  chartAreaW: number,
): SkPath {
  'worklet';
  const path = Skia.Path.Make();
  const { minP, maxP } = layout;
  if (price < minP || price > maxP) return path;   // outside visible range
  const y = pToY(price, minP, maxP, chartTop, chartH);
  path.moveTo(0, y);
  path.lineTo(chartAreaW, y);
  return path;
}

// ── Label Y (one per level, UI thread) ────────────────────────────────────────

function useLabelY(
  priceSV:  SharedValue<number>,
  layoutDV: SharedValue<ChartLayoutParams>,
  chartTop: number,
  chartH:   number,
): SharedValue<number> {
  return useDerivedValue((): number => {
    'worklet';
    const price = priceSV.value;
    const { minP, maxP } = layoutDV.value;
    if (price < minP || price > maxP) return -200;   // hidden
    return pToY(price, minP, maxP, chartTop, chartH) - 3;
  });
}

// ── Single GEX level (line + label) ──────────────────────────────────────────

interface GEXLevelProps {
  priceSV:    SharedValue<number>;
  lineColor:  string;
  labelColor: string;
  labelText:  string;         // e.g. "ZERO GEX  $581.00"
  layoutDV:   SharedValue<ChartLayoutParams>;
  chartTop:   number;
  chartH:     number;
  chartAreaW: number;
  font:       SkFont;
}

function GEXLevelLine({
  priceSV,
  lineColor,
  labelColor,
  labelText,
  layoutDV,
  chartTop,
  chartH,
  chartAreaW,
  font,
}: GEXLevelProps) {
  const linePath = useDerivedValue((): SkPath => {
    'worklet';
    return buildSingleHLine(
      priceSV.value,
      layoutDV.value,
      chartTop,
      chartH,
      chartAreaW,
    );
  });

  const labelY = useLabelY(priceSV, layoutDV, chartTop, chartH);

  return (
    <Group>
      <Path path={linePath} style="stroke" strokeWidth={1} color={lineColor}>
        <DashPathEffect intervals={[8, 5]} phase={0} />
      </Path>
      <Text
        x={chartAreaW + 2}
        y={labelY}
        text={labelText}
        font={font}
        color={labelColor}
      />
    </Group>
  );
}

// ── Public component ──────────────────────────────────────────────────────────

export interface GEXOverlayLayerProps {
  levels:     GEXLevels | null | undefined;
  layoutDV:   SharedValue<ChartLayoutParams>;
  chartTop:   number;
  chartDrawH: number;
  chartAreaW: number;
  font:       SkFont | null;
}

export function GEXOverlayLayer({
  levels,
  layoutDV,
  chartTop,
  chartDrawH,
  chartAreaW,
  font,
}: GEXOverlayLayerProps) {
  // SharedValues so the worklet can read prices on the UI thread
  const zeroGexSV  = useSharedValue(0);
  const callWallSV = useSharedValue(0);
  const putWallSV  = useSharedValue(0);

  useEffect(() => {
    if (!levels) return;
    zeroGexSV.value  = levels.zeroGex;
    callWallSV.value = levels.callWall;
    putWallSV.value  = levels.putWall;
  }, [levels, zeroGexSV, callWallSV, putWallSV]);

  if (!levels || !font) return null;

  const zeroLabel = `ZERO GEX  $${levels.zeroGex.toFixed(2)}`;
  const callLabel = `CALL WALL  $${levels.callWall.toFixed(2)}`;
  const putLabel  = `PUT WALL  $${levels.putWall.toFixed(2)}`;

  return (
    <Group>
      <GEXLevelLine
        priceSV={zeroGexSV}
        lineColor={ZERO_GEX_COLOR}
        labelColor={ZERO_GEX_LABEL}
        labelText={zeroLabel}
        layoutDV={layoutDV}
        chartTop={chartTop}
        chartH={chartDrawH}
        chartAreaW={chartAreaW}
        font={font}
      />
      <GEXLevelLine
        priceSV={callWallSV}
        lineColor={CALL_WALL_COLOR}
        labelColor={CALL_WALL_LABEL}
        labelText={callLabel}
        layoutDV={layoutDV}
        chartTop={chartTop}
        chartH={chartDrawH}
        chartAreaW={chartAreaW}
        font={font}
      />
      <GEXLevelLine
        priceSV={putWallSV}
        lineColor={PUT_WALL_COLOR}
        labelColor={PUT_WALL_LABEL}
        labelText={putLabel}
        layoutDV={layoutDV}
        chartTop={chartTop}
        chartH={chartDrawH}
        chartAreaW={chartAreaW}
        font={font}
      />
    </Group>
  );
}
