/**
 * components/darkpool/DarkPoolList.tsx
 *
 * Renders dark pool prints as a FlatList.
 * Large prints (>40% ADV) are highlighted with a ⬛ badge.
 * Prints coinciding with Wave 2/4 retrace flag institutional accumulation.
 */

import React from 'react';
import {
  View, Text, FlatList, StyleSheet,
} from 'react-native';
import type { DarkPoolPrint } from '../../stores/darkpool';
import { DARK } from '../../theme/colors';

function formatNotional(n: number): string {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  return `$${(n / 1e3).toFixed(0)}K`;
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}:${String(d.getUTCSeconds()).padStart(2, '0')}`;
}

function PrintRow({ print }: { print: DarkPoolPrint }) {
  const isAccumulation = print.wave_context?.includes('accumulation') ?? false;

  return (
    <View style={[styles.row, isAccumulation && styles.rowHighlight]}>
      {/* Left: ticker + venue */}
      <View style={styles.col1}>
        <Text style={styles.ticker}>{print.ticker}</Text>
        <Text style={styles.venue}>{print.venue}</Text>
        <Text style={styles.time}>{formatTime(print.timestamp)}</Text>
      </View>

      {/* Mid: price + size + notional */}
      <View style={styles.col2}>
        <Text style={styles.price}>{print.price.toFixed(2)}</Text>
        <Text style={styles.size}>{(print.size / 1000).toFixed(0)}K sh</Text>
        <Text style={styles.notional}>{formatNotional(print.notional)}</Text>
      </View>

      {/* Right: badges + wave context */}
      <View style={styles.col3}>
        {print.large_flag && (
          <View style={styles.largeBadge}>
            <Text style={styles.largeBadgeText}>⬛ LARGE</Text>
          </View>
        )}
        {print.wave_context && (
          <Text style={styles.waveCtx} numberOfLines={2}>{print.wave_context}</Text>
        )}
        <Text style={styles.adv}>{print.pct_of_adv.toFixed(1)}% ADV</Text>
      </View>
    </View>
  );
}

interface Props {
  prints:       DarkPoolPrint[];
  onRefresh?:   () => void;
  isRefreshing?: boolean;
}

export function DarkPoolList({ prints, onRefresh, isRefreshing }: Props) {
  return (
    <FlatList
      data={prints}
      keyExtractor={(p) => p.id}
      renderItem={({ item }) => <PrintRow print={item} />}
      onRefresh={onRefresh}
      refreshing={isRefreshing ?? false}
      ListEmptyComponent={
        <View style={styles.empty}>
          <Text style={styles.emptyText}>No dark pool prints yet.</Text>
        </View>
      }
    />
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection:     'row',
    paddingHorizontal: 12,
    paddingVertical:   9,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: DARK.separator,
  },
  rowHighlight: {
    backgroundColor: '#14532d20',
  },
  col1: { flex: 1.2, gap: 2 },
  col2: { flex: 1.5, gap: 2 },
  col3: { flex: 2,   gap: 2, alignItems: 'flex-end' },

  ticker:  { color: DARK.textPrimary,   fontSize: 13, fontWeight: '700' },
  venue:   { color: DARK.textMuted,     fontSize: 9 },
  time:    { color: DARK.textMuted,     fontSize: 9 },

  price:    { color: DARK.textPrimary,   fontSize: 12, fontWeight: '600' },
  size:     { color: DARK.textSecondary, fontSize: 10 },
  notional: { color: '#60a5fa',          fontSize: 11, fontWeight: '700' },

  largeBadge: {
    backgroundColor: '#1e3a5f',
    borderRadius:    3,
    paddingHorizontal: 5,
    paddingVertical:   1,
  },
  largeBadgeText: { color: '#93c5fd', fontSize: 9, fontWeight: '700' },

  waveCtx: { color: '#34d399', fontSize: 9, textAlign: 'right' },
  adv:     { color: DARK.textMuted, fontSize: 9 },

  empty:     { padding: 24, alignItems: 'center' },
  emptyText: { color: DARK.textMuted, fontSize: 13 },
});
