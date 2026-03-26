/**
 * app/internals.tsx — Market Internals Dashboard
 *
 * Shows: NYSE TICK, TRIN, A/D Line, New Highs vs New Lows,
 *        SPX Up/Down Volume Ratio, McClellan Oscillator,
 *        % above 20/50/200 MA.
 *
 * Flags internal divergence when price makes new high but breadth declines.
 */

import React, { useMemo } from 'react';
import {
  View, Text, ScrollView, StyleSheet, Pressable, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Canvas, Path, Skia } from '@shopify/react-native-skia';
import { useMarketInternals }  from '../hooks/useMarketInternals';
import { useInternalsStore }   from '../stores/internals';
import { DARK }                from '../theme/colors';

const TICK_CHART_W = 300;
const TICK_CHART_H = 60;

// ── Gauge meter ───────────────────────────────────────────────────────────────

function GaugeMeter({ value, min, max, label, redAbove, greenAbove }:
  { value: number; min: number; max: number; label: string; redAbove?: number; greenAbove?: number }) {
  const clamp  = Math.max(min, Math.min(max, value));
  const frac   = (clamp - min) / (max - min);
  const color  = redAbove !== undefined && value > redAbove
    ? DARK.bearish
    : greenAbove !== undefined && value > greenAbove
    ? DARK.bullish
    : DARK.neutral;

  return (
    <View style={gaugeStyles.container}>
      <Text style={gaugeStyles.label}>{label}</Text>
      <View style={gaugeStyles.track}>
        <View style={[gaugeStyles.fill, { width: `${frac * 100}%`, backgroundColor: color }]} />
      </View>
      <Text style={[gaugeStyles.value, { color }]}>{value}</Text>
    </View>
  );
}

const gaugeStyles = StyleSheet.create({
  container: { marginBottom: 10 },
  label:     { color: DARK.textMuted, fontSize: 10, marginBottom: 3 },
  track:     { height: 6, backgroundColor: DARK.border, borderRadius: 3, overflow: 'hidden' },
  fill:      { height: 6, borderRadius: 3 },
  value:     { color: DARK.textPrimary, fontSize: 14, fontWeight: '700', marginTop: 2 },
});

// ── TICK sparkline ─────────────────────────────────────────────────────────────

function TickSparkline({ history }: { history: Array<{ timestamp: number; value: number }> }) {
  const path = useMemo(() => {
    if (history.length < 2) return null;
    const vals  = history.map((h) => h.value);
    const maxV  = Math.max(...vals, 1000);
    const minV  = Math.min(...vals, -1000);
    const range = maxV - minV || 1;
    const stepX = TICK_CHART_W / (history.length - 1);

    const p = Skia.Path.Make();
    history.forEach((h, i) => {
      const x = i * stepX;
      const y = TICK_CHART_H * (1 - (h.value - minV) / range);
      if (i === 0) p.moveTo(x, y);
      else p.lineTo(x, y);
    });
    return p;
  }, [history]);

  const zeroLine = useMemo(() => {
    if (history.length < 2) return null;
    const vals  = history.map((h) => h.value);
    const maxV  = Math.max(...vals, 1000);
    const minV  = Math.min(...vals, -1000);
    const range = maxV - minV || 1;
    const y     = TICK_CHART_H * (1 - (0 - minV) / range);
    const p = Skia.Path.Make();
    p.moveTo(0, y);
    p.lineTo(TICK_CHART_W, y);
    return p;
  }, [history]);

  return (
    <Canvas style={{ width: TICK_CHART_W, height: TICK_CHART_H }}>
      {zeroLine && <Path path={zeroLine} color={DARK.separator} style="stroke" strokeWidth={0.5} />}
      {path     && <Path path={path}     color="#60a5fa"        style="stroke" strokeWidth={1.5} />}
    </Canvas>
  );
}

// ── Stat card ─────────────────────────────────────────────────────────────────

function StatCard({ label, value, sub, color }: {
  label: string; value: string; sub?: string; color?: string;
}) {
  return (
    <View style={cardStyles.card}>
      <Text style={cardStyles.label}>{label}</Text>
      <Text style={[cardStyles.value, color ? { color } : {}]}>{value}</Text>
      {sub && <Text style={cardStyles.sub}>{sub}</Text>}
    </View>
  );
}

const cardStyles = StyleSheet.create({
  card:  {
    flex:            1,
    backgroundColor: DARK.surface,
    borderRadius:    8,
    padding:         10,
    borderWidth:     1,
    borderColor:     DARK.border,
    alignItems:      'center',
    minWidth:        80,
  },
  label: { color: DARK.textMuted,    fontSize: 9,  marginBottom: 4, textAlign: 'center' },
  value: { color: DARK.textPrimary,  fontSize: 16, fontWeight: '700' },
  sub:   { color: DARK.textMuted,    fontSize: 9,  marginTop: 2 },
});

// ── Screen ────────────────────────────────────────────────────────────────────

export function InternalsScreen() {
  const { refresh }    = useMarketInternals();
  const snap           = useInternalsStore((s) => s.snapshot);
  const tickHistory    = useInternalsStore((s) => s.tick_history);
  const status         = useInternalsStore((s) => s.status);
  const lastFetch      = useInternalsStore((s) => s.lastFetch);

  const updatedAt = lastFetch > 0
    ? `Updated ${Math.round((Date.now() - lastFetch) / 1000)}s ago`
    : 'Loading…';

  const tickColor = !snap ? DARK.textMuted
    : snap.nyse_tick > 800  ? DARK.bullish
    : snap.nyse_tick < -800 ? DARK.bearish
    : DARK.neutral;

  const trinColor = !snap ? DARK.textMuted
    : snap.trin < 0.7 ? DARK.bullish
    : snap.trin > 1.3 ? DARK.bearish
    : DARK.neutral;

  const adColor = !snap ? DARK.textMuted
    : snap.ad_line > 0 ? DARK.bullish
    : snap.ad_line < 0 ? DARK.bearish
    : DARK.neutral;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <View style={[styles.dot, {
            backgroundColor:
              status === 'live'    ? DARK.bullish
              : status === 'error'  ? DARK.bearish
              : status === 'loading'? DARK.neutral
              : DARK.textMuted,
          }]} />
          <Text style={styles.title}>Market Internals</Text>
        </View>
        <View style={styles.headerRight}>
          <Text style={styles.updatedText}>{updatedAt}</Text>
          <Pressable onPress={() => { void refresh(); }} hitSlop={8}>
            <Text style={styles.refreshText}>↻</Text>
          </Pressable>
        </View>
      </View>

      {/* Loading */}
      {status === 'loading' && !snap && (
        <View style={styles.centered}>
          <ActivityIndicator color={DARK.accent} />
        </View>
      )}

      {snap && (
        <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>

          {/* Divergence flag */}
          {snap.divergence_flag && (
            <View style={styles.divFlag}>
              <Text style={styles.divFlagText}>
                ⚠ BREADTH DIVERGENCE — Price rising but internals weakening
              </Text>
            </View>
          )}

          {/* Top stat grid */}
          <View style={styles.statGrid}>
            <StatCard
              label="NYSE TICK"
              value={snap.nyse_tick > 0 ? `+${snap.nyse_tick}` : String(snap.nyse_tick)}
              sub="Inst. breadth"
              color={tickColor}
            />
            <StatCard
              label="TRIN"
              value={snap.trin.toFixed(2)}
              sub={snap.trin < 1 ? 'Bullish' : 'Bearish'}
              color={trinColor}
            />
            <StatCard
              label="A/D LINE"
              value={snap.ad_line > 0 ? `+${snap.ad_line}` : String(snap.ad_line)}
              sub={`${snap.advance_count}↑ ${snap.decline_count}↓`}
              color={adColor}
            />
          </View>

          {/* TICK chart */}
          {tickHistory.length > 1 && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>NYSE TICK (intraday)</Text>
              <View style={styles.chartBox}>
                <TickSparkline history={tickHistory} />
              </View>
            </View>
          )}

          {/* New Highs / Lows */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>52-Week New Highs vs New Lows</Text>
            <View style={styles.statGrid}>
              <StatCard label="New Highs" value={String(snap.new_highs_52w)} color={DARK.bullish} />
              <StatCard label="New Lows"  value={String(snap.new_lows_52w)}  color={DARK.bearish} />
              <StatCard
                label="H/L Ratio"
                value={snap.new_lows_52w > 0
                  ? (snap.new_highs_52w / snap.new_lows_52w).toFixed(1)
                  : 'n/a'}
                color={snap.new_highs_52w > snap.new_lows_52w ? DARK.bullish : DARK.bearish}
              />
            </View>
          </View>

          {/* Up/Down volume */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Up/Down Volume</Text>
            <View style={styles.statGrid}>
              <StatCard label="Up Vol"   value={`${(snap.up_volume / 1e9).toFixed(2)}B`}   color={DARK.bullish} />
              <StatCard label="Down Vol" value={`${(snap.down_volume / 1e9).toFixed(2)}B`} color={DARK.bearish} />
              <StatCard
                label="Ratio"
                value={snap.up_down_vol_ratio.toFixed(2)}
                color={snap.up_down_vol_ratio >= 1 ? DARK.bullish : DARK.bearish}
              />
            </View>
          </View>

          {/* McClellan */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>McClellan Oscillator</Text>
            <View style={styles.statGrid}>
              <StatCard
                label="McClellan Osc"
                value={snap.mclellan_oscillator > 0
                  ? `+${snap.mclellan_oscillator}`
                  : String(snap.mclellan_oscillator)}
                color={snap.mclellan_oscillator > 0 ? DARK.bullish : DARK.bearish}
              />
              <StatCard
                label="Summation Index"
                value={snap.mclellan_summation > 0
                  ? `+${snap.mclellan_summation}`
                  : String(snap.mclellan_summation)}
                color={snap.mclellan_summation > 0 ? DARK.bullish : DARK.bearish}
              />
            </View>
          </View>

          {/* % above MAs */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>S&P 500 — % Above Moving Average</Text>
            <Text style={styles.maNote}>(Polygon indices endpoint — refreshes daily)</Text>
            <GaugeMeter label="% Above 20 MA" value={snap.pct_above_20ma}
              min={0} max={100} greenAbove={60} redAbove={80} />
            <GaugeMeter label="% Above 50 MA" value={snap.pct_above_50ma}
              min={0} max={100} greenAbove={60} redAbove={80} />
            <GaugeMeter label="% Above 200 MA" value={snap.pct_above_200ma}
              min={0} max={100} greenAbove={60} redAbove={80} />
          </View>

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

  header: {
    flexDirection:     'row',
    alignItems:        'center',
    justifyContent:    'space-between',
    paddingHorizontal: 16,
    paddingVertical:   10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: DARK.separator,
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  headerRight:{ flexDirection: 'row', alignItems: 'center', gap: 8 },
  dot:  { width: 7, height: 7, borderRadius: 3.5 },
  title:{ color: DARK.textPrimary, fontSize: 18, fontWeight: '700' },
  updatedText: { color: DARK.textMuted,    fontSize: 11 },
  refreshText: { color: DARK.accent,       fontSize: 18 },

  divFlag: {
    margin:          12,
    padding:         10,
    backgroundColor: '#78350f30',
    borderRadius:    6,
    borderWidth:     1,
    borderColor:     DARK.neutral,
  },
  divFlagText: { color: DARK.neutral, fontSize: 12, fontWeight: '600' },

  statGrid: {
    flexDirection:     'row',
    gap:               8,
    paddingHorizontal: 12,
    marginBottom:      8,
  },

  section: {
    paddingHorizontal: 12,
    marginBottom:      16,
  },
  sectionTitle: {
    color:        DARK.textSecondary,
    fontSize:     11,
    fontWeight:   '600',
    marginBottom: 8,
  },
  maNote: { color: DARK.textMuted, fontSize: 9, marginBottom: 8 },

  chartBox: {
    backgroundColor: DARK.surface,
    borderRadius:    6,
    borderWidth:     1,
    borderColor:     DARK.border,
    padding:         8,
    overflow:        'hidden',
  },
});
