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

import React, { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { SkiaErrorBoundary } from '../common/SkiaErrorBoundary';
import {
  Canvas,
  Path,
  Line,
  Text as SkiaText,
  Group,
  Skia,
  useFont,
  type SkFont,
  type SkPath,
} from '@shopify/react-native-skia';
import {
  useSharedValue,
  useDerivedValue,
  useAnimatedReaction,
  clamp,
  runOnJS,
} from 'react-native-reanimated';
import type { SharedValue } from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import type { OHLCV, WaveCount } from '@elliott-wave-pro/wave-engine';
import type { OverlayConfig } from '../../stores/ui';
import { CHART_COLORS, CHART_LAYOUT } from './chartTypes';
import { WaveOverlayLayer }          from './WaveOverlayLayer';
import { WaveProjectionLayer }       from './WaveProjectionLayer';
import { FibonacciOverlayLayer, FibonacciAxisLabels } from './FibonacciOverlayLayer';
import { GEXOverlayLayer }           from './GEXOverlayLayer';
import { WaveChannelLayer }          from './WaveChannelLayer';
import { SupportResistanceLayer }    from './SupportResistanceLayer';
import { MultiDegreeOverlayLayer }   from './MultiDegreeOverlayLayer';
import { WaveHistoryLayer }          from './WaveHistoryLayer';
import type { WaveHistoryPattern }   from './WaveHistoryLayer';
import type { GEXLevels }            from '../../utils/gexCalculator';
import type { EWMode }               from '../../stores/chartLayers';

// ── Types ────────────────────────────────────────────────────────────────────

/** Fixed canvas height — exported so parent can position dismiss backdrop below it. */
export const CHART_CANVAS_HEIGHT = 404;

/** Imperative handle exposed via forwardRef for external crosshair dismissal. */
export interface CandlestickChartHandle {
  dismiss: () => void;
}

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
  /** Called with true when crosshair becomes visible, false when hidden. */
  onCrosshairActiveChange?: (active: boolean) => void;
  /**
   * Canvas height in logical pixels — should be the measured height of the
   * containing View (passed via onLayout). Falls back to CHART_CANVAS_HEIGHT
   * if omitted, but passing the dynamic value is strongly preferred so the
   * canvas fills its container exactly.
   */
  height?: number;
  /** Called after pan/pinch settles — gives the visible bar range for historical wave recalc. */
  onVisibleWindowChange?: (startIdx: number, endIdx: number) => void;
  /** When true, show "Historical" badge to indicate waves are not from the live edge. */
  isHistorical?: boolean;
  /** EW display mode from the layers panel. */
  ewMode?: EWMode;
  /** HTF wave counts for multi-degree mode — pivot indices already mapped to current TF. */
  htfWaveCounts?: readonly WaveCount[];
  /** Completed historical patterns for wave history mode. */
  historyPatterns?: WaveHistoryPattern[];
  /** When true, show a "Scanning…" overlay (wave history scan in progress). */
  historyScanning?: boolean;
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

// ── Time-axis helpers ─────────────────────────────────────────────────────────

/**
 * Pre-formats one string per candle on the JS thread so the UI-thread worklet
 * never has to do date arithmetic.  Format adapts to the inferred bar spacing:
 *   < 2 h  → "9:35a" / "2:00p"  (ET 12h with am/pm initial)
 *   2–23 h → "Mar 25 2p"
 *   1 D    → "Mar 25"
 *   ≥ 1 W  → "Mar '25"
 */
function formatTimestamps(candles: readonly OHLCV[]): string[] {
  if (candles.length < 2) return candles.map(() => '');
  const avgMs =
    (candles[candles.length - 1].timestamp - candles[0].timestamp) /
    (candles.length - 1);

  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  return candles.map((c) => {
    const d = new Date(c.timestamp);
    if (avgMs < 2 * 3_600_000) {
      // Intraday: use ET (UTC-4 for EDT, the common trading season offset)
      const etH = ((d.getUTCHours() - 4 + 24) % 24);
      const m   = String(d.getUTCMinutes()).padStart(2, '0');
      const h12 = (etH % 12) || 12;
      const ap  = etH < 12 ? 'a' : 'p';
      return `${h12}:${m}${ap}`;
    }
    if (avgMs < 86_400_000) {
      // Multi-hour: show date + hour
      const etH = ((d.getUTCHours() - 4 + 24) % 24);
      const h12 = (etH % 12) || 12;
      const ap  = etH < 12 ? 'a' : 'p';
      return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()} ${h12}${ap}`;
    }
    if (avgMs < 7 * 86_400_000) {
      // Daily: "Mar 25"
      return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
    }
    // Weekly+: "Mar '25"
    return `${MONTHS[d.getUTCMonth()]} '${String(d.getUTCFullYear()).slice(2)}`;
  });
}

/**
 * Rounds rawStep up to the nearest "nice" bar interval so labels land on
 * round bar counts (every 5 bars, every 10, every 20, etc.).
 */
function pickNiceStep(rawStep: number): number {
  'worklet';
  const steps = [1, 2, 5, 10, 15, 20, 30, 50, 60, 100, 120, 150, 200, 250, 500, 1000, 2000];
  for (let i = 0; i < steps.length; i++) {
    if (steps[i] >= rawStep) return steps[i];
  }
  return steps[steps.length - 1];
}

// ── Main component ────────────────────────────────────────────────────────────

export const CandlestickChart = React.forwardRef<CandlestickChartHandle, CandlestickChartProps>(
function CandlestickChart({
  candles,
  overlays,
  ticker = '',
  waveCounts = [],
  gexLevels = null,
  activeStopPrice = 0,
  externalTranslateX,
  externalCandleW,
  onCrosshairActiveChange,
  height,
  onVisibleWindowChange,
  isHistorical = false,
  ewMode = 'now',
  htfWaveCounts = [],
  historyPatterns = [],
  historyScanning = false,
}: CandlestickChartProps, ref) {
  const { width: screenW } = useWindowDimensions();

  // ── Layout constants (derived from screen size) ────────────────────────────
  // Use dynamic height from parent's onLayout; fall back to fixed constant only
  // when height is not yet measured (< 100 guards against transient 0 values).
  const CANVAS_H        = height && height >= 100 ? height : CHART_CANVAS_HEIGHT;
  const CHART_AREA_W    = screenW - CHART_LAYOUT.priceAxisWidth;
  const VOL_H           = Math.round(CANVAS_H * CHART_LAYOUT.volumeRatio);
  const TIME_AXIS_H     = CHART_LAYOUT.timeAxisHeight;
  const CHART_H         = CANVAS_H - VOL_H - TIME_AXIS_H;
  const CHART_TOP       = CHART_LAYOUT.paddingTop;
  const CHART_DRAW_H    = CHART_H - CHART_LAYOUT.paddingTop;
  const VOL_TOP         = CHART_H;
  const TIME_AXIS_TOP   = CHART_H + VOL_H;

  // Clip rect: prevents candles/overlays from painting over the 62 px price axis
  const chartClipRect = useMemo(
    () => Skia.XYWHRect(0, 0, CHART_AREA_W, CANVAS_H),
    [CHART_AREA_W, CANVAS_H],
  );

  // ── Font (created once on JS thread) ──────────────────────────────────────
  // useFont is the standard Skia/Expo pattern — loads a bundled TTF via Metro
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const font: SkFont | null = useFont(require('../../assets/fonts/Roboto-Regular.ttf'), 10);

  // ── Alt-count toggle state ────────────────────────────────────────────────
  const [showAlt, setShowAlt] = useState(false);

  // ── Crosshair HUD state (JS thread) ──────────────────────────────────────
  const [hudData, setHudData] = useState<HudData | null>(null);

  const updateHudJS = useCallback((idx: number, xRight: boolean) => {
    const c    = candles[idx];
    const prev = idx > 0 ? candles[idx - 1] : null;
    if (!c) { setHudData(null); onCrosshairActiveChange?.(false); return; }
    const prevClose = prev?.close ?? c.open;
    const pctChange = ((c.close - prevClose) / prevClose) * 100;
    setHudData({ open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume, pctChange, xRight });
    onCrosshairActiveChange?.(true);
  }, [candles, onCrosshairActiveChange]);

  const clearHudJS = useCallback(() => {
    setHudData(null);
    onCrosshairActiveChange?.(false);
  }, [onCrosshairActiveChange]);

  // ── Gesture state (SharedValues — UI thread) ───────────────────────────────
  // Always create internal fallbacks (hooks must not be conditional).
  // Use externals when provided so IndicatorPanel stays in sync.
  const _internalCandleW  = useSharedValue<number>(CHART_LAYOUT.candleDefaultW);
  const _internalTranslateX = useSharedValue(0);
  const candleW    = externalCandleW    ?? _internalCandleW;
  const translateX = externalTranslateX ?? _internalTranslateX;
  const crosshairX   = useSharedValue(-1);  // -1 = hidden
  const crosshairVisible = useSharedValue(false);

  // ── Imperative dismiss (exposed via forwardRef) ────────────────────────────
  const dismiss = useCallback(() => {
    crosshairVisible.value = false;
    crosshairX.value = -1;
    setHudData(null);
    onCrosshairActiveChange?.(false);
  }, [crosshairVisible, crosshairX, onCrosshairActiveChange]);

  useImperativeHandle(ref, () => ({ dismiss }), [dismiss]);

  // ── Viewport change debounce (for historical wave recalc) ─────────────────
  const viewportDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleViewportChange = useCallback((start: number, end: number) => {
    if (viewportDebounceRef.current) clearTimeout(viewportDebounceRef.current);
    viewportDebounceRef.current = setTimeout(() => {
      onVisibleWindowChange?.(start, end);
    }, 400);
  }, [onVisibleWindowChange]);

  // ── Data shared with worklets ──────────────────────────────────────────────
  const candlesSV = useSharedValue<readonly OHLCV[]>([]);
  const ema9SV    = useSharedValue<readonly number[]>([]);
  const ema21SV   = useSharedValue<readonly number[]>([]);
  const ema50SV   = useSharedValue<readonly number[]>([]);
  const ema200SV  = useSharedValue<readonly number[]>([]);

  const ema9  = useMemo(() => computeEMA(candles, 9),   [candles]);
  const ema21 = useMemo(() => computeEMA(candles, 21),  [candles]);
  const ema50 = useMemo(() => computeEMA(candles, 50),  [candles]);
  const ema200= useMemo(() => computeEMA(candles, 200), [candles]);

  useEffect(() => { ema9SV.value   = ema9;  }, [ema9,   ema9SV]);
  useEffect(() => { ema21SV.value  = ema21; }, [ema21,  ema21SV]);
  useEffect(() => { ema50SV.value  = ema50; }, [ema50,  ema50SV]);
  useEffect(() => { ema200SV.value = ema200;}, [ema200, ema200SV]);

  // Sync candles to UI thread and initialize translateX so the latest candles
  // appear on the right. translateX >= 0 means it is at the default/reset
  // position set by chart.tsx on ticker change — use that as the signal to
  // (re-)initialise to the rightmost bars.
  useEffect(() => {
    candlesSV.value = candles;
    if (candles.length > 0 && translateX.value >= 0) {
      const totalW = candles.length * candleW.value;
      const initTx = Math.min(0, -(totalW - CHART_AREA_W + CHART_LAYOUT.priceAxisWidth * 0.5));
      translateX.value = initTx;
    }
  }, [candles]);

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

  // ── Time-axis labels ─────────────────────────────────────────────────────
  // Pre-formatted strings (one per candle) — computed on JS thread, stored in
  // a SharedValue so the UI-thread worklet can index into them without allocating.
  const formattedTimestampsSV = useSharedValue<string[]>([]);
  useEffect(() => {
    formattedTimestampsSV.value = formatTimestamps(candles);
  }, [candles, formattedTimestampsSV]);

  // UI-thread: pick ~10 evenly-spaced bar indices and their canvas x positions.
  const MAX_TIME_LABELS = 12;
  const timeLabelsDV = useDerivedValue((): Array<{ x: number; idx: number }> => {
    'worklet';
    const { startIdx, endIdx, tx, cw } = layoutDV.value;
    const visible = endIdx - startIdx;
    if (visible < 2) return [];

    const step = pickNiceStep(visible / 10);
    const firstIdx = Math.ceil((startIdx + 1) / step) * step;
    const labels: Array<{ x: number; idx: number }> = [];

    for (let idx = firstIdx; idx < endIdx && labels.length < MAX_TIME_LABELS; idx += step) {
      const x = tx + idx * cw + cw * 0.5;
      // Only emit labels fully inside the chart area (leave 20 px margin at right)
      if (x >= 4 && x <= CHART_AREA_W - 20) {
        labels.push({ x, idx });
      }
    }
    return labels;
  });

  // Tick-mark path: short vertical lines at each label's x, inside time axis.
  const timeTickPath = useDerivedValue((): SkPath => {
    'worklet';
    const path = Skia.Path.Make();
    const labels = timeLabelsDV.value;
    for (let i = 0; i < labels.length; i++) {
      const x = labels[i].x;
      path.moveTo(x, TIME_AXIS_TOP);
      path.lineTo(x, TIME_AXIS_TOP + 4);
    }
    return path;
  });

  // Bridge UI→JS: run whenever label positions change (during pan/zoom).
  const [timeLabels, setTimeLabels] = useState<Array<{ x: number; text: string }>>([]);
  useAnimatedReaction(
    () => timeLabelsDV.value,
    (labels) => {
      'worklet';
      const strs = formattedTimestampsSV.value;
      if (strs.length === 0) return;
      const result: Array<{ x: number; text: string }> = [];
      for (let i = 0; i < labels.length; i++) {
        const { x, idx } = labels[i];
        result.push({ x, text: strs[idx] ?? '' });
      }
      runOnJS(setTimeLabels)(result);
    },
  );

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
  // translateX is adjusted to keep the focal point (center of pinch) anchored
  // so the chart zooms around where your fingers are, not the left edge.
  const pinchStartCW = useSharedValue<number>(CHART_LAYOUT.candleDefaultW);
  const pinchStartTx = useSharedValue<number>(0);
  const pinchFocalX  = useSharedValue<number>(0);
  const pinchGesture = Gesture.Pinch()
    .onStart((e: { focalX: number }) => {
      'worklet';
      pinchStartCW.value = candleW.value;
      pinchStartTx.value = translateX.value;
      pinchFocalX.value  = e.focalX;
    })
    .onUpdate((e: { scale: number }) => {
      'worklet';
      const newCw = clamp(
        pinchStartCW.value * e.scale,
        CHART_LAYOUT.candleMinW,
        CHART_LAYOUT.candleMaxW,
      );
      // Which bar index was under the focal point at gesture start?
      const focalBar = (pinchFocalX.value - pinchStartTx.value) / pinchStartCW.value;
      // Keep that bar anchored under the focal point after scaling
      const newTx = pinchFocalX.value - focalBar * newCw;
      const { n } = layoutDV.value;
      const minTx = -(n * newCw - CHART_AREA_W * 0.8);
      candleW.value    = newCw;
      translateX.value = clamp(newTx, minTx, 0);
    })
    .onEnd(() => {
      'worklet';
      const { startIdx, endIdx } = layoutDV.value;
      runOnJS(handleViewportChange)(startIdx, endIdx);
    });

  // Pan to scroll — 1 finger only, restarts cleanly after pinch ends
  const panStartTx = useSharedValue(0);
  const panGesture = Gesture.Pan()
    .minPointers(1)
    .maxPointers(1)
    .onStart(() => {
      'worklet';
      panStartTx.value = translateX.value;
    })
    .onUpdate((e) => {
      'worklet';
      const { n, cw } = layoutDV.value;
      const minTx = -(n * cw - CHART_AREA_W * 0.8);
      translateX.value = clamp(panStartTx.value + e.translationX, minTx, 0);
    })
    .onEnd(() => {
      'worklet';
      const { startIdx, endIdx } = layoutDV.value;
      runOnJS(handleViewportChange)(startIdx, endIdx);
    });

  // Tap for crosshair + HUD
  const tapGesture = Gesture.Tap()
    .maxDuration(250)
    .onEnd((e) => {
      'worklet';
      const { startIdx, endIdx, tx, cw } = layoutDV.value;
      const idx    = Math.min(endIdx - 1, Math.max(startIdx, Math.round((e.x - tx) / cw)));
      const xRight = e.x > CHART_AREA_W / 2;
      runOnJS(updateHudJS)(idx, xRight);
      crosshairX.value = e.x;
      crosshairVisible.value = true;
    });

  // Long press dismisses crosshair + HUD (150 ms for quick dismiss)
  const longPressGesture = Gesture.LongPress()
    .minDuration(150)
    .onStart(() => {
      'worklet';
      crosshairVisible.value = false;
      crosshairX.value = -1;
      runOnJS(clearHudJS)();
    });

  // Pan and pinch are true siblings in Simultaneous — this allows a clean
  // transition from 2-finger pinch back to 1-finger pan without getting stuck.
  // Tap / longPress run exclusively so a quick tap doesn't also fire pan.
  const composedGesture = Gesture.Simultaneous(
    panGesture,
    pinchGesture,
    Gesture.Exclusive(tapGesture, longPressGesture),
  );

  // ── Render ────────────────────────────────────────────────────────────────

  // RULE 4: Never render Canvas before font is ready (useFont is async).
  // Prevents createTextInstance crash in Skia's HostConfig on first render.
  // Don't render canvas until both font and a valid measured height are ready.
  if (!font || !height || height < 100) return <View style={[styles.wrapper, { height: height ?? CHART_CANVAS_HEIGHT }]} />;

  return (
    <View style={styles.wrapper}>
      <SkiaErrorBoundary name="CandlestickChart" height={CANVAS_H}>
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

          {/* ── Time-axis separator line ── */}
          <Line
            p1={{ x: 0, y: TIME_AXIS_TOP }}
            p2={{ x: CHART_AREA_W, y: TIME_AXIS_TOP }}
            color={CHART_COLORS.gridLine}
            strokeWidth={0.5}
          />

          {/* ── Time-axis tick marks (updates live during pan/zoom) ── */}
          <Path
            path={timeTickPath}
            color={CHART_COLORS.textMuted}
            style="stroke"
            strokeWidth={0.5}
          />

          {/* ── Time-axis labels (bridged from UI thread via useAnimatedReaction) ── */}
          {font !== null && timeLabels.map((lbl, i) => (
            <SkiaText
              key={i}
              x={lbl.x - 12}
              y={TIME_AXIS_TOP + 14}
              text={lbl.text}
              font={font}
              color={CHART_COLORS.textMuted}
            />
          ))}

          {/* ── Fibonacci axis labels (Y-axis strip, outside clip) ── */}
          {overlays.fibRetracements && waveCounts.length > 0 && (
            <FibonacciAxisLabels
              waveCounts={waveCounts}
              layoutDV={layoutDV}
              chartTop={CHART_TOP}
              chartDrawH={CHART_DRAW_H}
              axisLeft={CHART_AREA_W}
              font={font}
            />
          )}

          {/* ── Chart drawing area — clipped to prevent overlap with price axis ── */}
          <Group clip={chartClipRect}>

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

            {/* ── Fibonacci overlay layer (dashed lines only — labels on Y-axis) ── */}
            {overlays.fibRetracements && waveCounts.length > 0 && (
              <FibonacciOverlayLayer
                waveCounts={waveCounts}
                layoutDV={layoutDV}
                chartTop={CHART_TOP}
                chartDrawH={CHART_DRAW_H}
                chartAreaW={CHART_AREA_W}
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

            {/* ── Support / Resistance zones from wave pivots ── */}
            {overlays.elliottWaveLabels && waveCounts.length > 0 && (
              <SupportResistanceLayer
                waveCounts={waveCounts}
                layoutDV={layoutDV}
                chartTop={CHART_TOP}
                chartDrawH={CHART_DRAW_H}
                chartAreaW={CHART_AREA_W}
                font={font}
              />
            )}

            {/* ── Wave channel lines (E4) — independent toggle from wave labels ── */}
            {overlays.showEWChannel && waveCounts.length > 0 && (
              <WaveChannelLayer
                waveCounts={waveCounts}
                translateX={translateX}
                candleW={candleW}
                layoutDV={layoutDV}
                chartTop={CHART_TOP}
                chartDrawH={CHART_DRAW_H}
                chartAreaW={CHART_AREA_W}
                font={font}
              />
            )}

            {/* ── Elliott Wave overlay layer (per-wave colors, circles, degree notation) ── */}
            {overlays.elliottWaveLabels && waveCounts.length > 0 && (
              <WaveOverlayLayer
                waveCounts={waveCounts}
                translateX={translateX}
                candleW={candleW}
                layoutDV={layoutDV}
                chartTop={CHART_TOP}
                chartDrawH={CHART_DRAW_H}
                chartAreaW={CHART_AREA_W}
                activeStopPrice={overlays.showInvalidation ? activeStopPrice : 0}
                showAlt={showAlt}
                showWaveLabels={overlays.showWaveLabels}
                font={font}
              />
            )}

            {/* ── Multi-Degree HTF overlay ── */}
            {ewMode === 'multi-degree' && htfWaveCounts.length > 0 && (
              <MultiDegreeOverlayLayer
                htfWaveCounts={htfWaveCounts}
                translateX={translateX}
                candleW={candleW}
                layoutDV={layoutDV}
                chartTop={CHART_TOP}
                chartDrawH={CHART_DRAW_H}
                chartAreaW={CHART_AREA_W}
                font={font}
              />
            )}

            {/* ── Wave History overlay ── */}
            {ewMode === 'history' && historyPatterns.length > 0 && (
              <WaveHistoryLayer
                patterns={historyPatterns}
                translateX={translateX}
                candleW={candleW}
                layoutDV={layoutDV}
                chartTop={CHART_TOP}
                chartDrawH={CHART_DRAW_H}
                chartAreaW={CHART_AREA_W}
                font={font}
              />
            )}

          </Group>{/* end chart clip */}

          {/* ── Wave projections layer — OUTSIDE clip so right-axis labels are visible ── */}
          {overlays.elliottWaveLabels && waveCounts.length > 0 && (
            <WaveProjectionLayer
              waveCounts={waveCounts}
              candles={candles}
              translateX={translateX}
              candleW={candleW}
              layoutDV={layoutDV}
              chartTop={CHART_TOP}
              chartDrawH={CHART_DRAW_H}
              chartAreaW={CHART_AREA_W}
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
      </SkiaErrorBoundary>

      {/* ── Confidence badge (Part 5) — top-left overlay ── */}
      {waveCounts.length > 0 && (() => {
        const primary  = waveCounts[0];
        const alt      = waveCounts[1];
        const pProb    = Math.round((primary.posterior?.posterior ?? 0) * 100);
        const aProb    = alt ? Math.round((alt.posterior?.posterior ?? 0) * 100) : 0;
        const pLabel   = primary.currentWave?.label ?? '?';
        const aLabel   = alt?.currentWave?.label ?? '?';
        const pDegree  = primary.currentWave?.degree ?? '';
        return (
          <View pointerEvents="none" style={styles.confidenceBadge}>
            <Text style={styles.confPrimary}>
              {`Primary: Wave ${pLabel}${pDegree ? ` (${pDegree})` : ''} · ${pProb}%`}
            </Text>
            {showAlt && alt && aProb > 0 && (
              <Text style={styles.confAlt}>
                {`Alt: Wave ${aLabel} · ${aProb}%`}
              </Text>
            )}
          </View>
        );
      })()}

      {/* ── Historical badge — bottom-left overlay ── */}
      {isHistorical && (
        <View pointerEvents="none" style={styles.historicalBadge}>
          <Text style={styles.historicalText}>◀ Historical</Text>
        </View>
      )}

      {/* ── Wave History scanning overlay ── */}
      {historyScanning && (
        <View pointerEvents="none" style={styles.scanningOverlay}>
          <Text style={styles.scanningText}>⟳ Scanning wave history…</Text>
        </View>
      )}

      {/* ── Wave History mode badge ── */}
      {ewMode === 'history' && !historyScanning && historyPatterns.length > 0 && (
        <View pointerEvents="none" style={styles.historyBadge}>
          <Text style={styles.historyBadgeText}>Wave history: {historyPatterns.length} patterns</Text>
        </View>
      )}

      {/* ── Show Alt toggle button — top-right overlay ── */}
      {waveCounts.length > 1 && (
        <Pressable
          style={[styles.altToggle, showAlt && styles.altToggleActive]}
          onPress={() => setShowAlt((v) => !v)}
          hitSlop={8}
        >
          <Text style={[styles.altToggleText, showAlt && styles.altToggleTextActive]}>
            {showAlt ? 'Hide Alt' : 'Show Alt'}
          </Text>
        </Pressable>
      )}

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
}); // end React.forwardRef

const styles = StyleSheet.create({
  wrapper: {
    backgroundColor: CHART_COLORS.background,
  },
  canvas: {
    backgroundColor: CHART_COLORS.background,
  },

  // Confidence badge (Part 5)
  confidenceBadge: {
    position:        'absolute',
    top:             14,
    left:            6,
    backgroundColor: 'rgba(0,0,0,0.65)',
    borderRadius:    4,
    borderWidth:     1,
    borderColor:     '#1E2530',
    paddingHorizontal: 6,
    paddingVertical:   3,
  },
  confPrimary: {
    color:    '#C9D1D9',
    fontSize: 9,
    fontWeight: '600',
  },
  confAlt: {
    color:    '#8888a0',
    fontSize: 9,
    marginTop: 1,
  },

  // Show Alt toggle button
  altToggle: {
    position:        'absolute',
    top:             14,
    right:           68,   // clear of the price axis
    backgroundColor: 'rgba(30,37,48,0.90)',
    borderRadius:    4,
    borderWidth:     1,
    borderColor:     '#30363D',
    paddingHorizontal: 7,
    paddingVertical:   3,
  },
  altToggleActive: {
    backgroundColor: 'rgba(29,78,216,0.80)',
    borderColor:     '#3b82f6',
  },
  altToggleText: {
    color:    '#8B949E',
    fontSize: 9,
    fontWeight: '600',
  },
  altToggleTextActive: {
    color: '#FFFFFF',
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

  // Historical mode badge
  historicalBadge: {
    position: 'absolute',
    bottom: 8,
    left: 8,
    backgroundColor: 'rgba(255,215,0,0.15)',
    borderWidth: 1,
    borderColor: 'rgba(255,215,0,0.5)',
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  historicalText: {
    color: '#FFD700',
    fontSize: 10,
    fontFamily: 'System',
  },
  scanningOverlay: {
    position: 'absolute',
    top: 8,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  scanningText: {
    backgroundColor: 'rgba(0,0,0,0.7)',
    color: '#F59E0B',
    fontSize: 10,
    fontWeight: '600',
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 4,
  },
  historyBadge: {
    position: 'absolute',
    bottom: 8,
    right: 70,
    backgroundColor: 'rgba(0,206,209,0.15)',
    borderWidth: 1,
    borderColor: 'rgba(0,206,209,0.4)',
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  historyBadgeText: {
    color: '#00CED1',
    fontSize: 9,
  },
});
