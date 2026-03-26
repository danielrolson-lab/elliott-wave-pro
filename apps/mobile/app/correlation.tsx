/**
 * app/correlation.tsx — Correlation Matrix screen
 *
 * Shows rolling 20-day correlation heatmap for all watchlist tickers.
 * Uses Victory Native XL (via victory-native) for heatmap cells since
 * this is a secondary chart (per spec).
 * Falls back to View-based heatmap cells if Victory not available.
 *
 * Flags correlation breakdowns as regime change signals.
 */

import React, { useMemo, useCallback } from 'react';
import {
  View, Text, ScrollView, StyleSheet, Pressable, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useCorrelation }       from '../hooks/useCorrelation';
import { useCorrelationStore }  from '../stores/correlation';
import { detectCorrelationBreakdowns, correlationColor } from '../utils/correlationEngine';
import { DARK }                 from '../theme/colors';

// ── Heatmap cell ──────────────────────────────────────────────────────────────

const CELL_SIZE = 48;

function HeatCell({ r, label }: { r: number; label?: string }) {
  const bg    = correlationColor(r);
  const isNaN_ = Number.isNaN(r);
  const textColor = Math.abs(r) > 0.5 ? '#000' : DARK.textPrimary;

  return (
    <View style={[cellStyles.cell, { backgroundColor: bg }]}>
      {label ? (
        <Text style={[cellStyles.tickerLabel]} numberOfLines={1}>{label}</Text>
      ) : (
        <Text style={[cellStyles.value, { color: isNaN_ ? DARK.textMuted : textColor }]}>
          {isNaN_ ? '—' : r.toFixed(2)}
        </Text>
      )}
    </View>
  );
}

const cellStyles = StyleSheet.create({
  cell: {
    width:           CELL_SIZE,
    height:          CELL_SIZE,
    alignItems:      'center',
    justifyContent:  'center',
    borderWidth:     0.5,
    borderColor:     '#000',
  },
  value:       { fontSize: 9, fontWeight: '700' },
  tickerLabel: { color: DARK.textPrimary, fontSize: 8, fontWeight: '700', textAlign: 'center' },
});

// ── Screen ────────────────────────────────────────────────────────────────────

export function CorrelationScreen() {
  const { compute }    = useCorrelation();
  const matrix         = useCorrelationStore((s) => s.current);
  const prior          = useCorrelationStore((s) => s.prior);
  const status         = useCorrelationStore((s) => s.status);
  const lastComputed   = useCorrelationStore((s) => s.lastComputed);

  const breakdowns = useMemo(() => {
    if (!matrix || !prior) return [];
    return detectCorrelationBreakdowns(matrix, prior, 0.25);
  }, [matrix, prior]);

  const handleRefresh = useCallback(() => { void compute(); }, [compute]);

  const updatedAt = lastComputed > 0
    ? new Date(lastComputed).toLocaleDateString()
    : '—';

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Text style={styles.title}>Correlations</Text>
          <Text style={styles.subtitle}>20-day rolling · {updatedAt}</Text>
        </View>
        <Pressable style={styles.refreshBtn} onPress={handleRefresh}>
          <Text style={styles.refreshText}>↻ Refresh</Text>
        </Pressable>
      </View>

      {status === 'loading' && (
        <View style={styles.centered}>
          <ActivityIndicator color={DARK.accent} />
          <Text style={styles.loadingText}>Computing correlations…</Text>
        </View>
      )}

      {status === 'error' && (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>Add tickers to watchlist and ensure they have price history.</Text>
        </View>
      )}

      {matrix && (
        <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>

          {/* Breakdown alerts */}
          {breakdowns.length > 0 && (
            <View style={styles.breakdownSection}>
              <Text style={styles.breakdownTitle}>
                ⚠ Correlation Breakdowns — Regime Change Signal
              </Text>
              {breakdowns.slice(0, 5).map((bd, i) => (
                <View key={i} style={styles.breakdownRow}>
                  <Text style={styles.breakdownPair}>
                    {bd.tickers[0]} / {bd.tickers[1]}
                  </Text>
                  <Text style={[styles.breakdownDelta, { color: bd.delta < 0 ? DARK.bearish : DARK.bullish }]}>
                    {bd.delta >= 0 ? '+' : ''}{bd.delta} Δ
                  </Text>
                  <Text style={styles.breakdownPrior}>
                    {bd.prior_r.toFixed(2)} → {bd.current_r.toFixed(2)}
                  </Text>
                </View>
              ))}
            </View>
          )}

          {/* Legend */}
          <View style={styles.legend}>
            <View style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: 'rgb(0, 255, 0)' }]} />
              <Text style={styles.legendText}>Strong positive</Text>
            </View>
            <View style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: 'rgb(255, 0, 0)' }]} />
              <Text style={styles.legendText}>Strong negative</Text>
            </View>
            <View style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: '#1e293b' }]} />
              <Text style={styles.legendText}>No data</Text>
            </View>
          </View>

          {/* Heatmap */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View style={styles.heatmap}>
              {/* Header row */}
              <View style={styles.heatRow}>
                <View style={[cellStyles.cell, styles.cornerCell]} />
                {matrix.tickers.map((t) => (
                  <HeatCell key={t} r={NaN} label={t} />
                ))}
              </View>

              {/* Data rows */}
              {matrix.matrix.map((row, i) => (
                <View key={i} style={styles.heatRow}>
                  <HeatCell r={NaN} label={matrix.tickers[i]} />
                  {row.map((r, j) => (
                    <HeatCell key={j} r={r} />
                  ))}
                </View>
              ))}
            </View>
          </ScrollView>

          {/* Top correlated pairs table */}
          <View style={styles.pairsSection}>
            <Text style={styles.pairsTitle}>Most Correlated Pairs</Text>
            {matrix.tickers
              .flatMap((a, i) => matrix.tickers.slice(i + 1).map((b, j) => ({
                a, b,
                r: matrix.matrix[i][i + 1 + j],
              })))
              .filter((p) => !Number.isNaN(p.r))
              .sort((x, y) => Math.abs(y.r) - Math.abs(x.r))
              .slice(0, 8)
              .map(({ a, b, r }, idx) => (
                <View key={idx} style={styles.pairRow}>
                  <Text style={styles.pairLabel}>{a} / {b}</Text>
                  <View style={[styles.pairBar, {
                    width: Math.abs(r) * 120,
                    backgroundColor: r >= 0 ? DARK.bullish : DARK.bearish,
                  }]} />
                  <Text style={[styles.pairR, { color: r >= 0 ? DARK.bullish : DARK.bearish }]}>
                    {r >= 0 ? '+' : ''}{r.toFixed(2)}
                  </Text>
                </View>
              ))}
          </View>

          <View style={{ height: 32 }} />
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe:     { flex: 1, backgroundColor: DARK.background },
  scroll:   { flex: 1 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  loadingText: { color: DARK.textMuted, fontSize: 13 },

  header: {
    flexDirection:     'row',
    alignItems:        'center',
    justifyContent:    'space-between',
    paddingHorizontal: 16,
    paddingVertical:   12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: DARK.separator,
  },
  headerLeft: { gap: 2 },
  title:      { color: DARK.textPrimary, fontSize: 20, fontWeight: '700' },
  subtitle:   { color: DARK.textMuted,   fontSize: 11 },
  refreshBtn: { backgroundColor: DARK.surface, borderRadius: 6, paddingHorizontal: 12, paddingVertical: 6, borderWidth: 1, borderColor: DARK.border },
  refreshText:{ color: DARK.accent, fontSize: 12, fontWeight: '600' },

  errorBox:  { margin: 16, padding: 12, backgroundColor: DARK.surface, borderRadius: 8, borderWidth: 1, borderColor: DARK.border },
  errorText: { color: DARK.textMuted, fontSize: 12, textAlign: 'center' },

  breakdownSection: {
    margin: 12, padding: 10,
    backgroundColor: '#78350f20',
    borderRadius:    8,
    borderWidth:     1,
    borderColor:     DARK.neutral,
  },
  breakdownTitle: { color: DARK.neutral, fontSize: 11, fontWeight: '700', marginBottom: 8 },
  breakdownRow:   { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  breakdownPair:  { color: DARK.textPrimary, fontSize: 12, fontWeight: '700', flex: 1 },
  breakdownDelta: { fontSize: 11, fontWeight: '700', width: 50 },
  breakdownPrior: { color: DARK.textMuted, fontSize: 10 },

  legend: {
    flexDirection:     'row',
    gap:               16,
    paddingHorizontal: 12,
    paddingVertical:   6,
  },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  legendDot:  { width: 10, height: 10, borderRadius: 5 },
  legendText: { color: DARK.textMuted, fontSize: 10 },

  heatmap:   { paddingLeft: 12, paddingTop: 8 },
  heatRow:   { flexDirection: 'row' },
  cornerCell:{ backgroundColor: 'transparent' },

  pairsSection: {
    paddingHorizontal: 12,
    marginTop:         16,
  },
  pairsTitle: { color: DARK.textSecondary, fontSize: 11, fontWeight: '600', marginBottom: 10 },
  pairRow:    { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 },
  pairLabel:  { color: DARK.textSecondary, fontSize: 12, fontWeight: '600', width: 100 },
  pairBar:    { height: 8, borderRadius: 4, minWidth: 2 },
  pairR:      { fontSize: 13, fontWeight: '700' },
});
