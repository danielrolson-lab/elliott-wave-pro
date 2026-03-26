/**
 * DecayMeter.tsx
 *
 * Overlay displayed on the chart when the active ticker is a known leveraged ETF.
 *
 * Shows:
 *   - "⚠ LEVERAGED ETF" warning header
 *   - Annual drag %  (colour-coded severity gauge)
 *   - Leverage label (e.g. "3×")
 *   - Rollover alert badge (futures-based ETFs only)
 *   - A thin horizontal gauge bar (green → yellow → red)
 *
 * Sits at the bottom of the chart canvas (above IndicatorPanel).
 */

import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import type { OHLCV } from '@elliott-wave-pro/wave-engine';
import {
  getLeveragedSpec,
  computeDecay,
  decaySeverity,
  decayColor,
} from '../../utils/etfDecayEngine';
import { DARK } from '../../theme/colors';

interface DecayMeterProps {
  ticker:  string;
  candles: readonly OHLCV[];
}

export function DecayMeter({ ticker, candles }: DecayMeterProps) {
  const spec = useMemo(() => getLeveragedSpec(ticker), [ticker]);

  const result = useMemo(() => {
    if (!spec || candles.length < 5) return null;
    return computeDecay(spec, candles);
  }, [spec, candles]);

  if (!spec || !result) return null;

  const severity = decaySeverity(result);
  const color    = decayColor(severity);
  const levLabel = result.leverage > 0
    ? `${result.leverage}× Bull`
    : `${Math.abs(result.leverage)}× Bear`;

  return (
    <View style={styles.container}>
      {/* Warning header */}
      <View style={styles.headerRow}>
        <Text style={styles.warning}>⚠ LEVERAGED ETF</Text>
        <Text style={[styles.levLabel, { color }]}>{levLabel}</Text>
        {result.rolloverAlert && (
          <View style={styles.rolloverBadge}>
            <Text style={styles.rolloverText}>FUTURES ROLL</Text>
          </View>
        )}
      </View>

      {/* Drag gauge */}
      <View style={styles.gaugeRow}>
        <Text style={styles.gaugeLabel}>Annual drag</Text>
        <View style={styles.gaugeTrack}>
          <View style={[styles.gaugeFill, { width: `${Math.min(100, severity * 100)}%`, backgroundColor: color }]} />
        </View>
        <Text style={[styles.gaugePct, { color }]}>
          {result.totalDragPct.toFixed(1)}%/yr
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#1a0a00',
    borderTopWidth:  StyleSheet.hairlineWidth,
    borderTopColor:  '#f59e0b',
    paddingHorizontal: 10,
    paddingVertical:    5,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           8,
    marginBottom:  3,
  },
  warning: {
    color:      '#f59e0b',
    fontSize:   10,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  levLabel: {
    fontSize:   10,
    fontWeight: '700',
  },
  rolloverBadge: {
    backgroundColor: '#7c3aed',
    borderRadius:    3,
    paddingHorizontal: 5,
    paddingVertical:   1,
  },
  rolloverText: {
    color:      '#fff',
    fontSize:   8,
    fontWeight: '800',
    letterSpacing: 0.3,
  },

  gaugeRow: {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           8,
  },
  gaugeLabel: {
    color:    DARK.textMuted,
    fontSize: 9,
    width:    60,
  },
  gaugeTrack: {
    flex:            1,
    height:          6,
    backgroundColor: DARK.surface,
    borderRadius:    3,
    overflow:        'hidden',
  },
  gaugeFill: {
    height:       6,
    borderRadius: 3,
  },
  gaugePct: {
    fontSize:  10,
    fontWeight: '700',
    width:      52,
    textAlign: 'right',
  },
});
