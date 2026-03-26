/**
 * app/earnings.tsx — Earnings Volatility Tool
 *
 * Shows:
 *   - Next earnings date + countdown
 *   - Implied move vs historical move (with bar chart comparison)
 *   - IV Rank badge
 *   - IV crush estimator
 *   - Suggested options strategy based on IV rank + wave count
 *   - Historical earnings moves table
 */

import React, { useState, useCallback, useEffect } from 'react';
import {
  View, Text, Pressable, ScrollView, StyleSheet, TextInput, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useEarnings }       from '../hooks/useEarnings';
import { useEarningsStore }  from '../stores/earnings';
import { DARK }              from '../theme/colors';

const DEFAULT_TICKER = 'AAPL';

function IVRankBadge({ rank }: { rank: number }) {
  const color = rank > 80 ? DARK.bearish : rank > 20 ? DARK.neutral : DARK.bullish;
  const label = rank > 80 ? 'HIGH' : rank > 20 ? 'MID' : 'LOW';
  return (
    <View style={[ivStyles.badge, { borderColor: color }]}>
      <Text style={[ivStyles.text, { color }]}>IV Rank {rank} — {label}</Text>
    </View>
  );
}

const ivStyles = StyleSheet.create({
  badge: { borderWidth: 1, borderRadius: 4, paddingHorizontal: 8, paddingVertical: 3 },
  text:  { fontSize: 11, fontWeight: '700' },
});

export function EarningsScreen() {
  const [ticker, setTicker] = useState(DEFAULT_TICKER);
  const [input,  setInput]  = useState(DEFAULT_TICKER);

  const { fetch } = useEarnings(ticker);
  const analysis  = useEarningsStore((s) => s.analyses[ticker]);
  const status    = useEarningsStore((s) => s.status[ticker] ?? 'idle');
  const errMsg    = useEarningsStore((s) => s.error[ticker]);

  useEffect(() => { void fetch(); }, [fetch]);

  const handleSearch = useCallback(() => {
    setTicker(input.toUpperCase().trim());
  }, [input]);

  const stratColor =
    analysis?.suggested_strategy.includes('Iron') || analysis?.suggested_strategy.includes('Strangle')
      ? DARK.bearish
      : analysis?.suggested_strategy.includes('Long') || analysis?.suggested_strategy.includes('Bull')
      ? DARK.bullish
      : DARK.neutral;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>Earnings Vol</Text>
      </View>

      {/* Search */}
      <View style={styles.searchRow}>
        <TextInput
          style={styles.input}
          value={input}
          onChangeText={(v) => setInput(v.toUpperCase())}
          autoCapitalize="characters"
          placeholder="Ticker"
          placeholderTextColor={DARK.textMuted}
          onSubmitEditing={handleSearch}
          returnKeyType="search"
        />
        <Pressable style={styles.searchBtn} onPress={handleSearch}>
          <Text style={styles.searchBtnText}>Search</Text>
        </Pressable>
      </View>

      {status === 'loading' && (
        <View style={styles.centered}>
          <ActivityIndicator color={DARK.accent} />
        </View>
      )}

      {status === 'error' && (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>{errMsg ?? 'Failed to load earnings data'}</Text>
        </View>
      )}

      {analysis && (
        <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>

          {/* Countdown */}
          <View style={styles.countdownCard}>
            <Text style={styles.countdownLabel}>NEXT EARNINGS</Text>
            <Text style={styles.countdownDate}>
              {analysis.next_event?.report_date ?? 'Unknown date'}
            </Text>
            {analysis.days_to_earnings !== null && (
              <Text style={styles.countdownDays}>
                {analysis.days_to_earnings === 0 ? 'TODAY' : `${analysis.days_to_earnings}d away`}
              </Text>
            )}
            <Text style={styles.reportTime}>
              {analysis.next_event?.report_time?.replace(/_/g, ' ') ?? ''}
            </Text>
          </View>

          {/* IV Rank */}
          <View style={styles.section}>
            <IVRankBadge rank={analysis.iv_rank} />
          </View>

          {/* Implied vs Historical move */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Implied vs Historical Move</Text>
            <View style={styles.moveComparison}>
              {/* Implied */}
              <View style={styles.moveBox}>
                <Text style={styles.moveLabel}>Implied</Text>
                <Text style={[styles.moveValue, { color: '#60a5fa' }]}>
                  {analysis.implied_move_pct !== null ? `±${analysis.implied_move_pct}%` : '—'}
                </Text>
                {analysis.implied_move_pct !== null && (
                  <View style={[styles.moveBar, { width: Math.min(analysis.implied_move_pct * 3, 120), backgroundColor: '#3b82f6' }]} />
                )}
              </View>

              {/* Historical avg */}
              <View style={styles.moveBox}>
                <Text style={styles.moveLabel}>Historical Avg</Text>
                <Text style={[styles.moveValue, { color: DARK.neutral }]}>
                  ±{analysis.avg_historical_move}%
                </Text>
                <View style={[styles.moveBar, { width: Math.min(analysis.avg_historical_move * 3, 120), backgroundColor: DARK.neutral }]} />
              </View>
            </View>

            {analysis.implied_vs_hist_ratio !== null && (
              <Text style={[styles.ratioText, {
                color: analysis.implied_vs_hist_ratio > 1.2 ? DARK.bearish : DARK.bullish,
              }]}>
                Implied is {analysis.implied_vs_hist_ratio > 1
                  ? `${Math.round((analysis.implied_vs_hist_ratio - 1) * 100)}% ABOVE historical — vol is EXPENSIVE`
                  : `${Math.round((1 - analysis.implied_vs_hist_ratio) * 100)}% BELOW historical — vol is CHEAP`}
              </Text>
            )}
          </View>

          {/* IV Crush */}
          {analysis.iv_crush_estimate !== null && (
            <View style={styles.crushCard}>
              <Text style={styles.crushLabel}>ESTIMATED IV CRUSH POST-EARNINGS</Text>
              <Text style={styles.crushValue}>
                −{analysis.iv_crush_estimate} vol pts
              </Text>
              <Text style={styles.crushNote}>
                Based on average post-earnings IV compression from prior {analysis.historical_moves.length} events.
              </Text>
            </View>
          )}

          {/* Strategy suggestion */}
          <View style={[styles.strategyCard, { borderColor: stratColor }]}>
            <Text style={styles.strategyTitle}>Suggested Strategy</Text>
            <Text style={[styles.strategyName, { color: stratColor }]}>
              {analysis.suggested_strategy}
            </Text>
            <Text style={styles.strategyRationale}>
              {analysis.strategy_rationale}
            </Text>
          </View>

          {/* Historical moves table */}
          {analysis.historical_moves.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Historical Earnings Moves</Text>
              {analysis.historical_moves.slice(0, 8).map((move, i) => (
                <View key={i} style={styles.moveRow}>
                  <Text style={styles.moveDate}>{move.date}</Text>
                  <View style={[styles.moveDot, { backgroundColor: move.direction === 'up' ? DARK.bullish : DARK.bearish }]} />
                  <Text style={[styles.movePct, { color: move.direction === 'up' ? DARK.bullish : DARK.bearish }]}>
                    {move.direction === 'up' ? '+' : '−'}{move.move_pct.toFixed(1)}%
                  </Text>
                  <Text style={styles.moveAfter}>{move.price_after.toFixed(2)}</Text>
                </View>
              ))}
            </View>
          )}

          <View style={{ height: 32 }} />
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe:    { flex: 1, backgroundColor: DARK.background },
  scroll:  { flex: 1 },
  centered:{ flex: 1, alignItems: 'center', justifyContent: 'center' },

  header:  { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8 },
  title:   { color: DARK.textPrimary, fontSize: 20, fontWeight: '700' },

  searchRow: {
    flexDirection:     'row',
    paddingHorizontal: 12,
    paddingBottom:     8,
    gap:               8,
  },
  input: {
    flex:              1,
    backgroundColor:   DARK.surface,
    borderColor:       DARK.border,
    borderWidth:       1,
    borderRadius:      6,
    color:             DARK.textPrimary,
    paddingHorizontal: 10,
    paddingVertical:   8,
    fontSize:          14,
    fontWeight:        '700',
  },
  searchBtn:     { backgroundColor: DARK.accent, borderRadius: 6, paddingHorizontal: 16, justifyContent: 'center' },
  searchBtnText: { color: '#fff', fontWeight: '700', fontSize: 13 },

  errorBox: {
    margin: 12, padding: 10,
    backgroundColor: '#7f1d1d20',
    borderRadius: 6,
    borderWidth: 1,
    borderColor: DARK.bearish,
  },
  errorText: { color: DARK.bearish, fontSize: 12 },

  countdownCard: {
    margin:          12,
    padding:         16,
    backgroundColor: DARK.surface,
    borderRadius:    8,
    borderWidth:     1,
    borderColor:     DARK.border,
    alignItems:      'center',
  },
  countdownLabel: { color: DARK.textMuted, fontSize: 9, fontWeight: '700', letterSpacing: 1, marginBottom: 6 },
  countdownDate:  { color: DARK.textPrimary, fontSize: 18, fontWeight: '700' },
  countdownDays:  { color: DARK.accent, fontSize: 24, fontWeight: '900', marginVertical: 4 },
  reportTime:     { color: DARK.textMuted, fontSize: 11 },

  section:      { paddingHorizontal: 12, marginBottom: 16 },
  sectionTitle: { color: DARK.textSecondary, fontSize: 11, fontWeight: '600', marginBottom: 8 },

  moveComparison: { flexDirection: 'row', gap: 16, marginBottom: 8 },
  moveBox:        { flex: 1 },
  moveLabel:      { color: DARK.textMuted, fontSize: 10, marginBottom: 4 },
  moveValue:      { fontSize: 20, fontWeight: '900', marginBottom: 4 },
  moveBar:        { height: 6, borderRadius: 3, maxWidth: 120 },
  ratioText:      { fontSize: 11, fontWeight: '600', marginTop: 4 },

  crushCard: {
    marginHorizontal: 12,
    marginBottom:     16,
    padding:          12,
    backgroundColor:  '#1e1b4b20',
    borderRadius:     8,
    borderWidth:      1,
    borderColor:      '#6366f1',
  },
  crushLabel: { color: '#a5b4fc', fontSize: 9, fontWeight: '700', letterSpacing: 1, marginBottom: 6 },
  crushValue: { color: '#818cf8', fontSize: 22, fontWeight: '900', marginBottom: 4 },
  crushNote:  { color: DARK.textMuted, fontSize: 10 },

  strategyCard: {
    marginHorizontal: 12,
    marginBottom:     16,
    padding:          14,
    backgroundColor:  DARK.surface,
    borderRadius:     8,
    borderWidth:      1,
  },
  strategyTitle:    { color: DARK.textMuted, fontSize: 9, fontWeight: '700', letterSpacing: 1, marginBottom: 6 },
  strategyName:     { fontSize: 18, fontWeight: '700', marginBottom: 6 },
  strategyRationale:{ color: DARK.textSecondary, fontSize: 12, lineHeight: 18 },

  moveRow: {
    flexDirection:     'row',
    alignItems:        'center',
    paddingVertical:   7,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: DARK.separator,
    gap:               8,
  },
  moveDate:  { color: DARK.textMuted, fontSize: 11, flex: 1 },
  moveDot:   { width: 6, height: 6, borderRadius: 3 },
  movePct:   { fontSize: 13, fontWeight: '700', flex: 1 },
  moveAfter: { color: DARK.textMuted, fontSize: 11 },
});
