/**
 * IVSurface.tsx
 *
 * Two-panel volatility surface display:
 *
 *   Panel 1 — IV Term Structure
 *     X axis: days to expiration (DTE)
 *     Y axis: ATM implied volatility (%)
 *     Line color: amber when contango (normal upward slope)
 *                 red   when backwardation (inverted = event risk embedded)
 *     Dots at each expiry data point.
 *
 *   Panel 2 — IV Skew (for selected expiry)
 *     X axis: delta (0.10 → 0.90)
 *     Y axis: implied volatility (%)
 *     Stats footer: 25-delta Risk Reversal and 25-delta Butterfly
 *
 * Both panels built with @shopify/react-native-skia — no Victory Native XL
 * dependency required.  Uses Canvas + Path + Text from Skia.
 */

import React, { useMemo } from 'react';
import { View, Text, StyleSheet, useWindowDimensions } from 'react-native';
import {
  Canvas,
  Path,
  Circle,
  Text as SkText,
  Skia,
  type SkPath,
} from '@shopify/react-native-skia';
import { useOptionsStore } from '../../stores/options';
import type { ExpiryIVPoint, ExpirySkew } from '../../stores/options';
import { DARK } from '../../theme/colors';

// ── Layout ────────────────────────────────────────────────────────────────────

const CHART_H    = 140;
const PAD_L      = 36;   // left padding for Y labels
const PAD_R      = 12;
const PAD_T      = 12;
const PAD_B      = 28;   // bottom padding for X labels
const DRAW_H     = CHART_H - PAD_T - PAD_B;

// ── Colours ───────────────────────────────────────────────────────────────────

const CONTANGO_COLOR      = 'rgba(255,193,7,0.9)';   // amber
const BACKWARDATION_COLOR = 'rgba(239,83,80,0.9)';   // red
const SKEW_COLOR          = 'rgba(100,181,246,0.9)'; // light blue
const AXIS_COLOR          = 'rgba(110,118,129,0.6)';
const LABEL_COLOR         = '#6E7681';

// ── Worklet-compatible path builders ─────────────────────────────────────────

function linePath(
  points: ReadonlyArray<{ x: number; y: number }>,
): SkPath {
  const path = Skia.Path.Make();
  if (points.length === 0) return path;
  path.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) {
    path.lineTo(points[i].x, points[i].y);
  }
  return path;
}

function axisPath(drawW: number): SkPath {
  const path = Skia.Path.Make();
  // X axis (bottom)
  path.moveTo(PAD_L, PAD_T + DRAW_H);
  path.lineTo(PAD_L + drawW, PAD_T + DRAW_H);
  // Y axis (left)
  path.moveTo(PAD_L, PAD_T);
  path.lineTo(PAD_L, PAD_T + DRAW_H);
  return path;
}

// ── Term Structure panel ──────────────────────────────────────────────────────

interface TermChartProps {
  points: ExpiryIVPoint[];
  width:  number;
}

function TermStructureChart({ points, width }: TermChartProps) {
  const drawW = width - PAD_L - PAD_R;

  const { chartPoints, isContango, minIV, maxIV } = useMemo(() => {
    if (points.length < 2) return { chartPoints: [], isContango: true, minIV: 0, maxIV: 1 };

    const minIV   = Math.min(...points.map((p) => p.atmIV)) * 0.95;
    const maxIV   = Math.max(...points.map((p) => p.atmIV)) * 1.05;
    const maxDTE  = Math.max(...points.map((p) => p.dte));
    const ivRange = maxIV - minIV || 0.01;
    const isContango = points[points.length - 1].atmIV >= points[0].atmIV;

    const dteRange = maxDTE || 1;
    const chartPoints = points.map((p) => ({
      x: PAD_L + (p.dte / dteRange) * drawW,
      y: PAD_T + (1 - (p.atmIV - minIV) / ivRange) * DRAW_H,
      dte:   p.dte,
      atmIV: p.atmIV,
    }));

    return { chartPoints, isContango, minIV, maxIV };
  }, [points, drawW]);

  const lineColor = isContango ? CONTANGO_COLOR : BACKWARDATION_COLOR;

  const font = useMemo(() => {
    try { return Skia.Font(undefined, 9); } catch { return null; }
  }, []);

  if (points.length < 2) {
    return (
      <View style={[styles.panel, { height: CHART_H }]}>
        <Text style={styles.panelTitle}>IV Term Structure</Text>
        <View style={styles.noDataWrap}>
          <Text style={styles.noData}>Insufficient data</Text>
        </View>
      </View>
    );
  }

  const axisP   = axisPath(drawW);
  const lineP   = linePath(chartPoints);

  // Y-axis label: show min and max IV
  const yLabels = [
    { y: PAD_T,           text: `${(maxIV * 100).toFixed(0)}%` },
    { y: PAD_T + DRAW_H,  text: `${(minIV * 100).toFixed(0)}%` },
  ];

  // X-axis: first and last DTE
  const xLabels = chartPoints.length > 0 ? [
    { x: chartPoints[0].x,                  text: `${chartPoints[0].dte}d` },
    { x: chartPoints[chartPoints.length - 1].x, text: `${chartPoints[chartPoints.length - 1].dte}d` },
  ] : [];

  return (
    <View style={styles.panel}>
      <View style={styles.panelHeader}>
        <Text style={styles.panelTitle}>IV Term Structure</Text>
        <Text style={[styles.panelBadge, { color: lineColor }]}>
          {isContango ? 'CONTANGO' : 'BACKWARDATION'}
        </Text>
      </View>
      <Canvas style={{ width, height: CHART_H }}>
        {/* Axes */}
        <Path path={axisP} style="stroke" strokeWidth={0.5} color={AXIS_COLOR} />

        {/* IV line */}
        <Path path={lineP} style="stroke" strokeWidth={2} color={lineColor} />

        {/* Data points */}
        {chartPoints.map((p, i) => (
          <Circle key={i} cx={p.x} cy={p.y} r={3} color={lineColor} />
        ))}

        {/* Y labels */}
        {font !== null && yLabels.map((l, i) => (
          <SkText key={`y-${i}`} x={2} y={l.y + 4} text={l.text} font={font} color={LABEL_COLOR} />
        ))}

        {/* X labels */}
        {font !== null && xLabels.map((l, i) => (
          <SkText key={`x-${i}`} x={l.x - 10} y={PAD_T + DRAW_H + 16} text={l.text} font={font} color={LABEL_COLOR} />
        ))}
      </Canvas>
    </View>
  );
}

// ── Skew panel ────────────────────────────────────────────────────────────────

interface SkewChartProps {
  skew:  ExpirySkew | null;
  width: number;
}

function SkewChart({ skew, width }: SkewChartProps) {
  const drawW = width - PAD_L - PAD_R;

  const { chartPoints, minIV, maxIV } = useMemo(() => {
    if (!skew || skew.points.length < 3) {
      return { chartPoints: [], minIV: 0, maxIV: 1 };
    }
    const ivs  = skew.points.map((p) => p.impliedVol);
    const minIV = Math.min(...ivs) * 0.95;
    const maxIV = Math.max(...ivs) * 1.05;
    const ivRange = maxIV - minIV || 0.01;

    // Delta range 0 → 1 mapped to X
    const chartPoints = skew.points.map((p) => ({
      x: PAD_L + p.delta * drawW,
      y: PAD_T + (1 - (p.impliedVol - minIV) / ivRange) * DRAW_H,
      delta:     p.delta,
      impliedVol: p.impliedVol,
    }));

    return { chartPoints, minIV, maxIV };
  }, [skew, drawW]);

  const font = useMemo(() => {
    try { return Skia.Font(undefined, 9); } catch { return null; }
  }, []);

  if (!skew || skew.points.length < 3) {
    return (
      <View style={[styles.panel, { height: CHART_H }]}>
        <Text style={styles.panelTitle}>IV Skew</Text>
        <View style={styles.noDataWrap}>
          <Text style={styles.noData}>Insufficient data</Text>
        </View>
      </View>
    );
  }

  const axisP  = axisPath(drawW);
  const lineP  = linePath(chartPoints);

  const yLabels = [
    { y: PAD_T,          text: `${(maxIV * 100).toFixed(0)}%` },
    { y: PAD_T + DRAW_H, text: `${(minIV * 100).toFixed(0)}%` },
  ];

  const rrColor = skew.riskReversal25d > 0 ? '#EF5350' : '#66BB6A';

  return (
    <View style={styles.panel}>
      <View style={styles.panelHeader}>
        <Text style={styles.panelTitle}>IV Skew — {skew.expiry.slice(5)}</Text>
      </View>
      <Canvas style={{ width, height: CHART_H }}>
        <Path path={axisP} style="stroke" strokeWidth={0.5} color={AXIS_COLOR} />
        <Path path={lineP} style="stroke" strokeWidth={2} color={SKEW_COLOR} />
        {chartPoints.map((p, i) => (
          <Circle key={i} cx={p.x} cy={p.y} r={2.5} color={SKEW_COLOR} />
        ))}
        {font !== null && yLabels.map((l, i) => (
          <SkText key={`y-${i}`} x={2} y={l.y + 4} text={l.text} font={font} color={LABEL_COLOR} />
        ))}
        {font !== null && (
          <>
            <SkText x={PAD_L}           y={PAD_T + DRAW_H + 16} text="0.10" font={font} color={LABEL_COLOR} />
            <SkText x={PAD_L + drawW / 2 - 8} y={PAD_T + DRAW_H + 16} text="0.50 Δ" font={font} color={LABEL_COLOR} />
            <SkText x={PAD_L + drawW - 16} y={PAD_T + DRAW_H + 16} text="0.90" font={font} color={LABEL_COLOR} />
          </>
        )}
      </Canvas>

      {/* Stats footer */}
      <View style={styles.skewStats}>
        <Text style={styles.skewStatLabel}>25Δ RR</Text>
        <Text style={[styles.skewStatValue, { color: rrColor }]}>
          {skew.riskReversal25d >= 0 ? '+' : ''}{(skew.riskReversal25d * 100).toFixed(2)}%
        </Text>
        <Text style={styles.skewStatSep}>·</Text>
        <Text style={styles.skewStatLabel}>25Δ Fly</Text>
        <Text style={styles.skewStatValue}>
          {skew.butterfly25d >= 0 ? '+' : ''}{(skew.butterfly25d * 100).toFixed(2)}%
        </Text>
      </View>
    </View>
  );
}

// ── Public component ──────────────────────────────────────────────────────────

export interface IVSurfaceProps {
  ticker: string;
}

export function IVSurface({ ticker }: IVSurfaceProps) {
  const { width } = useWindowDimensions();
  const termStructure = useOptionsStore((s) => s.termStructure[ticker] ?? []);
  const skew          = useOptionsStore((s) => s.skew[ticker] ?? null);

  if (termStructure.length === 0 && !skew) {
    return (
      <View style={styles.loading}>
        <Text style={styles.noData}>Loading volatility surface…</Text>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <TermStructureChart points={termStructure} width={width} />
      <SkewChart skew={skew} width={width} />
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: {
    backgroundColor: DARK.background,
  },
  panel: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: DARK.separator,
    paddingBottom: 4,
  },
  panelHeader: {
    flexDirection:  'row',
    alignItems:     'center',
    justifyContent: 'space-between',
    paddingHorizontal: 10,
    paddingTop:       6,
    paddingBottom:    2,
  },
  panelTitle: {
    color:     DARK.textMuted,
    fontSize:  10,
    fontWeight: '700',
    letterSpacing: 1.0,
  },
  panelBadge: {
    fontSize:  9,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  noDataWrap: {
    height:         CHART_H - 30,
    alignItems:     'center',
    justifyContent: 'center',
  },
  noData: {
    color:    DARK.textMuted,
    fontSize: 12,
  },
  loading: {
    padding:        24,
    alignItems:     'center',
  },

  // Skew stats footer
  skewStats: {
    flexDirection:     'row',
    alignItems:        'center',
    gap:               6,
    paddingHorizontal: 10,
    paddingVertical:   4,
  },
  skewStatLabel: {
    color:    DARK.textMuted,
    fontSize: 10,
  },
  skewStatValue: {
    color:    DARK.textPrimary,
    fontSize: 10,
    fontWeight: '600',
  },
  skewStatSep: {
    color:    DARK.separator,
    fontSize: 10,
  },
});
