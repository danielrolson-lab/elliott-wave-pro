/**
 * components/earnings/EarningsPlaybook.tsx
 *
 * Pre-trade checklist bottom sheet for upcoming earnings events.
 * Shown automatically when earnings are ≤7 days away for the active ticker.
 *
 * Sections:
 *   1. Countdown card (days/hours until earnings)
 *   2. IV Rank badge + percentile
 *   3. Implied move for nearest weekly expiry (straddle price)
 *   4. Historical earnings moves — last 8 quarters (Skia bar chart)
 *   5. Recommended strategy card (color-coded)
 *   6. IV crush estimate post-earnings
 *   7. Extended wave warning (if at Wave 5 or C)
 */

import React from 'react';
import {
  View, Text, Pressable, StyleSheet, ScrollView, Modal,
} from 'react-native';
import { Canvas, Path, Rect, Skia } from '@shopify/react-native-skia';
import { useEarningsStore } from '../../stores/earnings';
import { useWaveCountStore } from '../../stores/waveCount';
import { DARK } from '../../theme/colors';

const EXTENDED_WAVES = ['5', 'C'];
const DAYS_THRESHOLD = 7;

// ── Helpers ───────────────────────────────────────────────────────────────────

function daysUntil(dateStr: string): number {
  const now    = new Date();
  const target = new Date(dateStr);
  const diffMs = target.getTime() - now.getTime();
  return Math.ceil(diffMs / (1000 * 60 * 60 * 24));
}

function ivRankColor(rank: number): string {
  if (rank < 20)  return DARK.bullish;
  if (rank < 80)  return '#f59e0b';
  return DARK.bearish;
}

function strategyColor(strategy: string): string {
  if (strategy.includes('Iron Condor'))  return '#8b5cf6';
  if (strategy.includes('Straddle'))     return '#f59e0b';
  if (strategy.includes('Strangle'))     return '#3b82f6';
  if (strategy.includes('Spread'))       return DARK.bullish;
  return DARK.textSecondary;
}

// ── Historical bar chart ───────────────────────────────────────────────────────

interface HistBarChartProps {
  moves:  { date: string; move_pct: number; direction: 'up' | 'down' }[];
  width:  number;
  height: number;
}

function HistBarChart({ moves, width, height }: HistBarChartProps) {
  const slice   = moves.slice(-8);
  if (slice.length === 0) return null;
  const maxMove = Math.max(...slice.map((m) => Math.abs(m.move_pct)), 1);
  const barW    = (width - 8) / slice.length - 4;
  const baseline = height / 2;

  const rects = slice.map((m, i) => {
    const x   = i * (barW + 4) + 4;
    const h   = (Math.abs(m.move_pct) / maxMove) * (height / 2 - 8);
    const y   = m.direction === 'up' ? baseline - h : baseline;
    return { x, y, w: barW, h, bull: m.direction === 'up', pct: m.move_pct };
  });

  return (
    <Canvas style={{ width, height }}>
      {/* Zero line */}
      {(() => {
        const p = Skia.Path.Make();
        p.moveTo(0, baseline);
        p.lineTo(width, baseline);
        return <Path path={p} color={DARK.separator} style="stroke" strokeWidth={1} />;
      })()}
      {rects.map((r, i) => (
        <Rect
          key={i}
          x={r.x} y={r.y} width={r.w} height={Math.max(r.h, 2)}
          color={r.bull ? DARK.bullish : DARK.bearish}
        />
      ))}
    </Canvas>
  );
}

// ── Countdown card ────────────────────────────────────────────────────────────

function CountdownCard({ reportDate, reportTime }: { reportDate: string; reportTime: string }) {
  const days  = daysUntil(reportDate);
  const label = days === 0 ? 'Today' : days === 1 ? 'Tomorrow' : `${days} days`;
  const timeLabel =
    reportTime === 'before_open' ? 'Before Open' :
    reportTime === 'after_close' ? 'After Close' : 'During Market';
  return (
    <View style={styles.countdownCard}>
      <Text style={styles.countdownLabel}>EARNINGS IN</Text>
      <Text style={styles.countdownValue}>{label}</Text>
      <Text style={styles.countdownSub}>{reportDate} · {timeLabel}</Text>
    </View>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

interface Props {
  ticker:    string;
  timeframe: string;
  /** controlled — parent decides whether to show */
  visible:   boolean;
  onClose:   () => void;
}

export function EarningsPlaybook({ ticker, timeframe, visible, onClose }: Props) {
  const analysis = useEarningsStore((s) => s.analyses[ticker]);
  const primaryCount = useWaveCountStore(
    (s) => (s.counts[`${ticker}_${timeframe}`] ?? [])[0],
  );

  if (!analysis || !analysis.next_event) return null;

  const days = daysUntil(analysis.next_event.report_date);
  if (days > DAYS_THRESHOLD) return null;

  const { next_event, historical_moves, implied_move_pct, iv_rank, iv_crush_estimate, suggested_strategy: recommended_strategy } = analysis;
  const waveLabel   = primaryCount?.currentWave?.label ?? null;
  const isExtended  = waveLabel !== null && EXTENDED_WAVES.includes(String(waveLabel));

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          {/* Handle */}
          <View style={styles.handle} />

          {/* Title */}
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>{ticker} Earnings Playbook</Text>
            <Pressable onPress={onClose} hitSlop={8}>
              <Text style={styles.closeBtn}>✕</Text>
            </Pressable>
          </View>

          <ScrollView showsVerticalScrollIndicator={false}>
            {/* Countdown */}
            <CountdownCard
              reportDate={next_event.report_date}
              reportTime={next_event.report_time}
            />

            {/* IV Rank + Implied Move */}
            <View style={styles.metricsRow}>
              <View style={styles.metricCard}>
                <Text style={styles.metricLabel}>IV RANK</Text>
                <Text style={[styles.metricValue, { color: ivRankColor(iv_rank ?? 50) }]}>
                  {iv_rank !== null && iv_rank !== undefined ? `${Math.round(iv_rank)}%` : '—'}
                </Text>
              </View>
              <View style={styles.metricCard}>
                <Text style={styles.metricLabel}>IMPLIED MOVE</Text>
                <Text style={[styles.metricValue, { color: '#f59e0b' }]}>
                  ±{implied_move_pct !== null && implied_move_pct !== undefined ? `${implied_move_pct.toFixed(1)}%` : '—'}
                </Text>
              </View>
              <View style={styles.metricCard}>
                <Text style={styles.metricLabel}>IV CRUSH EST.</Text>
                <Text style={[styles.metricValue, { color: DARK.bearish }]}>
                  {iv_crush_estimate !== null && iv_crush_estimate !== undefined ? `-${iv_crush_estimate.toFixed(0)}%` : '—'}
                </Text>
              </View>
            </View>

            {/* Historical moves chart */}
            {historical_moves.length > 0 && (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>HISTORICAL MOVES (Last 8 Quarters)</Text>
                <HistBarChart moves={historical_moves} width={340} height={100} />
                <View style={styles.moveLegend}>
                  {historical_moves.slice(-4).map((m, i) => (
                    <Text key={i} style={[styles.moveLabel, { color: m.direction === 'up' ? DARK.bullish : DARK.bearish }]}>
                      {m.direction === 'up' ? '+' : '-'}{Math.abs(m.move_pct).toFixed(1)}%
                    </Text>
                  ))}
                </View>
              </View>
            )}

            {/* Strategy card */}
            {recommended_strategy && (
              <View style={[styles.strategyCard, { borderColor: strategyColor(recommended_strategy) }]}>
                <Text style={styles.strategyLabel}>RECOMMENDED STRATEGY</Text>
                <Text style={[styles.strategyValue, { color: strategyColor(recommended_strategy) }]}>
                  {recommended_strategy}
                </Text>
                <Text style={styles.strategyNote}>
                  Based on IV rank {iv_rank !== null && iv_rank !== undefined ? Math.round(iv_rank) : '?'}% and wave position
                </Text>
              </View>
            )}

            {/* Extended wave warning */}
            {isExtended && (
              <View style={styles.waveWarning}>
                <Text style={styles.waveWarningTitle}>⚠ Wave Extension Warning</Text>
                <Text style={styles.waveWarningText}>
                  Active wave count shows Wave {waveLabel} — stock may be technically extended.
                  Earnings surprise risk is amplified at terminal wave positions.
                  Consider reducing position size or defensive hedges.
                </Text>
              </View>
            )}

            <View style={{ height: 24 }} />
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

// ── Trigger badge (shown on chart when earnings within 7 days) ─────────────

export function EarningsCountdownBadge({
  ticker,
  onPress,
}: { ticker: string; onPress: () => void }) {
  const analysis = useEarningsStore((s) => s.analyses[ticker]);
  if (!analysis?.next_event) return null;

  const days = daysUntil(analysis.next_event.report_date);
  if (days > DAYS_THRESHOLD || days < 0) return null;

  return (
    <Pressable style={styles.badge} onPress={onPress}>
      <Text style={styles.badgeText}>
        📅 Earnings {days === 0 ? 'Today' : `in ${days}d`} — Tap for Playbook
      </Text>
    </Pressable>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  overlay: {
    flex:            1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent:  'flex-end',
  },
  sheet: {
    backgroundColor: DARK.surface,
    borderTopLeftRadius:  16,
    borderTopRightRadius: 16,
    paddingHorizontal:    16,
    paddingTop:           8,
    maxHeight:            '85%',
  },
  handle: {
    width:           40,
    height:           4,
    borderRadius:    2,
    backgroundColor: DARK.border,
    alignSelf:       'center',
    marginBottom:    12,
  },
  sheetHeader: {
    flexDirection:  'row',
    alignItems:     'center',
    justifyContent: 'space-between',
    marginBottom:   16,
  },
  sheetTitle: {
    color:      DARK.textPrimary,
    fontSize:   17,
    fontWeight: '700',
  },
  closeBtn: {
    color:    DARK.textMuted,
    fontSize: 16,
  },

  countdownCard: {
    backgroundColor: DARK.surfaceRaised,
    borderRadius:    8,
    padding:         14,
    marginBottom:    12,
    alignItems:      'center',
    borderWidth:     1,
    borderColor:     '#f59e0b',
  },
  countdownLabel: {
    color:         DARK.textMuted,
    fontSize:      9,
    fontWeight:    '700',
    letterSpacing: 1.2,
    marginBottom:  4,
  },
  countdownValue: {
    color:      '#f59e0b',
    fontSize:   28,
    fontWeight: '800',
  },
  countdownSub: {
    color:    DARK.textMuted,
    fontSize: 11,
    marginTop: 2,
  },

  metricsRow: {
    flexDirection: 'row',
    gap:           8,
    marginBottom:  12,
  },
  metricCard: {
    flex:            1,
    backgroundColor: DARK.surfaceRaised,
    borderRadius:    6,
    padding:         10,
    alignItems:      'center',
    borderWidth:     1,
    borderColor:     DARK.border,
  },
  metricLabel: {
    color:         DARK.textMuted,
    fontSize:      8,
    fontWeight:    '700',
    letterSpacing: 0.8,
    marginBottom:  4,
  },
  metricValue: {
    fontSize:   18,
    fontWeight: '800',
  },

  section: {
    marginBottom: 12,
  },
  sectionTitle: {
    color:         DARK.textMuted,
    fontSize:      9,
    fontWeight:    '700',
    letterSpacing: 1,
    marginBottom:  8,
  },
  moveLegend: {
    flexDirection:  'row',
    justifyContent: 'space-around',
    marginTop:      4,
  },
  moveLabel: {
    fontSize:   10,
    fontWeight: '600',
  },

  strategyCard: {
    borderRadius: 8,
    borderWidth:  1,
    padding:      12,
    marginBottom: 12,
  },
  strategyLabel: {
    color:         DARK.textMuted,
    fontSize:      9,
    fontWeight:    '700',
    letterSpacing: 1,
    marginBottom:  4,
  },
  strategyValue: {
    fontSize:     16,
    fontWeight:   '700',
    marginBottom: 4,
  },
  strategyNote: {
    color:    DARK.textMuted,
    fontSize: 11,
  },

  waveWarning: {
    backgroundColor: 'rgba(239,68,68,0.1)',
    borderRadius:    6,
    borderWidth:     1,
    borderColor:     DARK.bearish,
    padding:         10,
    marginBottom:    12,
  },
  waveWarningTitle: {
    color:        DARK.bearish,
    fontSize:     12,
    fontWeight:   '700',
    marginBottom: 4,
  },
  waveWarningText: {
    color:      DARK.textSecondary,
    fontSize:   11,
    lineHeight: 16,
  },

  badge: {
    backgroundColor: 'rgba(245,158,11,0.15)',
    borderRadius:    4,
    borderWidth:     1,
    borderColor:     '#f59e0b',
    paddingHorizontal: 10,
    paddingVertical: 5,
    marginHorizontal: 10,
    marginBottom:    4,
  },
  badgeText: {
    color:      '#f59e0b',
    fontSize:   11,
    fontWeight: '600',
  },
});
