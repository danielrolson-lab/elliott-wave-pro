/**
 * CandlestickChart.tsx
 *
 * GPU-accelerated candlestick chart via @shopify/react-native-skia.
 *
 * Rendering layers (bottom → top):
 *   1. Grid       — horizontal price lines + vertical time labels
 *   2. Candles    — bodies (Rect) and wicks (Path), bull/bear split
 *   3. Volume     — scaled bars below the main chart
 *   4. MA Overlay — EMA 9 / 21 / 50 / 200 as colored stroke Paths
 *   5. Crosshair  — tap to activate; shows price + OHLCV tooltip
 *
 * Gestures:
 *   - Pan   (1 finger) → scroll horizontally through candle history
 *   - Pinch (2 finger) → zoom the time axis (candleWidth 3 – 40 px)
 *   - Tap             → show / hide crosshair at tapped candle
 *
 * All paths are computed inside useDerivedValue worklets on the UI thread.
 * Gesture state is held in Reanimated SharedValues, so chart updates never
 * block the JS thread during pan / pinch.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import {
  Canvas,
  Path,
  Line,
  Text as SkiaText,
  Group,
  Skia,
  type SkFont,
  type SkPath,
} from '@shopify/react-native-skia';
import {
  useSharedValue,
  useDerivedValue,
  clamp,
  runOnJS,
} from 'react-native-reanimated';
import type { SharedValue } from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import type { OHLCV, WaveCount } from '@elliott-wave-pro/wave-engine';
import type { OverlayConfig } from '../../stores/ui';
import { CHART_COLORS, CHART_LAYOUT } from './chartTypes';
import { WaveOverlayLayer }       from './WaveOverlayLayer';
import { FibonacciOverlayLayer }  from './FibonacciOverlayLayer';
import { GEXOverlayLayer }        from './GEXOverlayLayer';
import { WaveChannelLayer }       from './WaveChannelLayer';
import type { GEXLevels }         from '../../utils/gexCalculator';

// ── Types ────────────────────────────────────────────────────────────────────

export interface CandlestickChartProps {
  candles:      readonly OHLCV[];
  overlays:     OverlayConfig;
  ticker?:      string;
  /** Top-scored wave counts from useWaveEngine (optional). */
  waveCounts?:  readonly WaveCount[];
  /** How many candles precede the slice passed to the wave engine. */
  waveSliceOffset?: number;
  /** GEX levels to overlay (Zero GEX, Call Wall, Put Wall). */
  gexLevels?:          GEXLevels | null;
  /** Stop/invalidation price for the active scenario (shown as red dashed line). */
  activeStopPrice?:    number;
  /** Shared values lifted to App level so IndicatorPanel can sync. */
  externalTranslateX?: SharedValue<number>;
  externalCandleW?:    SharedValue<number>;
}

// ── Crosshair HUD data ────────────────────────────────────────────────────────

interface HudData {
  open: number; high: number; low: number; close: number;
  volume: number; pctChange: number; xRight: boolean;
}

function formatVolume(v: number): string {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000)     return `${Math.round(v / 1_000)}K`;
  return String(Math.round(v));
}

// ── EMA computation (JS thread) ──────────────────────────────────────────────

function computeEMA(candles: readonly OHLCV[], period: number): number[] {
  if (candles.length === 0) return [];
  const k = 2 / (period + 1);
  const result: number[] = new Array(candles.length);
  result[0] = candles[0].close;
  for (let i = 1; i < candles.length; i++) {
    result[i] = candles[i].close * k + result[i - 1] * (1 - k);
  }
  return result;
}

// ── Worklet helpers ───────────────────────────────────────────────────────────

function pToY(
  price: number,
  minP: number,
  maxP: number,
  top: number,
  height: number,
): number {
  'worklet';
  const range = maxP - minP;
  if (range < 1e-9) return top + height * 0.5;
  return top + ((maxP - price) / range) * height;
}

function buildCandlePaths(
  candles: readonly OHLCV[],
  startIdx: number,
  endIdx: number,
  tx: number,
  cw: number,
  minP: number,
  maxP: number,
  chartTop: number,
  chartH: number,
): { bull: SkPath; bear: SkPath; wick: SkPath } {
  'worklet';
  const bull = Skia.Path.Make();
  const bear = Skia.Path.Make();
  const wick = Skia.Path.Make();
  const gap = cw * CHART_LAYOUT.candleGapRatio;
  const bodyW = cw - gap;
  const wickX = bodyW / 2 + gap / 2;

  for (let i = startIdx; i < endIdx; i++) {
    const c = candles[i];
    const x = tx + i * cw;
    const bodyTop = pToY(Math.max(c.open, c.close), minP, maxP, chartTop, chartH);
    const bodyBot = pToY(Math.min(c.open, c.close), minP, maxP, chartTop, chartH);
    const wickTop = pToY(c.high, minP, maxP, chartTop, chartH);
    const wickBot = pToY(c.low, minP, maxP, chartTop, chartH);
    const bodyH = Math.max(1, bodyBot - bodyTop);
    const cx = x + wickX;

    // Wick (shared path — same color as body side)
    wick.moveTo(cx, wickTop);
    wick.lineTo(cx, wickBot);

    const rect = Skia.XYWHRect(x + gap / 2, bodyTop, bodyW, bodyH);
    if (c.close >= c.open) {
      bull.addRect(rect);
    } else {
      bear.addRect(rect);
    }
  }
  return { bull, bear, wick };
}

function buildVolumePaths(
  candles: readonly OHLCV[],
  startIdx: number,
  endIdx: number,
  tx: number,
  cw: number,
  maxVol: number,
  volTop: number,
  volH: number,
): { bull: SkPath; bear: SkPath } {
  'worklet';
  const bull = Skia.Path.Make();
  const bear = Skia.Path.Make();
  if (maxVol < 1) return { bull, bear };
  const gap = cw * CHART_LAYOUT.candleGapRatio;
  const barW = cw - gap;

  for (let i = startIdx; i < endIdx; i++) {
    const c = candles[i];
    const x = tx + i * cw;
    const barH = Math.max(1, (c.volume / maxVol) * volH);
    const rect = Skia.XYWHRect(x + gap / 2, volTop + volH - barH, barW, barH);
    if (c.close >= c.open) {
      bull.addRect(rect);
    } else {
      bear.addRect(rect);
    }
  }
  return { bull, bear };
}

function buildEmaPath(
  ema: readonly number[],
  candles: readonly OHLCV[],
  startIdx: number,
  endIdx: number,
  tx: number,
  cw: number,
  minP: number,
  maxP: number,
  chartTop: number,
  chartH: number,
): SkPath {
  'worklet';
  const path = Skia.Path.Make();
  const gap = cw * CHART_LAYOUT.candleGapRatio;
  let first = true;

  for (let i = startIdx; i < endIdx; i++) {
    if (i >= ema.length || i >= candles.length) break;
    const x = tx + i * cw + (cw - gap) / 2 + gap / 2;
    const y = pToY(ema[i], minP, maxP, chartTop, chartH);
    if (first) {
      path.moveTo(x, y);
      first = false;
    } else {
      path.lineTo(x, y);
    }
  }
  return path;
}

function buildGridPath(
  prices: number[],
  chartTop: number,
  chartH: number,
  minP: number,
  maxP: number,
  chartAreaW: number,
): SkPath {
  'worklet';
  const path = Skia.Path.Make();
  for (let i = 0; i < prices.length; i++) {
    const y = pToY(prices[i], minP, maxP, chartTop, chartH);
    path.moveTo(0, y);
    path.lineTo(chartAreaW, y);
  }
  return path;
}

// ── Main component ────────────────────────────────────────────────────────────

export function CandlestickChart({
  candles,
  overlays,
  ticker = '',
  waveCounts = [],
  waveSliceOffset = 0,
  gexLevels = null,
  activeStopPrice = 0,
  externalTranslateX,
  externalCandleW,
}: CandlestickChartProps) {
  const { width: screenW } = useWindowDimensions();

  // ── Layout constants (derived from screen size) ────────────────────────────
  const CANVAS_H        = 404;
  const CHART_AREA_W    = screenW - CHART_LAYOUT.priceAxisWidth;
  const VOL_H           = Math.round(CANVAS_H * CHART_LAYOUT.volumeRatio);
  const TIME_AXIS_H     = CHART_LAYOUT.timeAxisHeight;
  const CHART_H         = CANVAS_H - VOL_H - TIME_AXIS_H;
  const CHART_TOP       = CHART_LAYOUT.paddingTop;
  const CHART_DRAW_H    = CHART_H - CHART_LAYOUT.paddingTop;
  const VOL_TOP         = CHART_H;
  const TIME_AXIS_TOP   = CHART_H + VOL_H;

  // ── Font (created once on JS thread) ──────────────────────────────────────
  const font: SkFont | null = useMemo(() => {
    try {
      return Skia.Font(undefined, 10);
    } catch {
      return null;
    }
  }, []);

  // ── Crosshair HUD state (JS thread) ──────────────────────────────────────
  const [hudData, setHudData] = useState<HudData | null>(null);

  const updateHudJS = useCallback((idx: number, xRight: boolean) => {
    const c    = candles[idx];
    const prev = idx > 0 ? candles[idx - 1] : null;
    if (!c) { setHudData(null); return; }
    const prevClose = prev?.close ?? c.open;
    const pctChange = ((c.close - prevClose) / prevClose) * 100;
    setHudData({ open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume, pctChange, xRight });
  }, [candles]);

  const clearHudJS = useCallback(() => setHudData(null), []);

  // ── Gesture state (SharedValues — UI thread) ───────────────────────────────
  // Always create internal fallbacks (hooks must not be conditional).
  // Use externals when provided so IndicatorPanel stays in sync.
  const _internalCandleW  = useSharedValue<number>(CHART_LAYOUT.candleDefaultW);
  const _internalTranslateX = useSharedValue(0);
  const candleW    = externalCandleW    ?? _internalCandleW;
  const translateX = externalTranslateX ?? _internalTranslateX;
  const crosshairX   = useSharedValue(-1);  // -1 = hidden
  const crosshairVisible = useSharedValue(false);

  // ── Data shared with worklets ──────────────────────────────────────────────
  const candlesSV = useSharedValue<readonly OHLCV[]>([]);
  const ema9SV    = useSharedValue<readonly number[]>([]);
  const ema21SV   = useSharedValue<readonly number[]>([]);
  const ema50SV   = useSharedValue<readonly number[]>([]);
  const ema200SV  = useSharedValue<readonly number[]>([]);

  // Sync candles + EMA arrays to UI thread whenever they change
  useEffect(() => {
    candlesSV.value = candles;
  }, [candles, candlesSV]);

  const ema9  = useMemo(() => computeEMA(candles, 9),   [candles]);
  const ema21 = useMemo(() => computeEMA(candles, 21),  [candles]);
  const ema50 = useMemo(() => computeEMA(candles, 50),  [candles]);
  const ema200= useMemo(() => computeEMA(candles, 200), [candles]);

  useEffect(() => { ema9SV.value   = ema9;  }, [ema9,   ema9SV]);
  useEffect(() => { ema21SV.value  = ema21; }, [ema21,  ema21SV]);
  useEffect(() => { ema50SV.value  = ema50; }, [ema50,  ema50SV]);
  useEffect(() => { ema200SV.value = ema200;}, [ema200, ema200SV]);

  // Initialize translateX so the latest candles appear on the right
  useEffect(() => {
    const totalW = candles.length * CHART_LAYOUT.candleDefaultW;
    const initTx = Math.min(0, -(totalW - CHART_AREA_W + CHART_LAYOUT.priceAxisWidth * 0.5));
    translateX.value = initTx;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candles.length]);

  // ── Derived layout (UI thread) ─────────────────────────────────────────────
  const layoutDV = useDerivedValue(() => {
    'worklet';
    const cs = candlesSV.value;
    const tx = translateX.value;
    const cw = candleW.value;
    const n  = cs.length;

    const startIdx = Math.max(0, Math.floor(-tx / cw));
    const endIdx   = Math.min(n, Math.ceil((-tx + CHART_AREA_W) / cw) + 1);

    let minP = Infinity;
    let maxP = -Infinity;
    let maxVol = 0;
    for (let i = startIdx; i < endIdx; i++) {
      const c = cs[i];
      if (c.low  < minP)  minP  = c.low;
      if (c.high > maxP)  maxP  = c.high;
      if (c.volume > maxVol) maxVol = c.volume;
    }
    if (!isFinite(minP)) { minP = 0; maxP = 1; }
    const pad = (maxP - minP) * 0.05 || 1;
    minP -= pad;
    maxP += pad;

    return { startIdx, endIdx, minP, maxP, maxVol, tx, cw, n };
  });

  // ── Grid path ─────────────────────────────────────────────────────────────
  const gridPath = useDerivedValue((): SkPath => {
    'worklet';
    const { minP, maxP } = layoutDV.value;
    const prices: number[] = [];
    for (let i = 0; i <= CHART_LAYOUT.gridLineCount; i++) {
      prices.push(minP + (maxP - minP) * (i / CHART_LAYOUT.gridLineCount));
    }
    return buildGridPath(prices, CHART_TOP, CHART_DRAW_H, minP, maxP, CHART_AREA_W);
  });

  // ── Candle paths ──────────────────────────────────────────────────────────
  const candlePathsDV = useDerivedValue(() => {
    'worklet';
    const { startIdx, endIdx, minP, maxP, tx, cw } = layoutDV.value;
    return buildCandlePaths(
      candlesSV.value, startIdx, endIdx,
      tx, cw, minP, maxP, CHART_TOP, CHART_DRAW_H,
    );
  });

  const bullBodyPath = useDerivedValue((): SkPath => candlePathsDV.value.bull);
  const bearBodyPath = useDerivedValue((): SkPath => candlePathsDV.value.bear);
  const wickPath     = useDerivedValue((): SkPath => candlePathsDV.value.wick);

  // ── Volume paths ──────────────────────────────────────────────────────────
  const volPathsDV = useDerivedValue(() => {
    'worklet';
    const { startIdx, endIdx, maxVol, tx, cw } = layoutDV.value;
    return buildVolumePaths(
      candlesSV.value, startIdx, endIdx,
      tx, cw, maxVol, VOL_TOP, VOL_H,
    );
  });
  const volBullPath = useDerivedValue((): SkPath => volPathsDV.value.bull);
  const volBearPath = useDerivedValue((): SkPath => volPathsDV.value.bear);

  // ── EMA paths ─────────────────────────────────────────────────────────────
  const ema9Path = useDerivedValue((): SkPath => {
    'worklet';
    const { startIdx, endIdx, minP, maxP, tx, cw } = layoutDV.value;
    return buildEmaPath(ema9SV.value, candlesSV.value, startIdx, endIdx, tx, cw, minP, maxP, CHART_TOP, CHART_DRAW_H);
  });
  const ema21Path = useDerivedValue((): SkPath => {
    'worklet';
    const { startIdx, endIdx, minP, maxP, tx, cw } = layoutDV.value;
    return buildEmaPath(ema21SV.value, candlesSV.value, startIdx, endIdx, tx, cw, minP, maxP, CHART_TOP, CHART_DRAW_H);
  });
  const ema50Path = useDerivedValue((): SkPath => {
    'worklet';
    const { startIdx, endIdx, minP, maxP, tx, cw } = layoutDV.value;
    return buildEmaPath(ema50SV.value, candlesSV.value, startIdx, endIdx, tx, cw, minP, maxP, CHART_TOP, CHART_DRAW_H);
  });
  const ema200Path = useDerivedValue((): SkPath => {
    'worklet';
    const { startIdx, endIdx, minP, maxP, tx, cw } = layoutDV.value;
    return buildEmaPath(ema200SV.value, candlesSV.value, startIdx, endIdx, tx, cw, minP, maxP, CHART_TOP, CHART_DRAW_H);
  });

  // ── Crosshair ─────────────────────────────────────────────────────────────
  const crosshairOpacity = useDerivedValue(() => crosshairVisible.value ? 1 : 0);

  const crosshairVLinePath = useDerivedValue((): SkPath => {
    'worklet';
    const p = Skia.Path.Make();
    const x = crosshairX.value;
    if (x < 0) return p;
    p.moveTo(x, CHART_TOP);
    p.lineTo(x, TIME_AXIS_TOP);
    return p;
  });

  const crosshairHLineY = useDerivedValue((): number => {
    'worklet';
    const x = crosshairX.value;
    if (x < 0) return -1;
    const { startIdx, endIdx, minP, maxP, tx, cw } = layoutDV.value;
    const candleIdx = Math.min(endIdx - 1, Math.max(startIdx, Math.round((x - tx) / cw)));
    const cs = candlesSV.value;
    if (candleIdx < 0 || candleIdx >= cs.length) return -1;
    return pToY(cs[candleIdx].close, minP, maxP, CHART_TOP, CHART_DRAW_H);
  });

  const crosshairHLinePath = useDerivedValue((): SkPath => {
    'worklet';
    const p = Skia.Path.Make();
    const y = crosshairHLineY.value;
    if (y < 0) return p;
    p.moveTo(0, y);
    p.lineTo(CHART_AREA_W, y);
    return p;
  });

  // Crosshair price text
  const crosshairPriceText = useDerivedValue((): string => {
    'worklet';
    const x = crosshairX.value;
    if (x < 0) return '';
    const { startIdx, endIdx, tx, cw } = layoutDV.value;
    const candleIdx = Math.min(endIdx - 1, Math.max(startIdx, Math.round((x - tx) / cw)));
    const cs = candlesSV.value;
    if (candleIdx < 0 || candleIdx >= cs.length) return '';
    const c = cs[candleIdx];
    return `$${c.close.toFixed(2)}`;
  });

  const crosshairPriceY = useDerivedValue((): number => {
    'worklet';
    const y = crosshairHLineY.value;
    return y < 0 ? -100 : y - 12;
  });

  // ── Price axis labels (JS thread — uses useMemo for text) ─────────────────
  const priceLabels = useMemo(() => {
    if (candles.length === 0) return [];
    // Use last visible window
    const n = candles.length;
    const cw = CHART_LAYOUT.candleDefaultW;
    const start = Math.max(0, n - Math.ceil(CHART_AREA_W / cw));
    let minP = Infinity, maxP = -Infinity;
    for (let i = start; i < n; i++) {
      if (candles[i].low  < minP) minP = candles[i].low;
      if (candles[i].high > maxP) maxP = candles[i].high;
    }
    const pad = (maxP - minP) * 0.05 || 1;
    minP -= pad; maxP += pad;
    const labels: Array<{ text: string; y: number }> = [];
    for (let i = 0; i <= CHART_LAYOUT.gridLineCount; i++) {
      const price = minP + (maxP - minP) * (i / CHART_LAYOUT.gridLineCount);
      const y = CHART_TOP + ((maxP - price) / (maxP - minP)) * CHART_DRAW_H;
      labels.push({ text: price.toFixed(2), y });
    }
    return labels;
  }, [candles, CHART_AREA_W, CHART_TOP, CHART_DRAW_H]);

  // ── Gestures ───────────────────────────────────────────────────────────────

  // Pinch to zoom (time axis = candleWidth)
  const pinchStartCW = useSharedValue<number>(candleW.value);
  const pinchGesture = Gesture.Pinch()
    .onStart(() => {
      'worklet';
      pinchStartCW.value = candleW.value;
    })
    .onUpdate((e) => {
      'worklet';
      const next = clamp(
        pinchStartCW.value * e.scale,
        CHART_LAYOUT.candleMinW,
        CHART_LAYOUT.candleMaxW,
      );
      candleW.value = next;
    });

  // Pan to scroll
  const panStartTx = useSharedValue(0);
  const panGesture = Gesture.Pan()
    .maxPointers(1)
    .onStart(() => {
      'worklet';
      panStartTx.value = translateX.value;
    })
    .onUpdate((e) => {
      'worklet';
      const { n, cw } = layoutDV.value;
      const maxTx = 0;
      const minTx = -(n * cw - CHART_AREA_W * 0.8);
      translateX.value = clamp(panStartTx.value + e.translationX, minTx, maxTx);
    });

  // Tap for crosshair + HUD
  const tapGesture = Gesture.Tap().onEnd((e) => {
    'worklet';
    const { startIdx, endIdx, tx, cw } = layoutDV.value;
    const idx    = Math.min(endIdx - 1, Math.max(startIdx, Math.round((e.x - tx) / cw)));
    const xRight = e.x > CHART_AREA_W / 2;
    runOnJS(updateHudJS)(idx, xRight);
    crosshairX.value = e.x;
    crosshairVisible.value = true;
  });

  // Long press dismisses crosshair + HUD
  const longPressGesture = Gesture.LongPress()
    .minDuration(300)
    .onStart(() => {
      'worklet';
      crosshairVisible.value = false;
      crosshairX.value = -1;
      runOnJS(clearHudJS)();
    });

  const composedGesture = Gesture.Simultaneous(
    Gesture.Exclusive(tapGesture, panGesture),
    pinchGesture,
    longPressGesture,
  );

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <View style={styles.wrapper}>
      <GestureDetector gesture={composedGesture}>
        <Canvas style={[styles.canvas, { width: screenW, height: CANVAS_H }]}>
          {/* ── Background ── */}
          <Path
            path={`M 0 0 L ${screenW} 0 L ${screenW} ${CANVAS_H} L 0 ${CANVAS_H} Z`}
            color={CHART_COLORS.background}
            style="fill"
          />

          {/* ── Grid layer ── */}
          <Path
            path={gridPath}
            color={CHART_COLORS.gridLine}
            style="stroke"
            strokeWidth={0.5}
          />

          {/* ── Separator between chart and volume ── */}
          <Line
            p1={{ x: 0, y: VOL_TOP }}
            p2={{ x: CHART_AREA_W, y: VOL_TOP }}
            color={CHART_COLORS.gridLine}
            strokeWidth={0.5}
          />

          {/* ── Price axis divider ── */}
          <Line
            p1={{ x: CHART_AREA_W, y: 0 }}
            p2={{ x: CHART_AREA_W, y: TIME_AXIS_TOP }}
            color={CHART_COLORS.gridLine}
            strokeWidth={0.5}
          />

          {/* ── Price labels (static, right axis) ── */}
          {font !== null &&
            priceLabels.map((lbl) => (
              <SkiaText
                key={lbl.text}
                x={CHART_AREA_W + 4}
                y={lbl.y + 4}
                text={lbl.text}
                font={font}
                color={CHART_COLORS.textMuted}
              />
            ))}

          {/* ── Ticker label ── */}
          {font !== null && ticker !== '' && (
            <SkiaText
              x={6}
              y={CHART_TOP + 14}
              text={ticker}
              font={font}
              color={CHART_COLORS.textMuted}
            />
          )}

          {/* ── Volume layer ── */}
          <Path path={volBullPath} color={CHART_COLORS.volumeBull} style="fill" />
          <Path path={volBearPath} color={CHART_COLORS.volumeBear} style="fill" />

          {/* ── Wick layer (behind bodies) ── */}
          <Path
            path={wickPath}
            color={CHART_COLORS.textMuted}
            style="stroke"
            strokeWidth={1}
          />

          {/* ── Candle body layer ── */}
          <Path path={bullBodyPath} color={CHART_COLORS.bullBody} style="fill" />
          <Path path={bearBodyPath} color={CHART_COLORS.bearBody} style="fill" />

          {/* ── MA overlay layer ── */}
          {overlays.ema9 && (
            <Path
              path={ema9Path}
              color={CHART_COLORS.ema9}
              style="stroke"
              strokeWidth={1.5}
            />
          )}
          {overlays.ema21 && (
            <Path
              path={ema21Path}
              color={CHART_COLORS.ema21}
              style="stroke"
              strokeWidth={1.5}
            />
          )}
          {overlays.ema50 && (
            <Path
              path={ema50Path}
              color={CHART_COLORS.ema50}
              style="stroke"
              strokeWidth={1.5}
            />
          )}
          {overlays.ema200 && (
            <Path
              path={ema200Path}
              color={CHART_COLORS.ema200}
              style="stroke"
              strokeWidth={1.5}
            />
          )}

          {/* ── Fibonacci overlay layer ── */}
          {overlays.fibRetracements && waveCounts.length > 0 && (
            <FibonacciOverlayLayer
              waveCounts={waveCounts}
              layoutDV={layoutDV}
              chartTop={CHART_TOP}
              chartDrawH={CHART_DRAW_H}
              chartAreaW={CHART_AREA_W}
              font={font}
            />
          )}

          {/* ── GEX overlay layer ── */}
          {overlays.gexLevels && (
            <GEXOverlayLayer
              levels={gexLevels}
              layoutDV={layoutDV}
              chartTop={CHART_TOP}
              chartDrawH={CHART_DRAW_H}
              chartAreaW={CHART_AREA_W}
              font={font}
            />
          )}

          {/* ── Wave channel lines (E4) ── */}
          {overlays.elliottWaveLabels && waveCounts.length > 0 && (
            <WaveChannelLayer
              waveCounts={waveCounts}
              sliceOffset={waveSliceOffset}
              translateX={translateX}
              candleW={candleW}
              layoutDV={layoutDV}
              chartTop={CHART_TOP}
              chartDrawH={CHART_DRAW_H}
              chartAreaW={CHART_AREA_W}
              font={font}
            />
          )}

          {/* ── Elliott Wave overlay layer (with invalidation line E5) ── */}
          {overlays.elliottWaveLabels && waveCounts.length > 0 && (
            <WaveOverlayLayer
              waveCounts={waveCounts}
              sliceOffset={waveSliceOffset}
              translateX={translateX}
              candleW={candleW}
              layoutDV={layoutDV}
              chartTop={CHART_TOP}
              chartDrawH={CHART_DRAW_H}
              chartAreaW={CHART_AREA_W}
              activeStopPrice={activeStopPrice}
              font={font}
            />
          )}

          {/* ── Crosshair layer ── */}
          <Group opacity={crosshairOpacity}>
            {/* Vertical line */}
            <Path
              path={crosshairVLinePath}
              color={CHART_COLORS.crosshair}
              style="stroke"
              strokeWidth={1}
            />
            {/* Horizontal line */}
            <Path
              path={crosshairHLinePath}
              color={CHART_COLORS.crosshair}
              style="stroke"
              strokeWidth={1}
            />
            {/* Price label */}
            {font !== null && (
              <SkiaText
                x={CHART_AREA_W + 4}
                y={crosshairPriceY}
                text={crosshairPriceText}
                font={font}
                color={CHART_COLORS.crosshairText}
              />
            )}
          </Group>
        </Canvas>
      </GestureDetector>

      {/* ── OHLCV HUD (React Native view overlay — not Skia) ── */}
      {hudData !== null && (
        <View
          pointerEvents="none"
          style={[styles.hud, hudData.xRight ? styles.hudLeft : styles.hudRight]}
        >
          <Text style={[styles.hudClose, { color: hudData.pctChange >= 0 ? CHART_COLORS.bullBody : CHART_COLORS.bearBody }]}>
            ${hudData.close.toFixed(2)}
          </Text>
          <View style={styles.hudRow}>
            <Text style={styles.hudLbl}>O </Text><Text style={styles.hudVal}>${hudData.open.toFixed(2)}</Text>
            <Text style={styles.hudLbl}>  H </Text><Text style={styles.hudVal}>${hudData.high.toFixed(2)}</Text>
          </View>
          <View style={styles.hudRow}>
            <Text style={styles.hudLbl}>L </Text><Text style={styles.hudVal}>${hudData.low.toFixed(2)}</Text>
            <Text style={styles.hudLbl}>  C </Text><Text style={styles.hudVal}>${hudData.close.toFixed(2)}</Text>
          </View>
          <View style={styles.hudRow}>
            <Text style={styles.hudLbl}>Vol </Text>
            <Text style={styles.hudVal}>{formatVolume(hudData.volume)}</Text>
            <Text style={[styles.hudPct, { color: hudData.pctChange >= 0 ? CHART_COLORS.bullBody : CHART_COLORS.bearBody }]}>
              {'  '}{hudData.pctChange >= 0 ? '+' : ''}{hudData.pctChange.toFixed(2)}%
            </Text>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    backgroundColor: CHART_COLORS.background,
  },
  canvas: {
    backgroundColor: CHART_COLORS.background,
  },

  // OHLCV HUD
  hud: {
    position:        'absolute',
    top:             28,   // CHART_LAYOUT.paddingTop + 16
    backgroundColor: 'rgba(14, 17, 23, 0.90)',
    borderRadius:    6,
    borderWidth:     1,
    borderColor:     CHART_COLORS.gridLine,
    padding:         7,
    minWidth:        112,
  },
  hudLeft: {
    left: 6,
  },
  hudRight: {
    right: 66,   // CHART_LAYOUT.priceAxisWidth + 4
  },
  hudClose: {
    fontSize:    15,
    fontWeight:  '700',
    marginBottom: 3,
  },
  hudRow: {
    flexDirection: 'row',
    alignItems:    'center',
    marginTop:     1,
  },
  hudLbl: {
    color:      CHART_COLORS.textMuted,
    fontSize:   10,
    fontWeight: '600',
  },
  hudVal: {
    color:    CHART_COLORS.textPrimary,
    fontSize: 10,
  },
  hudPct: {
    fontSize:  10,
    fontWeight: '600',
  },
});
