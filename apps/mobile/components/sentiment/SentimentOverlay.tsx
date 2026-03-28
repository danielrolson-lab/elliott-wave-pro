/**
 * components/sentiment/SentimentOverlay.tsx
 *
 * Social sentiment bar shown below the scenario panel on the chart screen.
 *
 * Color coding:
 *   bullish% > 60% → green
 *   bullish% < 40% → red
 *   otherwise       → amber
 *
 * Divergence flag: price rising but sentiment falling = potential distribution.
 * Wave 5 warning: high bullish sentiment (>65%) when at Wave 5 = contrarian alert.
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useSentimentStore } from '../../stores/sentiment';
import { useWaveCountStore } from '../../stores/waveCount';
import { DARK } from '../../theme/colors';

interface Props {
  ticker:    string;
  timeframe: string;
}

function sentimentColor(bullishPct: number): string {
  if (bullishPct > 0.5) return DARK.bullish;
  if (bullishPct < 0.4) return DARK.bearish;
  return DARK.neutral;
}

export function SentimentOverlay({ ticker, timeframe }: Props) {
  const data       = useSentimentStore((s) => s.data[ticker]);
  const loading    = useSentimentStore((s) => s.loading[ticker] ?? false);
  const divergence = useSentimentStore((s) => s.divergence[ticker] ?? false);

  const primaryCount = useWaveCountStore(
    (s) => (s.counts[`${ticker}_${timeframe}`] ?? [])[0],
  );
  const waveLabel = primaryCount?.currentWave?.label;
  const isWave5   = waveLabel === '5';

  if (loading && !data) {
    return (
      <View style={styles.container}>
        <Text style={styles.label}>SENTIMENT</Text>
        <Text style={styles.muted}>Loading…</Text>
      </View>
    );
  }

  if (!data) return null;

  const { bullishPct, bearishPct, neutralPct, messageCount } = data;
  const color = sentimentColor(bullishPct);
  const updatedMins = Math.floor((Date.now() - data.fetchedAt) / 60000);

  const showWave5Warning = isWave5 && bullishPct > 0.65;

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.label}>STOCKTWITS SENTIMENT</Text>
        <Text style={styles.meta}>{messageCount} msgs · {updatedMins}m ago</Text>
      </View>

      {/* Sentiment bar */}
      <View style={styles.barTrack}>
        <View style={[styles.barSegment, { flex: bullishPct, backgroundColor: DARK.bullish }]} />
        <View style={[styles.barSegment, { flex: neutralPct, backgroundColor: DARK.textMuted }]} />
        <View style={[styles.barSegment, { flex: bearishPct, backgroundColor: DARK.bearish }]} />
      </View>

      {/* Labels */}
      <View style={styles.labelsRow}>
        <Text style={[styles.pctLabel, { color: DARK.bullish }]}>
          {Math.round(bullishPct * 100)}% Bull
        </Text>
        <Text style={[styles.pctLabel, { color }]}>
          {Math.round(bullishPct * 100)}% Bullish Overall
        </Text>
        <Text style={[styles.pctLabel, { color: DARK.bearish }]}>
          {Math.round(bearishPct * 100)}% Bear
        </Text>
      </View>

      {/* Divergence warning */}
      {divergence && (
        <View style={[styles.alert, { borderColor: '#f59e0b' }]}>
          <Text style={styles.alertText}>
            ⚠ Distribution Signal: price rising but sentiment falling
          </Text>
        </View>
      )}

      {/* Wave 5 contrarian warning */}
      {showWave5Warning && (
        <View style={[styles.alert, { borderColor: DARK.bearish }]}>
          <Text style={styles.alertText}>
            ⚠ Contrarian Warning: {Math.round(bullishPct * 100)}% bullish at Wave 5 top — historically bearish
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderTopWidth:    StyleSheet.hairlineWidth,
    borderTopColor:    DARK.separator,
    paddingHorizontal: 10,
    paddingVertical:   8,
    backgroundColor:   DARK.background,
  },
  header: {
    flexDirection:  'row',
    justifyContent: 'space-between',
    alignItems:     'center',
    marginBottom:   6,
  },
  label: {
    color:         DARK.textMuted,
    fontSize:      9,
    fontWeight:    '700',
    letterSpacing: 1,
  },
  meta: {
    color:    DARK.textMuted,
    fontSize: 9,
  },
  muted: {
    color:    DARK.textMuted,
    fontSize: 11,
    fontStyle: 'italic',
  },
  barTrack: {
    flexDirection: 'row',
    height:        6,
    borderRadius:  3,
    overflow:      'hidden',
    backgroundColor: DARK.border,
  },
  barSegment: {
    height: 6,
  },
  labelsRow: {
    flexDirection:  'row',
    justifyContent: 'space-between',
    marginTop:      4,
  },
  pctLabel: {
    fontSize:   9,
    fontWeight: '600',
  },
  alert: {
    marginTop:         6,
    borderRadius:      4,
    borderWidth:       1,
    paddingHorizontal: 8,
    paddingVertical:   4,
  },
  alertText: {
    color:    '#f59e0b',
    fontSize: 10,
    fontWeight: '600',
  },
});
