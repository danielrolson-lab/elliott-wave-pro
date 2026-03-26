/**
 * TimeAndSales.tsx
 *
 * Rolling tape of the last 50 trade prints.
 *
 * Each row:
 *   Time    Price    Size    Exchange   [BLOCK badge]
 *
 * Color coding:
 *   BUY aggressor  → green text
 *   SELL aggressor → red text
 *   UNKNOWN        → white text
 *
 * Block prints (size > 5× avg) get an orange BLOCK badge.
 */

import React, { useCallback } from 'react';
import {
  FlatList,
  View,
  Text,
  StyleSheet,
  type ListRenderItemInfo,
} from 'react-native';
import { useL2Store }    from '../../stores/l2';
import type { TapePrint } from '../../stores/l2';
import { DARK }          from '../../theme/colors';

const BUY_COLOR     = '#22c55e';
const SELL_COLOR    = '#ef4444';
const NEUTRAL_COLOR = DARK.textPrimary;
const BLOCK_BG      = '#E65100';

function fmt(ts: number): string {
  const d = new Date(ts);
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  const s = String(d.getSeconds()).padStart(2, '0');
  return `${h}:${m}:${s}`;
}

function PrintRow({ item }: { item: TapePrint }) {
  const color =
    item.aggressor === 'buy'  ? BUY_COLOR :
    item.aggressor === 'sell' ? SELL_COLOR : NEUTRAL_COLOR;

  const sizeStr = item.size >= 1_000
    ? `${(item.size / 1_000).toFixed(1)}K`
    : String(item.size);

  return (
    <View style={styles.row}>
      <Text style={[styles.time, { color: DARK.textMuted }]}>{fmt(item.timestamp)}</Text>
      <Text style={[styles.price, { color }]}>${item.price.toFixed(2)}</Text>
      <Text style={[styles.size,  { color }]}>{sizeStr}</Text>
      {item.isBlock && (
        <View style={styles.blockBadge}>
          <Text style={styles.blockText}>BLOCK</Text>
        </View>
      )}
    </View>
  );
}

export function TimeAndSales() {
  const tape = useL2Store((s) => s.tape);

  const keyExtractor = useCallback((item: TapePrint) => item.id, []);
  const renderItem   = useCallback(
    ({ item }: ListRenderItemInfo<TapePrint>) => <PrintRow item={item} />,
    [],
  );

  if (tape.length === 0) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>Waiting for trade prints…</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.colHeader}>TIME</Text>
        <Text style={styles.colHeader}>PRICE</Text>
        <Text style={styles.colHeader}>SIZE</Text>
      </View>
      <FlatList
        data={tape}
        keyExtractor={keyExtractor}
        renderItem={renderItem}
        initialNumToRender={25}
        maxToRenderPerBatch={15}
        showsVerticalScrollIndicator={false}
        ItemSeparatorComponent={() => <View style={styles.sep} />}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: DARK.background },
  empty:     { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyText: { color: DARK.textMuted, fontSize: 12 },

  header: {
    flexDirection:     'row',
    paddingHorizontal: 10,
    paddingVertical:    4,
    borderBottomWidth:  StyleSheet.hairlineWidth,
    borderBottomColor:  DARK.separator,
    gap: 12,
  },
  colHeader: { color: DARK.textMuted, fontSize: 9, fontWeight: '700', letterSpacing: 0.5 },

  row: {
    flexDirection:     'row',
    alignItems:        'center',
    paddingHorizontal: 10,
    paddingVertical:    4,
    gap:               12,
  },
  time:  { fontSize: 10, fontVariant: ['tabular-nums'], width: 60 },
  price: { fontSize: 11, fontWeight: '600', fontVariant: ['tabular-nums'], width: 60 },
  size:  { fontSize: 10, fontVariant: ['tabular-nums'], width: 48 },

  blockBadge: { backgroundColor: BLOCK_BG, borderRadius: 3, paddingHorizontal: 4, paddingVertical: 1 },
  blockText:  { color: '#FFF', fontSize: 8, fontWeight: '800' },

  sep: { height: StyleSheet.hairlineWidth, backgroundColor: DARK.separator },
});
