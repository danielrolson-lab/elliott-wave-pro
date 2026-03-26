/**
 * components/scan/AnalogCard.tsx
 *
 * Horizontally scrollable card showing one historical wave analog:
 *   - Mini Skia candlestick chart (30 candles)
 *   - Entry date, wave label, posterior probability
 *   - Forward returns at 1d / 3d / 5d / 10d / 20d
 *   - Max adverse excursion before 5d target
 */

import React, { useMemo } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Canvas, Path, Skia } from '@shopify/react-native-skia';
import type { WaveScanInstance } from '../../stores/waveScan';
import { DARK } from '../../theme/colors';

const CARD_W  = 220;
const CHART_H = 80;
const CHART_W = CARD_W - 16;

interface Props {
  instance:  WaveScanInstance;
  isSelected: boolean;
  onPress:   () => void;
}

function ReturnCell({ label, value }: { label: string; value: number | null }) {
  const color = value === null ? DARK.textMuted : value >= 0 ? DARK.bullish : DARK.bearish;
  return (
    <View style={styles.returnCell}>
      <Text style={styles.returnLabel}>{label}</Text>
      <Text style={[styles.returnValue, { color }]}>
        {value === null ? '—' : `${value >= 0 ? '+' : ''}${value.toFixed(1)}%`}
      </Text>
    </View>
  );
}

export function AnalogCard({ instance, isSelected, onPress }: Props) {
  const miniPath = useMemo(() => {
    const bars = instance.mini_candles;
    if (bars.length === 0) return null;

    const highs  = bars.map((b) => b.h);
    const lows   = bars.map((b) => b.l);
    const maxH   = Math.max(...highs);
    const minL   = Math.min(...lows);
    const range  = maxH - minL || 1;
    const barW   = CHART_W / bars.length;

    return { bars, maxH, minL, range, barW };
  }, [instance.mini_candles]);

  const r = instance.forward_returns;

  return (
    <Pressable
      style={[styles.card, isSelected && styles.cardSelected]}
      onPress={onPress}
    >
      {/* Mini chart */}
      <View style={styles.chartArea}>
        <Canvas style={{ width: CHART_W, height: CHART_H }}>
          {miniPath && instance.mini_candles.map((bar, i) => {
            const { minL, range, barW } = miniPath;
            const x    = i * barW;
            const yH   = CHART_H * (1 - (bar.h - minL) / range);
            const yL   = CHART_H * (1 - (bar.l - minL) / range);
            const yO   = CHART_H * (1 - (bar.o - minL) / range);
            const yC   = CHART_H * (1 - (bar.c - minL) / range);
            const bull = bar.c >= bar.o;
            const bodyTop    = Math.min(yO, yC);
            const bodyBottom = Math.max(yO, yC);
            const bodyH      = Math.max(bodyBottom - bodyTop, 1);

            const candlePath = Skia.Path.Make();
            candlePath.moveTo(x + barW / 2, yH);
            candlePath.lineTo(x + barW / 2, yL);

            const bodyPath = Skia.Path.Make();
            bodyPath.addRect({ x: x + 0.5, y: bodyTop, width: Math.max(barW - 1, 1), height: bodyH });

            return (
              <React.Fragment key={i}>
                <Path path={candlePath} color={bull ? DARK.bullish : DARK.bearish} style="stroke" strokeWidth={0.7} />
                <Path path={bodyPath}  color={bull ? DARK.bullish : DARK.bearish} style="fill" />
              </React.Fragment>
            );
          })}
        </Canvas>
        {/* Entry marker line */}
        <View style={styles.entryLine} />
      </View>

      {/* Meta row */}
      <View style={styles.metaRow}>
        <Text style={styles.dateText}>{instance.entry_date}</Text>
        <View style={[styles.waveBadge]}>
          <Text style={styles.waveLabel}>W{instance.wave_label}</Text>
        </View>
        <Text style={styles.posteriorText}>{Math.round(instance.posterior * 100)}%</Text>
      </View>

      {/* MAE */}
      <Text style={styles.maeText}>
        MAE {instance.min_drawdown_before_target >= 0 ? '+' : ''}{instance.min_drawdown_before_target.toFixed(1)}%
      </Text>

      {/* Forward returns */}
      <View style={styles.returnsRow}>
        <ReturnCell label="1d"  value={r['1d']}  />
        <ReturnCell label="3d"  value={r['3d']}  />
        <ReturnCell label="5d"  value={r['5d']}  />
        <ReturnCell label="10d" value={r['10d']} />
        <ReturnCell label="20d" value={r['20d']} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    width:           CARD_W,
    backgroundColor: DARK.surface,
    borderRadius:    8,
    borderWidth:     1,
    borderColor:     DARK.border,
    padding:         8,
    marginRight:     10,
  },
  cardSelected: {
    borderColor: '#1d6fe8',
  },
  chartArea: {
    position: 'relative',
    height:   CHART_H,
    width:    CHART_W,
    marginBottom: 6,
  },
  entryLine: {
    position:        'absolute',
    right:           0,
    top:             0,
    bottom:          0,
    width:           1.5,
    backgroundColor: '#f59e0b',
    opacity:         0.7,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           6,
    marginBottom:  3,
  },
  dateText: {
    color:    DARK.textMuted,
    fontSize: 10,
    flex:     1,
  },
  waveBadge: {
    backgroundColor: '#1d4ed820',
    borderRadius:    3,
    paddingHorizontal: 5,
    paddingVertical:   1,
  },
  waveLabel: {
    color:      '#60a5fa',
    fontSize:   10,
    fontWeight: '700',
  },
  posteriorText: {
    color:      DARK.textSecondary,
    fontSize:   10,
    fontWeight: '600',
  },
  maeText: {
    color:        DARK.bearish,
    fontSize:     9,
    marginBottom: 5,
  },
  returnsRow: {
    flexDirection: 'row',
    gap:           4,
  },
  returnCell: {
    flex:      1,
    alignItems: 'center',
  },
  returnLabel: {
    color:    DARK.textMuted,
    fontSize: 8,
  },
  returnValue: {
    fontSize:   9,
    fontWeight: '600',
  },
});
