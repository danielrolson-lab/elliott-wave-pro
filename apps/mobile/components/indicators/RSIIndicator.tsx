/**
 * RSIIndicator.tsx
 *
 * Skia RSI-14 sub-indicator panel. Reads pre-computed values from the
 * Zustand indicator store — no math inside the component.
 *
 * Visual spec:
 *   • Line chart of RSI values
 *   • Shaded overbought zone (RSI > 70) in dim red
 *   • Shaded oversold zone  (RSI < 30) in dim green
 *   • RSI line: red above 70, green below 30, white in the 30–70 band
 *   • Horizontal reference lines at 70 and 30
 *   • Divergence labels: "▼DIV" (bearish) or "▲DIV" (bullish) at detection bar
 *   • Current RSI value printed top-right
 */

import React, { useEffect } from 'react';
import { StyleSheet, useWindowDimensions } from 'react-native';
import {
  Canvas,
  Path,
  Rect,
  Line,
  Text,
  Skia,
  type SkFont,
  type SkPath,
} from '@shopify/react-native-skia';
import { useSharedValue, useDerivedValue } from 'react-native-reanimated';
import type { SharedValue } from 'react-native-reanimated';
import { useIndicatorStore } from '../../stores/indicators';
import { CHART_COLORS, CHART_LAYOUT } from '../chart/chartTypes';

// ── Layout constants ──────────────────────────────────────────────────────────

export const INDICATOR_H  = 120;
const PAD_TOP  = 8;
const PAD_BOT  = 4;
const DRAW_H   = INDICATOR_H - PAD_TOP - PAD_BOT;

// ── Worklet path builders ─────────────────────────────────────────────────────

function buildRSIPaths(
  values: readonly number[],
  startIdx: number,
  endIdx:   number,
  tx:       number,
  cw:       number,
): { red: SkPath; green: SkPath; white: SkPath } {
  'worklet';
  const red   = Skia.Path.Make();
  const green = Skia.Path.Make();
  const white = Skia.Path.Make();
  const half  = cw * 0.5;

  let prevX = 0;
  let prevV = 50;

  for (let i = startIdx; i < endIdx; i++) {
    if (i >= values.length) break;
    const v = values[i];
    const x = tx + i * cw + half;
    const y = PAD_TOP + (100 - Math.max(0, Math.min(100, v))) * DRAW_H / 100;

    const curPath  = v > 70 ? red : v < 30 ? green : white;

    if (i === startIdx) {
      curPath.moveTo(x, y);
    } else {
      const prevPath = prevV > 70 ? red : prevV < 30 ? green : white;
      if (curPath === prevPath) {
        curPath.lineTo(x, y);
      } else {
        // Interpolate the threshold-crossing point
        const threshold = (v > 70 || prevV > 70) ? 70 : 30;
        const t         = Math.abs(threshold - prevV) / (Math.abs(v - prevV) || 1);
        const cx        = prevX + t * (x - prevX);
        const cy        = PAD_TOP + (100 - threshold) * DRAW_H / 100;
        prevPath.lineTo(cx, cy);
        curPath.moveTo(cx, cy);
        curPath.lineTo(x, y);
      }
    }
    prevX = x;
    prevV = v;
  }
  return { red, green, white };
}

function buildDivergenceDots(
  divergences: ReadonlyArray<{ barIdx: number; type: 'bearish' | 'bullish' }>,
  values:      readonly number[],
  startIdx:    number,
  endIdx:      number,
  tx:          number,
  cw:          number,
): { bear: SkPath; bull: SkPath } {
  'worklet';
  const bear = Skia.Path.Make();
  const bull = Skia.Path.Make();
  const half = cw * 0.5;

  for (const div of divergences) {
    const i = div.barIdx;
    if (i < startIdx || i >= endIdx || i >= values.length) continue;
    const x = tx + i * cw + half;
    const y = PAD_TOP + (100 - values[i]) * DRAW_H / 100;
    if (div.type === 'bearish') {
      bear.addCircle(x, y - 8, 3);
    } else {
      bull.addCircle(x, y + 8, 3);
    }
  }
  return { bear, bull };
}

// ── Component ─────────────────────────────────────────────────────────────────

export interface RSIIndicatorProps {
  ticker:     string;
  timeframe:  string;
  numCandles: number;  // total candle count — needed for visible range calc
  translateX: SharedValue<number>;
  candleW:    SharedValue<number>;
  font:       SkFont | null;
}

export function RSIIndicator({
  ticker,
  timeframe,
  numCandles,
  translateX,
  candleW,
  font,
}: RSIIndicatorProps) {
  const { width: screenW } = useWindowDimensions();
  const CHART_W = screenW - CHART_LAYOUT.priceAxisWidth;

  const key      = `${ticker}_${timeframe}`;
  const rsiStore = useIndicatorStore((s) => s.rsi[key]);

  // Sync to SharedValues for worklet access
  const rsiSV  = useSharedValue<readonly number[]>([]);
  const divsSV = useSharedValue<ReadonlyArray<{ barIdx: number; type: 'bearish' | 'bullish' }>>([]);

  useEffect(() => {
    rsiSV.value  = rsiStore?.values      ?? [];
    divsSV.value = rsiStore?.divergences ?? [];
  }, [rsiStore, rsiSV, divsSV]);

  // Static zone y positions (RSI scale is always 0–100)
  const Y70 = PAD_TOP + 0.30 * DRAW_H;
  const Y30 = PAD_TOP + 0.70 * DRAW_H;

  // Visible range (same formula as CandlestickChart)
  const visibleDV = useDerivedValue(() => {
    'worklet';
    const tx = translateX.value;
    const cw = candleW.value;
    const startIdx = Math.max(0, Math.floor(-tx / cw));
    const endIdx   = Math.min(numCandles, Math.ceil((-tx + CHART_W) / cw) + 1);
    return { startIdx, endIdx, tx, cw };
  });

  // RSI line paths
  const rsiPathsDV = useDerivedValue(() => {
    'worklet';
    const { startIdx, endIdx, tx, cw } = visibleDV.value;
    return buildRSIPaths(rsiSV.value, startIdx, endIdx, tx, cw);
  });
  const rsiRed   = useDerivedValue((): SkPath => rsiPathsDV.value.red);
  const rsiGreen = useDerivedValue((): SkPath => rsiPathsDV.value.green);
  const rsiWhite = useDerivedValue((): SkPath => rsiPathsDV.value.white);

  // Divergence dots
  const divDotsDV = useDerivedValue(() => {
    'worklet';
    const { startIdx, endIdx, tx, cw } = visibleDV.value;
    return buildDivergenceDots(divsSV.value, rsiSV.value, startIdx, endIdx, tx, cw);
  });
  const divBear = useDerivedValue((): SkPath => divDotsDV.value.bear);
  const divBull = useDerivedValue((): SkPath => divDotsDV.value.bull);

  // Current RSI text
  const currentRSI = useDerivedValue((): string => {
    'worklet';
    const vals = rsiSV.value;
    if (vals.length === 0) return 'RSI –';
    return `RSI ${vals[vals.length - 1].toFixed(1)}`;
  });

  return (
    <Canvas style={[styles.canvas, { width: screenW, height: INDICATOR_H }]}>
      {/* Background */}
      <Rect x={0} y={0} width={screenW} height={INDICATOR_H} color={CHART_COLORS.background} />

      {/* Overbought shaded zone (above 70) */}
      <Rect x={0} y={PAD_TOP} width={CHART_W} height={Y70 - PAD_TOP} color="rgba(239,83,80,0.10)" />

      {/* Oversold shaded zone (below 30) */}
      <Rect x={0} y={Y30} width={CHART_W} height={PAD_TOP + DRAW_H - Y30} color="rgba(38,166,154,0.10)" />

      {/* Zone reference lines */}
      <Line p1={{ x: 0, y: Y70 }} p2={{ x: CHART_W, y: Y70 }} color="rgba(239,83,80,0.45)" strokeWidth={0.5} />
      <Line p1={{ x: 0, y: Y30 }} p2={{ x: CHART_W, y: Y30 }} color="rgba(38,166,154,0.45)" strokeWidth={0.5} />

      {/* Price axis separator */}
      <Line p1={{ x: CHART_W, y: 0 }} p2={{ x: CHART_W, y: INDICATOR_H }} color={CHART_COLORS.gridLine} strokeWidth={0.5} />

      {/* RSI line — color-segmented */}
      <Path path={rsiWhite} style="stroke" strokeWidth={1.5} color={CHART_COLORS.textPrimary} />
      <Path path={rsiRed}   style="stroke" strokeWidth={1.5} color={CHART_COLORS.bearBody} />
      <Path path={rsiGreen} style="stroke" strokeWidth={1.5} color={CHART_COLORS.bullBody} />

      {/* Divergence markers */}
      <Path path={divBear} style="fill" color={CHART_COLORS.bearBody} />
      <Path path={divBull} style="fill" color={CHART_COLORS.bullBody} />

      {/* Current value label */}
      {font !== null && (
        <Text x={CHART_W + 4} y={PAD_TOP + 10} text={currentRSI} font={font} color={CHART_COLORS.textMuted} />
      )}

      {/* Zone labels */}
      {font !== null && (
        <>
          <Text x={CHART_W + 4} y={Y70 + 4} text="70" font={font} color="rgba(239,83,80,0.7)" />
          <Text x={CHART_W + 4} y={Y30 + 4} text="30" font={font} color="rgba(38,166,154,0.7)" />
        </>
      )}
    </Canvas>
  );
}

const styles = StyleSheet.create({
  canvas: { backgroundColor: CHART_COLORS.background },
});

// Memoized export — prevents re-renders when parent re-renders without prop changes
const RSIIndicatorMemo = React.memo(RSIIndicator);
export { RSIIndicatorMemo as RSIIndicatorMemo };

// Performance: prevent re-render when props haven't changed
