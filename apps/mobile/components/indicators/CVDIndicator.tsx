/**
 * CVDIndicator.tsx
 *
 * Skia Cumulative Volume Delta sub-indicator panel.
 * Reads pre-computed CVD series from the indicator store.
 *
 * Visual spec:
 *   • CVD line: green when rising, red when falling
 *   • Zero reference line (dashed grey)
 *   • Bearish divergence dots: red filled circles above the bar
 *   • Bullish divergence dots: green filled circles below the bar
 *   • Current CVD value printed top-right (K-formatted if ≥ 1000)
 */

import React from 'react';
import { StyleSheet, useWindowDimensions } from 'react-native';
import { SkiaErrorBoundary } from '../common/SkiaErrorBoundary';
import {
  Canvas,
  Path,
  Circle,
  Line,
  Text,
  DashPathEffect,
  Skia,
  type SkFont,
  type SkPath,
} from '@shopify/react-native-skia';
import { useDerivedValue } from 'react-native-reanimated';
import type { SharedValue } from 'react-native-reanimated';
import { useIndicatorStore } from '../../stores/indicators';
import type { CVDDivergencePoint } from '../../stores/indicators';
import { CHART_COLORS, CHART_LAYOUT } from '../chart/chartTypes';
import { INDICATOR_H } from './RSIIndicator';

const PAD_TOP = 8;
const PAD_BOT = 4;
const DRAW_H  = INDICATOR_H - PAD_TOP - PAD_BOT;

// ── Worklet helpers ───────────────────────────────────────────────────────────

function cvdToY(v: number, minV: number, maxV: number): number {
  'worklet';
  const range = maxV - minV;
  if (range < 1e-9) return PAD_TOP + DRAW_H * 0.5;
  return PAD_TOP + ((maxV - v) / range) * DRAW_H;
}

function buildCVDPaths(
  cvd:      readonly number[],
  startIdx: number,
  endIdx:   number,
  tx:       number,
  cw:       number,
  minV:     number,
  maxV:     number,
): { rising: SkPath; falling: SkPath } {
  'worklet';
  const rising  = Skia.Path.Make();
  const falling = Skia.Path.Make();

  let pathStarted = false;

  for (let i = startIdx; i <= endIdx; i++) {
    const val = cvd[i];
    if (val === undefined) continue;
    const x = tx + i * cw + cw * 0.5;
    const y = cvdToY(val, minV, maxV);
    const isRising = i === 0 || val >= (cvd[i - 1] ?? val);
    const path = isRising ? rising : falling;

    if (!pathStarted) {
      rising.moveTo(x, y);
      falling.moveTo(x, y);
      pathStarted = true;
    } else {
      path.lineTo(x, y);
      // Keep the other path at current position
      const other = isRising ? falling : rising;
      other.moveTo(x, y);
    }
  }

  return { rising, falling };
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface CVDIndicatorProps {
  ticker:     string;
  timeframe:  string;
  translateX: SharedValue<number>;
  candleW:    SharedValue<number>;
  font:       SkFont | null;
  numCandles?: number;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function CVDIndicator({
  ticker,
  timeframe,
  translateX,
  candleW,
  font,
}: CVDIndicatorProps) {
  const { width: screenW } = useWindowDimensions();
  const CHART_W = screenW - CHART_LAYOUT.priceAxisWidth;
  const key = `${ticker}_${timeframe}`;

  const cvdData = useIndicatorStore((s) => s.cvd[key]);
  const cumulative  = cvdData?.cumulative  ?? [];
  const divergences = cvdData?.divergences ?? [];

  // ── Derived paths (UI thread) ─────────────────────────────────────────────

  const paths = useDerivedValue(() => {
    const tx = translateX.value;
    const cw = candleW.value;
    const n  = cumulative.length;
    if (n === 0) return null;

    const startIdx = Math.max(0, Math.floor(-tx / cw));
    const endIdx   = Math.min(n - 1, Math.ceil((-tx + screenW) / cw));

    let minV = Infinity;
    let maxV = -Infinity;
    for (let i = startIdx; i <= endIdx; i++) {
      const v = cumulative[i];
      if (v === undefined) continue;
      if (v < minV) minV = v;
      if (v > maxV) maxV = v;
    }
    // Always include zero in range for reference
    if (minV > 0) minV = 0;
    if (maxV < 0) maxV = 0;

    const { rising, falling } = buildCVDPaths(
      cumulative, startIdx, endIdx, tx, cw, minV, maxV,
    );

    const zeroY = cvdToY(0, minV, maxV);

    return { rising, falling, zeroY, minV, maxV };
  });

  // Zero line Y position for right-axis label
  const zeroYDV = useDerivedValue((): number => {
    'worklet';
    const p = paths.value;
    return p ? p.zeroY - 3 : -100;
  });

  // Extracted paths for unconditional Canvas rendering (RULE: no .value in JSX)
  const risingPath = useDerivedValue((): SkPath => {
    'worklet';
    return paths.value?.rising ?? Skia.Path.Make();
  });
  const fallingPath = useDerivedValue((): SkPath => {
    'worklet';
    return paths.value?.falling ?? Skia.Path.Make();
  });
  const zeroLinePath = useDerivedValue((): SkPath => {
    'worklet';
    const p = Skia.Path.Make();
    const data = paths.value;
    if (!data) return p;
    p.moveTo(0, data.zeroY);
    p.lineTo(4096, data.zeroY);
    return p;
  });

  // Divergence dot positions (JS thread, static on paint)
  const divergenceDots = buildDivergenceDots(
    divergences, cumulative, translateX, candleW, screenW,
  );

  // Current CVD label
  const last = cumulative.length > 0 ? cumulative[cumulative.length - 1] ?? 0 : 0;
  const lastLabel =
    Math.abs(last) >= 1_000_000 ? `${(last / 1_000_000).toFixed(1)}M` :
    Math.abs(last) >= 1_000     ? `${(last / 1_000).toFixed(1)}K`     :
    String(Math.round(last));
  const labelColor = last >= 0 ? '#22c55e' : '#ef4444';

  return (
    <SkiaErrorBoundary name="CVDIndicator" height={INDICATOR_H}>
    <Canvas style={[styles.canvas, { width: screenW }]}>
      {/* Zero line */}
      <Path
        path={zeroLinePath}
        color={CHART_COLORS.gridLine}
        style="stroke"
        strokeWidth={1}
      >
        <DashPathEffect intervals={[4, 4]} />
      </Path>

      {/* Rising CVD (green) */}
      <Path
        path={risingPath}
        color="#22c55e"
        style="stroke"
        strokeWidth={1.5}
        strokeJoin="round"
        strokeCap="round"
      />

      {/* Falling CVD (red) */}
      <Path
        path={fallingPath}
        color="#ef4444"
        style="stroke"
        strokeWidth={1.5}
        strokeJoin="round"
        strokeCap="round"
      />

      {/* Divergence dots */}
      {divergenceDots.map((d) => (
        <Circle
          key={d.key}
          cx={d.x}
          cy={d.y}
          r={3}
          color={d.color}
        />
      ))}

      {/* Price axis separator */}
      <Line p1={{ x: CHART_W, y: 0 }} p2={{ x: CHART_W, y: INDICATOR_H }} color={CHART_COLORS.gridLine} strokeWidth={0.5} />

      {/* Zero label on right axis */}
      {font && (
        <Text x={CHART_W + 4} y={zeroYDV} text="0" font={font} color={CHART_COLORS.textMuted} />
      )}

      {/* Current value label */}
      {font && (
        <Text
          x={CHART_W + 4}
          y={PAD_TOP + 10}
          text={`CVD ${lastLabel}`}
          font={font}
          color={labelColor}
        />
      )}
    </Canvas>
    </SkiaErrorBoundary>
  );
}

// ── Divergence dot builder (JS thread) ───────────────────────────────────────

interface DivergenceDot {
  key:   string;
  x:     number;
  y:     number;
  color: string;
}

function buildDivergenceDots(
  divergences: readonly CVDDivergencePoint[],
  cumulative:  readonly number[],
  translateX:  SharedValue<number>,
  candleW:     SharedValue<number>,
  screenW:     number,
): DivergenceDot[] {
  const tx = translateX.value;
  const cw = candleW.value;
  const n  = cumulative.length;
  if (n === 0) return [];

  let minV = Infinity;
  let maxV = -Infinity;
  for (const v of cumulative) {
    if (v < minV) minV = v;
    if (v > maxV) maxV = v;
  }
  if (minV > 0) minV = 0;
  if (maxV < 0) maxV = 0;

  return divergences
    .filter((d) => {
      const x = tx + d.barIdx * cw + cw * 0.5;
      return x >= 0 && x <= screenW;
    })
    .map((d) => {
      const x   = tx + d.barIdx * cw + cw * 0.5;
      const val = cumulative[d.barIdx] ?? 0;
      const y   = cvdToY(val, minV, maxV) + (d.type === 'bearish' ? -6 : 6);
      return {
        key:   `${d.type}_${d.barIdx}`,
        x,
        y,
        color: d.type === 'bearish' ? '#ef4444' : '#22c55e',
      };
    });
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  canvas: {
    height: INDICATOR_H,
    backgroundColor: CHART_COLORS.background,
  },
});

const CVDIndicatorMemo = React.memo(CVDIndicator);
export { CVDIndicatorMemo as CVDIndicatorMemo };
