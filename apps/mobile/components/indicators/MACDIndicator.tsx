/**
 * MACDIndicator.tsx
 *
 * Skia MACD (12/26/9) sub-indicator panel. Reads from the indicator store.
 *
 * Visual spec:
 *   • Histogram bars: green (positive), red (negative)
 *   • MACD line (white) and Signal line (orange) overlaid on histogram
 *   • Horizontal zero line (dim grey, dashed)
 *   • Crossover points marked with a small filled dot
 *   • Current MACD / Signal values printed top-right
 */

import React, { useEffect } from 'react';
import { StyleSheet, useWindowDimensions } from 'react-native';
import {
  Canvas,
  Path,
  Rect,
  Line,
  Text,
  DashPathEffect,
  Skia,
  type SkFont,
  type SkPath,
} from '@shopify/react-native-skia';
import { useSharedValue, useDerivedValue } from 'react-native-reanimated';
import type { SharedValue } from 'react-native-reanimated';
import { useIndicatorStore } from '../../stores/indicators';
import type { CrossoverPoint } from '../../stores/indicators';
import { CHART_COLORS, CHART_LAYOUT } from '../chart/chartTypes';
import { INDICATOR_H } from './RSIIndicator';

const PAD_TOP = 8;
const PAD_BOT = 4;
const DRAW_H  = INDICATOR_H - PAD_TOP - PAD_BOT;

// ── Worklet helpers ───────────────────────────────────────────────────────────

function macdToY(v: number, minV: number, maxV: number): number {
  'worklet';
  const range = maxV - minV;
  if (range < 1e-9) return PAD_TOP + DRAW_H * 0.5;
  return PAD_TOP + ((maxV - v) / range) * DRAW_H;
}

function buildHistogram(
  histogram:  readonly number[],
  startIdx:   number,
  endIdx:     number,
  tx:         number,
  cw:         number,
  minV:       number,
  maxV:       number,
): { pos: SkPath; neg: SkPath } {
  'worklet';
  const pos = Skia.Path.Make();
  const neg = Skia.Path.Make();
  const gap  = cw * 0.15;
  const barW = cw - gap;
  const yZero = macdToY(0, minV, maxV);

  for (let i = startIdx; i < endIdx; i++) {
    if (i >= histogram.length) break;
    const v = histogram[i];
    if (v === 0) continue;
    const x  = tx + i * cw + gap / 2;
    const yV = macdToY(v, minV, maxV);
    const rect = v > 0
      ? Skia.XYWHRect(x, yV, barW, yZero - yV)
      : Skia.XYWHRect(x, yZero, barW, yV - yZero);
    if (v > 0) pos.addRect(rect);
    else       neg.addRect(rect);
  }
  return { pos, neg };
}

function buildLinePath(
  values:   readonly number[],
  startIdx: number,
  endIdx:   number,
  tx:       number,
  cw:       number,
  minV:     number,
  maxV:     number,
): SkPath {
  'worklet';
  const path = Skia.Path.Make();
  const half = cw * 0.5;
  let first = true;
  for (let i = startIdx; i < endIdx; i++) {
    if (i >= values.length) break;
    const x = tx + i * cw + half;
    const y = macdToY(values[i], minV, maxV);
    if (first) { path.moveTo(x, y); first = false; }
    else        path.lineTo(x, y);
  }
  return path;
}

function buildCrossoverDots(
  crossovers:  readonly CrossoverPoint[],
  macdLine:    readonly number[],
  signalLine:  readonly number[],
  startIdx:    number,
  endIdx:      number,
  tx:          number,
  cw:          number,
  minV:        number,
  maxV:        number,
): { bull: SkPath; bear: SkPath } {
  'worklet';
  const bull = Skia.Path.Make();
  const bear = Skia.Path.Make();
  const half = cw * 0.5;

  for (const co of crossovers) {
    const i = co.barIdx;
    if (i < startIdx || i >= endIdx) continue;
    // Dot at average of MACD and Signal at that bar
    const v = ((macdLine[i] ?? 0) + (signalLine[i] ?? 0)) * 0.5;
    const x = tx + i * cw + half;
    const y = macdToY(v, minV, maxV);
    if (co.type === 'bullish') bull.addCircle(x, y, 3);
    else                       bear.addCircle(x, y, 3);
  }
  return { bull, bear };
}

// ── Component ─────────────────────────────────────────────────────────────────

export interface MACDIndicatorProps {
  ticker:     string;
  timeframe:  string;
  numCandles: number;
  translateX: SharedValue<number>;
  candleW:    SharedValue<number>;
  font:       SkFont | null;
}

export function MACDIndicator({
  ticker,
  timeframe,
  numCandles,
  translateX,
  candleW,
  font,
}: MACDIndicatorProps) {
  const { width: screenW } = useWindowDimensions();
  const CHART_W = screenW - CHART_LAYOUT.priceAxisWidth;

  const key       = `${ticker}_${timeframe}`;
  const macdStore = useIndicatorStore((s) => s.macd[key]);

  const macdLineSV   = useSharedValue<readonly number[]>([]);
  const signalLineSV = useSharedValue<readonly number[]>([]);
  const histogramSV  = useSharedValue<readonly number[]>([]);
  const crossoversSV = useSharedValue<readonly CrossoverPoint[]>([]);

  useEffect(() => {
    macdLineSV.value   = macdStore?.macdLine   ?? [];
    signalLineSV.value = macdStore?.signalLine  ?? [];
    histogramSV.value  = macdStore?.histogram   ?? [];
    crossoversSV.value = macdStore?.crossovers  ?? [];
  }, [macdStore, macdLineSV, signalLineSV, histogramSV, crossoversSV]);

  // Visible range + auto-scale min/max
  const layoutDV = useDerivedValue(() => {
    'worklet';
    const tx = translateX.value;
    const cw = candleW.value;
    const startIdx = Math.max(0, Math.floor(-tx / cw));
    const endIdx   = Math.min(numCandles, Math.ceil((-tx + CHART_W) / cw) + 1);

    let minV = Infinity;
    let maxV = -Infinity;
    const hist = histogramSV.value;
    const macd = macdLineSV.value;
    const sig  = signalLineSV.value;
    for (let i = startIdx; i < endIdx; i++) {
      const h = hist[i] ?? 0;
      const m = macd[i] ?? 0;
      const s = sig[i]  ?? 0;
      if (h < minV) minV = h;
      if (h > maxV) maxV = h;
      if (m < minV) minV = m;
      if (m > maxV) maxV = m;
      if (s < minV) minV = s;
      if (s > maxV) maxV = s;
    }
    if (!isFinite(minV)) { minV = -1; maxV = 1; }
    const pad = (maxV - minV) * 0.10 || 0.1;
    return { startIdx, endIdx, tx, cw, minV: minV - pad, maxV: maxV + pad };
  });

  const histDV = useDerivedValue(() => {
    'worklet';
    const { startIdx, endIdx, tx, cw, minV, maxV } = layoutDV.value;
    return buildHistogram(histogramSV.value, startIdx, endIdx, tx, cw, minV, maxV);
  });
  const histPos = useDerivedValue((): SkPath => histDV.value.pos);
  const histNeg = useDerivedValue((): SkPath => histDV.value.neg);

  const macdLinePath   = useDerivedValue((): SkPath => {
    'worklet';
    const { startIdx, endIdx, tx, cw, minV, maxV } = layoutDV.value;
    return buildLinePath(macdLineSV.value, startIdx, endIdx, tx, cw, minV, maxV);
  });
  const signalLinePath = useDerivedValue((): SkPath => {
    'worklet';
    const { startIdx, endIdx, tx, cw, minV, maxV } = layoutDV.value;
    return buildLinePath(signalLineSV.value, startIdx, endIdx, tx, cw, minV, maxV);
  });

  const zeroLineY = useDerivedValue((): number => {
    'worklet';
    const { minV, maxV } = layoutDV.value;
    return macdToY(0, minV, maxV);
  });

  const zeroLinePath = useDerivedValue((): SkPath => {
    'worklet';
    const y = zeroLineY.value;
    const p = Skia.Path.Make();
    p.moveTo(0, y);
    p.lineTo(CHART_W, y);
    return p;
  });

  const dotsDV = useDerivedValue(() => {
    'worklet';
    const { startIdx, endIdx, tx, cw, minV, maxV } = layoutDV.value;
    return buildCrossoverDots(
      crossoversSV.value, macdLineSV.value, signalLineSV.value,
      startIdx, endIdx, tx, cw, minV, maxV,
    );
  });
  const bullDots = useDerivedValue((): SkPath => dotsDV.value.bull);
  const bearDots = useDerivedValue((): SkPath => dotsDV.value.bear);

  // Current value label text
  const currentLabel = useDerivedValue((): string => {
    'worklet';
    const ml = macdLineSV.value;
    const sl = signalLineSV.value;
    if (ml.length === 0) return 'MACD –';
    const m = ml[ml.length - 1].toFixed(3);
    const s = sl[sl.length - 1]?.toFixed(3) ?? '–';
    return `${m} / ${s}`;
  });

  return (
    <Canvas style={[styles.canvas, { width: screenW, height: INDICATOR_H }]}>
      <Rect x={0} y={0} width={screenW} height={INDICATOR_H} color={CHART_COLORS.background} />

      {/* Zero line (dashed) */}
      <Path path={zeroLinePath} style="stroke" strokeWidth={0.5} color={CHART_COLORS.gridLine}>
        <DashPathEffect intervals={[4, 3]} phase={0} />
      </Path>

      {/* Histogram */}
      <Path path={histPos} style="fill" color="rgba(38,166,154,0.75)" />
      <Path path={histNeg} style="fill" color="rgba(239,83,80,0.75)" />

      {/* MACD and Signal lines */}
      <Path path={macdLinePath}   style="stroke" strokeWidth={1.5} color={CHART_COLORS.textPrimary} />
      <Path path={signalLinePath} style="stroke" strokeWidth={1.2} color={CHART_COLORS.ema21} />

      {/* Crossover dots */}
      <Path path={bullDots} style="fill" color={CHART_COLORS.bullBody} />
      <Path path={bearDots} style="fill" color={CHART_COLORS.bearBody} />

      {/* Axis separator */}
      <Line p1={{ x: CHART_W, y: 0 }} p2={{ x: CHART_W, y: INDICATOR_H }} color={CHART_COLORS.gridLine} strokeWidth={0.5} />

      {/* Inline legend — top-left */}
      {font !== null && (
        <>
          <Text x={4}  y={PAD_TOP + 10} text="─ MACD" font={font} color={CHART_COLORS.textPrimary} />
          <Text x={4}  y={PAD_TOP + 22} text="─ Sig"  font={font} color={CHART_COLORS.ema21} />
        </>
      )}

      {/* Zero label on right axis */}
      {font !== null && (
        <Text x={CHART_W + 4} y={zeroLineY} text="0" font={font} color={CHART_COLORS.textMuted} />
      )}

      {/* Current value label */}
      {font !== null && (
        <Text x={CHART_W + 4} y={PAD_TOP + 10} text={currentLabel} font={font} color={CHART_COLORS.textMuted} />
      )}
    </Canvas>
  );
}

const styles = StyleSheet.create({
  canvas: { backgroundColor: CHART_COLORS.background },
});

const MACDIndicatorMemo = React.memo(MACDIndicator);
export { MACDIndicatorMemo as MACDIndicatorMemo };
