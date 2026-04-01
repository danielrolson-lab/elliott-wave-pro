/**
 * WaveHistoryLayer.tsx
 *
 * Renders multiple completed historical wave patterns on the chart canvas,
 * each in a distinct color. Used when ewMode === 'history'.
 *
 * Patterns are pre-computed by chart.tsx using an overlapping window scan,
 * deduplicated, and passed in with a color per pattern.
 */

import React, { useEffect } from 'react';
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
import type { WaveCount } from '@elliott-wave-pro/wave-engine';
import type { ChartLayoutParams } from './chartTypes';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface WaveHistoryPattern {
  id:        string;
  color:     string;
  waveCount: WaveCount;
}

export const HISTORY_COLORS = [
  '#FFD700',  // gold
  '#00CED1',  // teal
  '#FF69B4',  // pink
  '#98FB98',  // pale green
  '#DDA0DD',  // plum
  '#F0E68C',  // khaki
] as const;

// ── Serialised form ───────────────────────────────────────────────────────────

interface PivotPt { barIndex: number; price: number; }
interface SerPattern {
  color:   string;
  pivots:  PivotPt[];
  labels:  string[];
  id:      string;
}

function serializePattern(p: WaveHistoryPattern): SerPattern {
  const waves = p.waveCount.allWaves;
  if (!waves?.length || !waves[0].startPivot || !waves[0].endPivot) {
    return { color: p.color, pivots: [], labels: [], id: p.id };
  }

  const pivots: PivotPt[] = [
    { barIndex: waves[0].startPivot.index, price: waves[0].startPivot.price },
  ];
  for (const w of waves) {
    if (!w.endPivot) break;
    pivots.push({ barIndex: w.endPivot.index, price: w.endPivot.price });
  }

  const labels = waves.map((w) => String(w.label));
  return { color: p.color, pivots, labels, id: p.id };
}

// ── Single pattern renderer ───────────────────────────────────────────────────

function HistoryPatternLayer({
  pattern,
  translateX,
  candleW,
  layoutDV,
  chartTop,
  chartDrawH,
  chartAreaW,
  font,
}: {
  pattern:    SerPattern;
  translateX: SharedValue<number>;
  candleW:    SharedValue<number>;
  layoutDV:   SharedValue<ChartLayoutParams>;
  chartTop:   number;
  chartDrawH: number;
  chartAreaW: number;
  font:       SkFont | null;
}) {
  const patSV = useSharedValue<SerPattern>(pattern);

  useEffect(() => {
    patSV.value = pattern;
  }, [pattern, patSV]);

  const linePath = useDerivedValue((): SkPath => {
    'worklet';
    const { pivots } = patSV.value;
    const lay = layoutDV.value;
    const path = Skia.Path.Make();
    if (!pivots.length) return path;

    const { minP, maxP } = lay;
    const range = maxP - minP;
    if (range < 1e-9) return path;

    for (let i = 0; i < pivots.length; i++) {
      const p = pivots[i];
      const x = translateX.value + p.barIndex * candleW.value + candleW.value * 0.5;
      const y = chartTop + ((maxP - p.price) / range) * chartDrawH;
      if (i === 0) path.moveTo(x, y);
      else path.lineTo(x, y);
    }
    return path;
  });

  const circlePath = useDerivedValue((): SkPath => {
    'worklet';
    const { pivots } = patSV.value;
    const lay = layoutDV.value;
    const { minP, maxP } = lay;
    const range = maxP - minP;
    if (range < 1e-9) return Skia.Path.Make();

    const path = Skia.Path.Make();
    for (const p of pivots) {
      const x = translateX.value + p.barIndex * candleW.value + candleW.value * 0.5;
      const y = chartTop + ((maxP - p.price) / range) * chartDrawH;
      path.addCircle(x, y, 4.5);
    }
    return path;
  });

  const labelItems = useDerivedValue(() => {
    'worklet';
    const { pivots, labels } = patSV.value;
    const lay = layoutDV.value;
    const { minP, maxP } = lay;
    const range = maxP - minP;
    if (range < 1e-9 || !labels.length) return [] as { x: number; y: number; label: string }[];

    return labels.map((lbl, i) => {
      const p = pivots[i + 1];
      if (!p) return { x: 0, y: 0, label: '' };
      const x = translateX.value + p.barIndex * candleW.value + candleW.value * 0.5;
      const yPrice = chartTop + ((maxP - p.price) / range) * chartDrawH;
      const isHigh = i % 2 === 0;
      const y = isHigh ? yPrice - 12 : yPrice + 10;
      return { x: x - 5, y, label: lbl };
    }).filter((item) => item.label.length > 0 && item.x > 0 && item.x < chartAreaW);
  });

  const color = pattern.color;
  const colorAlpha = color + 'B3'; // ~70% opacity

  if (!font) return null;

  return (
    <Group opacity={0.85}>
      <Path path={linePath}   color={colorAlpha} style="stroke" strokeWidth={1} strokeJoin="round" />
      <Path path={circlePath} color={colorAlpha} style="fill" />
      {labelItems.value.map((item) => (
        <Text
          key={`${pattern.id}-${item.label}-${Math.round(item.x)}`}
          x={item.x}
          y={item.y}
          text={item.label}
          font={font}
          color={color}
        />
      ))}
    </Group>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export interface WaveHistoryLayerProps {
  patterns:   WaveHistoryPattern[];
  translateX: SharedValue<number>;
  candleW:    SharedValue<number>;
  layoutDV:   SharedValue<ChartLayoutParams>;
  chartTop:   number;
  chartDrawH: number;
  chartAreaW: number;
  font:       SkFont | null;
}

export function WaveHistoryLayer({
  patterns,
  translateX,
  candleW,
  layoutDV,
  chartTop,
  chartDrawH,
  chartAreaW,
  font,
}: WaveHistoryLayerProps) {
  const serialized = patterns.map(serializePattern);

  return (
    <Group>
      {serialized.map((pat) => (
        <HistoryPatternLayer
          key={pat.id}
          pattern={pat}
          translateX={translateX}
          candleW={candleW}
          layoutDV={layoutDV}
          chartTop={chartTop}
          chartDrawH={chartDrawH}
          chartAreaW={chartAreaW}
          font={font}
        />
      ))}
    </Group>
  );
}
