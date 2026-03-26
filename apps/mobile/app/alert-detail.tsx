/**
 * app/alert-detail.tsx — AlertDetailScreen
 *
 * Post-trigger screen showing the full scenario context at the moment
 * an alert fired:
 *   - AI interpretation sentence
 *   - Trigger price, timestamp
 *   - Wave label + probability at time of trigger
 *   - Market regime
 *   - Mini OHLCV sparkline around the trigger bar
 *
 * Navigated to from the Alerts list or from the notification tap.
 */

import React, { useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRoute, type RouteProp } from '@react-navigation/native';
import { Canvas, Path, Skia } from '@shopify/react-native-skia';
import { useAlertDetailStore } from '../stores/alertDetail';
import { useMarketDataStore } from '../stores/marketData';
import { DARK } from '../theme/colors';

type AlertDetailParams = {
  AlertDetail: { alertId: string };
};

type AlertDetailRouteProp = RouteProp<AlertDetailParams, 'AlertDetail'>;

const CHART_W = 340;
const CHART_H = 120;

// ── Mini sparkline around trigger ─────────────────────────────────────────────

function TriggerSparkline({
  ticker,
  triggerPrice,
  triggeredAt,
}: {
  ticker:       string;
  triggerPrice: number;
  triggeredAt:  number;
}) {
  const candles = useMarketDataStore(
    (s) => s.candles[`${ticker}_5m`] ?? [],
  );

  const path = useMemo(() => {
    if (candles.length < 2) return null;
    // Find the bar nearest the trigger timestamp
    const triggerIdx = candles.findIndex((c) => c.timestamp >= triggeredAt);
    const centerIdx  = triggerIdx >= 0 ? triggerIdx : candles.length - 1;
    const slice      = candles.slice(Math.max(0, centerIdx - 20), centerIdx + 10);
    if (slice.length < 2) return null;

    const closes = slice.map((c) => c.close);
    const minC   = Math.min(...closes, triggerPrice);
    const maxC   = Math.max(...closes, triggerPrice);
    const range  = maxC - minC || 1;
    const xStep  = CHART_W / (slice.length - 1);

    const p = Skia.Path.Make();
    closes.forEach((c, i) => {
      const x = i * xStep;
      const y = CHART_H * (1 - (c - minC) / range);
      if (i === 0) p.moveTo(x, y); else p.lineTo(x, y);
    });

    // Trigger price line
    const trigY = CHART_H * (1 - (triggerPrice - minC) / range);
    const tLine = Skia.Path.Make();
    tLine.moveTo(0, trigY);
    tLine.lineTo(CHART_W, trigY);

    return { pricePath: p, triggerPath: tLine };
  }, [candles, triggerPrice, triggeredAt]);

  if (!path) {
    return (
      <View style={{ width: CHART_W, height: CHART_H, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ color: DARK.textMuted, fontSize: 11 }}>No chart data</Text>
      </View>
    );
  }

  return (
    <Canvas style={{ width: CHART_W, height: CHART_H }}>
      <Path path={path.pricePath}   color={DARK.textSecondary} style="stroke" strokeWidth={1.2} />
      <Path path={path.triggerPath} color='#f59e0b' style="stroke" strokeWidth={1} />
    </Canvas>
  );
}

// ── Screen ────────────────────────────────────────────────────────────────────

export function AlertDetailScreen() {
  const route   = useRoute<AlertDetailRouteProp>();
  const alertId = route.params?.alertId;
  const detail  = useAlertDetailStore(
    (s) => s.details.find((d) => d.alertId === alertId),
  );

  if (!detail) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.empty}>
          <Text style={styles.emptyText}>Alert detail not found.</Text>
        </View>
      </SafeAreaView>
    );
  }

  const triggeredDate = new Date(detail.triggeredAt).toLocaleString();

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content}>
        {/* AI Interpretation */}
        <View style={styles.interpretationCard}>
          <View style={styles.aiTag}>
            <Text style={styles.aiTagText}>AI</Text>
          </View>
          <Text style={styles.interpretationText}>{detail.interpretation}</Text>
        </View>

        {/* Alert metadata */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>TRIGGER CONTEXT</Text>
          <View style={styles.metaGrid}>
            <View style={styles.metaItem}>
              <Text style={styles.metaLabel}>TICKER</Text>
              <Text style={styles.metaValue}>{detail.ticker}</Text>
            </View>
            <View style={styles.metaItem}>
              <Text style={styles.metaLabel}>TRIGGER PRICE</Text>
              <Text style={styles.metaValue}>${detail.triggerPrice.toFixed(2)}</Text>
            </View>
            <View style={styles.metaItem}>
              <Text style={styles.metaLabel}>ACTIVE WAVE</Text>
              <Text style={styles.metaValue}>
                {detail.waveLabel ? `W${detail.waveLabel}` : '—'}
              </Text>
            </View>
            <View style={styles.metaItem}>
              <Text style={styles.metaLabel}>PROBABILITY</Text>
              <Text style={styles.metaValue}>
                {detail.probability !== null && detail.probability !== undefined
                  ? `${Math.round(detail.probability * 100)}%`
                  : '—'}
              </Text>
            </View>
            <View style={styles.metaItem}>
              <Text style={styles.metaLabel}>REGIME</Text>
              <Text style={styles.metaValue}>{detail.regime ?? '—'}</Text>
            </View>
            <View style={styles.metaItem}>
              <Text style={styles.metaLabel}>FIRED AT</Text>
              <Text style={[styles.metaValue, { fontSize: 10 }]}>{triggeredDate}</Text>
            </View>
          </View>
        </View>

        {/* Sparkline */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>PRICE ACTION AROUND TRIGGER</Text>
          <Text style={styles.sectionNote}>Amber line = trigger price level</Text>
          <View style={styles.chartBox}>
            <TriggerSparkline
              ticker={detail.ticker}
              triggerPrice={detail.triggerPrice}
              triggeredAt={detail.triggeredAt}
            />
          </View>
        </View>

        <View style={{ height: 32 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe:    { flex: 1, backgroundColor: DARK.background },
  content: { padding: 16 },
  empty:   { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyText: { color: DARK.textMuted, fontSize: 14 },

  interpretationCard: {
    backgroundColor: 'rgba(124,58,237,0.1)',
    borderRadius:    8,
    borderWidth:     1,
    borderColor:     '#7c3aed',
    padding:         14,
    marginBottom:    20,
    gap:             8,
  },
  aiTag: {
    backgroundColor:   '#7c3aed',
    borderRadius:      3,
    paddingHorizontal: 6,
    paddingVertical:   2,
    alignSelf:         'flex-start',
  },
  aiTagText: {
    color:      '#fff',
    fontSize:   9,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  interpretationText: {
    color:      DARK.textPrimary,
    fontSize:   14,
    lineHeight: 20,
    fontWeight: '500',
  },

  section: {
    marginBottom: 20,
  },
  sectionTitle: {
    color:         DARK.textMuted,
    fontSize:      9,
    fontWeight:    '700',
    letterSpacing: 1.2,
    marginBottom:  8,
  },
  sectionNote: {
    color:        DARK.textMuted,
    fontSize:     10,
    marginBottom: 6,
    fontStyle:    'italic',
  },

  metaGrid: {
    flexDirection: 'row',
    flexWrap:      'wrap',
    gap:           8,
  },
  metaItem: {
    backgroundColor: DARK.surface,
    borderRadius:    6,
    borderWidth:     1,
    borderColor:     DARK.border,
    padding:         10,
    width:           '47%',
  },
  metaLabel: {
    color:         DARK.textMuted,
    fontSize:      8,
    fontWeight:    '700',
    letterSpacing: 0.8,
    marginBottom:  3,
  },
  metaValue: {
    color:      DARK.textPrimary,
    fontSize:   13,
    fontWeight: '700',
  },

  chartBox: {
    backgroundColor: DARK.surface,
    borderRadius:    6,
    borderWidth:     1,
    borderColor:     DARK.border,
    overflow:        'hidden',
    padding:         8,
  },
});
