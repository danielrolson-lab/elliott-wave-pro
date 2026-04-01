/**
 * MultiDegreeOverlayLayer.tsx
 *
 * Renders higher-timeframe (HTF) wave counts on the chart canvas at large gold labels,
 * alongside the current-TF sub-degree count. HTF pivot timestamps are pre-mapped
 * to current-TF bar indices by the parent (chart.tsx) before passing here.
 *
 * Usage: rendered inside the Skia <Canvas> when ewMode === 'multi-degree'.
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

// ── Colors ────────────────────────────────────────────────────────────────────

const HTF_LABEL_COLOR  = '#FFD700';   // gold — primary degree
const HTF_LINE_COLOR   = 'rgba(255,215,0,0.60)';
const HTF_CIRCLE_R     = 7;

// ── Serialised form ───────────────────────────────────────────────────────────

interface PivotPt { barIndex: number; price: number; }
interface SerHTF {
  pivots:   PivotPt[];
  labels:   string[];
}
const NULL_HTF: SerHTF = { pivots: [], labels: [] };

const IMPULSE_ROMAN: Record<string, string> = {
  '1': '(I)', '2': '(II)', '3': '(III)', '4': '(IV)', '5': '(V)',
};
const CORRECTIVE_ROMAN: Record<string, string> = {
  'A': '(A)', 'B': '(B)', 'C': '(C)',
};

function serializeHTF(count: WaveCount): SerHTF {
  const waves = count.allWaves;
  if (!waves?.length || !waves[0].startPivot || !waves[0].endPivot) return NULL_HTF;

  const pivots: PivotPt[] = [
    { barIndex: waves[0].startPivot.index, price: waves[0].startPivot.price },
  ];
  for (const w of waves) {
    if (!w.endPivot) break;
    pivots.push({ barIndex: w.endPivot.index, price: w.endPivot.price });
  }
  if (pivots.length < 2) return NULL_HTF;

  const isCorrective = waves[0].structure === 'zigzag' || waves[0].structure === 'flat';
  const labelMap = isCorrective ? CORRECTIVE_ROMAN : IMPULSE_ROMAN;
  const labels = waves.map((w) => labelMap[w.label as string] ?? `(${w.label})`);

  return { pivots, labels };
}

// ── Props ─────────────────────────────────────────────────────────────────────

export interface MultiDegreeOverlayLayerProps {
  htfWaveCounts: readonly WaveCount[];
  translateX:    SharedValue<number>;
  candleW:       SharedValue<number>;
  layoutDV:      SharedValue<ChartLayoutParams>;
  chartTop:      number;
  chartDrawH:    number;
  chartAreaW:    number;
  font:          SkFont | null;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function MultiDegreeOverlayLayer({
  htfWaveCounts,
  translateX,
  candleW,
  layoutDV,
  chartTop,
  chartDrawH,
  chartAreaW,
  font,
}: MultiDegreeOverlayLayerProps) {
  const htfSV = useSharedValue<SerHTF>(NULL_HTF);

  useEffect(() => {
    htfSV.value = htfWaveCounts[0] ? serializeHTF(htfWaveCounts[0]) : NULL_HTF;
  }, [htfWaveCounts, htfSV]);

  // Build line path (gold, solid)
  const linePath = useDerivedValue((): SkPath => {
    'worklet';
    const { pivots } = htfSV.value;
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

  // Circle positions
  const circles = useDerivedValue(() => {
    'worklet';
    const { pivots } = htfSV.value;
    const lay = layoutDV.value;
    const { minP, maxP } = lay;
    const range = maxP - minP;
    if (range < 1e-9) return [] as { x: number; y: number }[];

    return pivots.map((p) => ({
      x: translateX.value + p.barIndex * candleW.value + candleW.value * 0.5,
      y: chartTop + ((maxP - p.price) / range) * chartDrawH,
    }));
  });

  // Circle stroke path
  const circlePath = useDerivedValue((): SkPath => {
    'worklet';
    const pts = circles.value;
    const path = Skia.Path.Make();
    for (const pt of pts) {
      path.addCircle(pt.x, pt.y, HTF_CIRCLE_R);
    }
    return path;
  });

  // Labels — one Text per pivot (excluding first — that's the wave origin, not a numbered pivot)
  const LabelItems = useDerivedValue(() => {
    'worklet';
    const { pivots, labels } = htfSV.value;
    const lay = layoutDV.value;
    const { minP, maxP } = lay;
    const range = maxP - minP;
    if (range < 1e-9 || !labels.length) return [] as { x: number; y: number; label: string }[];

    // Skip first pivot (origin), label from index 1
    return labels.map((lbl, i) => {
      const p = pivots[i + 1];
      if (!p) return { x: 0, y: 0, label: '' };
      const x = translateX.value + p.barIndex * candleW.value + candleW.value * 0.5;
      const yPrice = chartTop + ((maxP - p.price) / range) * chartDrawH;
      const isHigh = i % 2 === 0;   // even segments go up in bullish impulse
      const y = isHigh ? yPrice - 18 : yPrice + 14;
      return { x: x - 10, y, label: lbl };
    }).filter((item) => item.label.length > 0 && item.x > 0 && item.x < chartAreaW);
  });

  if (!font) return null;

  return (
    <Group>
      {/* Connection line */}
      <Path path={linePath} color={HTF_LINE_COLOR} style="stroke" strokeWidth={2} />
      {/* Circles (filled gold, small) */}
      <Path path={circlePath} color={HTF_LABEL_COLOR} style="fill" />
      {/* Labels */}
      {LabelItems.value.map((item) => (
        <Text
          key={item.label + item.x}
          x={item.x}
          y={item.y}
          text={item.label}
          font={font}
          color={HTF_LABEL_COLOR}
        />
      ))}
    </Group>
  );
}
