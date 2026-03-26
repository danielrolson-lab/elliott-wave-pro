/**
 * VolumeIndicator.tsx
 *
 * Skia volume sub-indicator panel. Reads from the indicator store.
 *
 * Visual spec:
 *   • Green bars when close >= open; red bars when close < open
 *   • Bars whose volume exceeds the 20-bar MA → bright color (full opacity)
 *   • Bars below the 20-bar MA → dim color (35% opacity)
 *   • 20-bar volume MA line in yellow
 *   • Current volume and relative-to-MA ratio printed top-right
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
import type { OHLCV } from '@elliott-wave-pro/wave-engine';
import { useIndicatorStore } from '../../stores/indicators';
import { CHART_COLORS, CHART_LAYOUT } from '../chart/chartTypes';
import { INDICATOR_H } from './RSIIndicator';

const PAD_TOP = 4;
const DRAW_H  = INDICATOR_H - PAD_TOP;

// ── Worklet path builders ─────────────────────────────────────────────────────

function buildVolumePaths(
  candles:  readonly OHLCV[],
  volumes:  readonly number[],
  ma20:     readonly number[],
  startIdx: number,
  endIdx:   number,
  tx:       number,
  cw:       number,
  maxVol:   number,
): {
  bullBright: SkPath;
  bullDim:    SkPath;
  bearBright: SkPath;
  bearDim:    SkPath;
  maPath:     SkPath;
} {
  'worklet';
  const bullBright = Skia.Path.Make();
  const bullDim    = Skia.Path.Make();
  const bearBright = Skia.Path.Make();
  const bearDim    = Skia.Path.Make();
  const maPath     = Skia.Path.Make();

  if (maxVol < 1) return { bullBright, bullDim, bearBright, bearDim, maPath };

  const gap  = cw * 0.15;
  const barW = cw - gap;
  const half = cw * 0.5;
  let maFirst = true;

  for (let i = startIdx; i < endIdx; i++) {
    if (i >= volumes.length || i >= candles.length) break;
    const vol  = volumes[i];
    const avg  = ma20[i] ?? 0;
    const c    = candles[i];
    const x    = tx + i * cw + gap / 2;
    const barH = Math.max(1, (vol / maxVol) * DRAW_H);
    const rect = Skia.XYWHRect(x, PAD_TOP + DRAW_H - barH, barW, barH);

    const isBull   = c.close >= c.open;
    const isAboveMA = vol >= avg;

    if (isBull) {
      (isAboveMA ? bullBright : bullDim).addRect(rect);
    } else {
      (isAboveMA ? bearBright : bearDim).addRect(rect);
    }

    // MA line
    if (i < ma20.length) {
      const maH = (avg / maxVol) * DRAW_H;
      const maY = PAD_TOP + DRAW_H - maH;
      const mx  = tx + i * cw + half;
      if (maFirst) { maPath.moveTo(mx, maY); maFirst = false; }
      else          maPath.lineTo(mx, maY);
    }
  }
  return { bullBright, bullDim, bearBright, bearDim, maPath };
}

// ── Component ─────────────────────────────────────────────────────────────────

export interface VolumeIndicatorProps {
  ticker:     string;
  timeframe:  string;
  candles:    readonly OHLCV[];
  translateX: SharedValue<number>;
  candleW:    SharedValue<number>;
  font:       SkFont | null;
}

export function VolumeIndicator({
  ticker,
  timeframe,
  candles,
  translateX,
  candleW,
  font,
}: VolumeIndicatorProps) {
  const { width: screenW } = useWindowDimensions();
  const CHART_W = screenW - CHART_LAYOUT.priceAxisWidth;
  const numCandles = candles.length;

  const key     = `${ticker}_${timeframe}`;
  const volStore = useIndicatorStore((s) => s.volume[key]);

  const volumesSV  = useSharedValue<readonly number[]>([]);
  const ma20SV     = useSharedValue<readonly number[]>([]);
  const candlesSV  = useSharedValue<readonly OHLCV[]>([]);

  useEffect(() => {
    volumesSV.value = volStore?.volumes ?? [];
    ma20SV.value    = volStore?.ma20    ?? [];
  }, [volStore, volumesSV, ma20SV]);

  useEffect(() => {
    candlesSV.value = candles;
  }, [candles, candlesSV]);

  // Visible range + max volume for scaling
  const layoutDV = useDerivedValue(() => {
    'worklet';
    const tx = translateX.value;
    const cw = candleW.value;
    const startIdx = Math.max(0, Math.floor(-tx / cw));
    const endIdx   = Math.min(numCandles, Math.ceil((-tx + CHART_W) / cw) + 1);

    let maxVol = 0;
    const vols = volumesSV.value;
    for (let i = startIdx; i < endIdx; i++) {
      if (i < vols.length && vols[i] > maxVol) maxVol = vols[i];
    }
    return { startIdx, endIdx, tx, cw, maxVol };
  });

  const pathsDV = useDerivedValue(() => {
    'worklet';
    const { startIdx, endIdx, tx, cw, maxVol } = layoutDV.value;
    return buildVolumePaths(
      candlesSV.value, volumesSV.value, ma20SV.value,
      startIdx, endIdx, tx, cw, maxVol,
    );
  });

  const bullBright = useDerivedValue((): SkPath => pathsDV.value.bullBright);
  const bullDim    = useDerivedValue((): SkPath => pathsDV.value.bullDim);
  const bearBright = useDerivedValue((): SkPath => pathsDV.value.bearBright);
  const bearDim    = useDerivedValue((): SkPath => pathsDV.value.bearDim);
  const maPath     = useDerivedValue((): SkPath => pathsDV.value.maPath);

  // Current volume label
  const currentLabel = useDerivedValue((): string => {
    'worklet';
    const vols = volumesSV.value;
    const ma   = ma20SV.value;
    if (vols.length === 0) return 'Vol –';
    const last  = vols[vols.length - 1];
    const maLast = ma[ma.length - 1] ?? 1;
    const rel   = (last / maLast).toFixed(2);
    const k     = (last / 1000).toFixed(0);
    return `${k}K  ${rel}×`;
  });

  return (
    <Canvas style={[styles.canvas, { width: screenW, height: INDICATOR_H }]}>
      <Rect x={0} y={0} width={screenW} height={INDICATOR_H} color={CHART_COLORS.background} />

      {/* Dim bars (below MA) */}
      <Path path={bullDim} style="fill" color="rgba(38,166,154,0.30)" />
      <Path path={bearDim} style="fill" color="rgba(239,83,80,0.30)" />

      {/* Bright bars (above MA) */}
      <Path path={bullBright} style="fill" color="rgba(38,166,154,0.80)" />
      <Path path={bearBright} style="fill" color="rgba(239,83,80,0.80)" />

      {/* Volume MA-20 line */}
      <Path path={maPath} style="stroke" strokeWidth={1.5} color={CHART_COLORS.ema9} />

      {/* Axis separator */}
      <Line p1={{ x: CHART_W, y: 0 }} p2={{ x: CHART_W, y: INDICATOR_H }} color={CHART_COLORS.gridLine} strokeWidth={0.5} />

      {/* Value label */}
      {font !== null && (
        <Text x={CHART_W + 4} y={PAD_TOP + 10} text={currentLabel} font={font} color={CHART_COLORS.textMuted} />
      )}
    </Canvas>
  );
}

const styles = StyleSheet.create({
  canvas: { backgroundColor: CHART_COLORS.background },
});

const VolumeIndicatorMemo = React.memo(VolumeIndicator);
export { VolumeIndicatorMemo as VolumeIndicatorMemo };
