import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { MilkyWaySetup } from '../../stores/milkyway';
import { DARK } from '../../theme/colors';

interface Props {
  setup:  MilkyWaySetup;
  rank:   number;
  onPress: (setup: MilkyWaySetup) => void;
  showTimeframe?: boolean;
}

export function SetupCard({ setup, rank, onPress, showTimeframe }: Props) {
  const isBullish = setup.direction === 'bullish';
  const confPct   = Math.round(setup.confidence * 100);
  const rankColor = rank <= 3 ? '#f59e0b' : DARK.textMuted;

  return (
    <Pressable
      style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
      onPress={() => onPress(setup)}
    >
      {/* Rank + ticker + company */}
      <View style={styles.header}>
        <Text style={[styles.rank, { color: rankColor }]}>#{rank}</Text>
        <View style={styles.tickerBlock}>
          <Text style={styles.ticker}>{setup.ticker}</Text>
          {setup.companyName ? <Text style={styles.company} numberOfLines={1}>{setup.companyName}</Text> : null}
        </View>
        <View style={styles.badges}>
          {showTimeframe && (
            <View style={styles.tfBadge}>
              <Text style={styles.tfBadgeText}>{setup.timeframe}</Text>
            </View>
          )}
          <View style={[styles.dirBadge, isBullish ? styles.bullBadge : styles.bearBadge]}>
            <Text style={styles.dirBadgeText}>{isBullish ? '▲ BULL' : '▼ BEAR'}</Text>
          </View>
        </View>
      </View>

      {/* Wave position + MTF */}
      <View style={styles.row}>
        <Text style={styles.wavePos}>{setup.wavePosition}</Text>
        {setup.mtfAligned && (
          <Text style={styles.mtfBadge}>MTF ✓</Text>
        )}
        <Text style={styles.rulesBadge}>{setup.rules}</Text>
      </View>

      {/* Confidence bar */}
      <View style={styles.confRow}>
        <View style={styles.confBar}>
          <View style={[styles.confFill, { width: `${confPct}%` as any, backgroundColor: isBullish ? '#22c55e' : '#ef4444' }]} />
        </View>
        <Text style={styles.confLabel}>{confPct}% confidence</Text>
      </View>

      {/* Targets */}
      <View style={styles.targetsRow}>
        <Text style={styles.targetLabel}>T1 <Text style={styles.targetVal}>${setup.t1.toFixed(0)}</Text></Text>
        <Text style={styles.targetLabel}>T2 <Text style={styles.targetVal}>${setup.t2.toFixed(0)}</Text></Text>
        <Text style={styles.targetLabel}>T3 <Text style={styles.targetVal}>${setup.t3.toFixed(0)}</Text></Text>
        <Text style={styles.targetLabel}>Stop <Text style={[styles.targetVal, { color: '#ef4444' }]}>${setup.stop.toFixed(0)}</Text></Text>
        <Text style={styles.targetLabel}>R/R <Text style={styles.targetVal}>{setup.riskReward.toFixed(1)}x</Text></Text>
      </View>

      {/* Fib context */}
      {setup.fibContext ? (
        <Text style={styles.fibCtx}>{setup.fibContext}</Text>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: DARK.surface, borderRadius: 10, padding: 14, marginBottom: 10, borderWidth: StyleSheet.hairlineWidth, borderColor: DARK.border },
  cardPressed: { opacity: 0.75 },
  header: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  rank: { fontSize: 13, fontWeight: '800', marginRight: 10, minWidth: 28 },
  tickerBlock: { flex: 1 },
  ticker: { color: DARK.textPrimary, fontSize: 17, fontWeight: '700' },
  company: { color: DARK.textMuted, fontSize: 11, marginTop: 1 },
  badges: { flexDirection: 'row', gap: 6, alignItems: 'center' },
  tfBadge: { backgroundColor: 'rgba(59,130,246,0.2)', borderRadius: 4, paddingHorizontal: 5, paddingVertical: 2 },
  tfBadgeText: { color: '#60a5fa', fontSize: 9, fontWeight: '700' },
  dirBadge: { borderRadius: 4, paddingHorizontal: 6, paddingVertical: 3 },
  bullBadge: { backgroundColor: 'rgba(34,197,94,0.15)' },
  bearBadge: { backgroundColor: 'rgba(239,68,68,0.15)' },
  dirBadgeText: { fontSize: 9, fontWeight: '800', color: DARK.textPrimary },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  wavePos: { color: DARK.textSecondary, fontSize: 12, fontWeight: '600', flex: 1 },
  mtfBadge: { color: '#22c55e', fontSize: 10, fontWeight: '700', backgroundColor: 'rgba(34,197,94,0.1)', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  rulesBadge: { color: DARK.textMuted, fontSize: 10, fontWeight: '600' },
  confRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  confBar: { flex: 1, height: 4, backgroundColor: DARK.separator, borderRadius: 2, overflow: 'hidden' },
  confFill: { height: 4, borderRadius: 2 },
  confLabel: { color: DARK.textMuted, fontSize: 11, minWidth: 80, textAlign: 'right' },
  targetsRow: { flexDirection: 'row', gap: 10, flexWrap: 'wrap', marginBottom: 6 },
  targetLabel: { color: DARK.textMuted, fontSize: 11 },
  targetVal: { color: DARK.textPrimary, fontWeight: '600' },
  fibCtx: { color: DARK.textMuted, fontSize: 10, fontStyle: 'italic' },
});
