/**
 * app/darkpool.tsx — Dark Pool Feed screen
 *
 * Shows FINRA OTC / dark pool prints with wave count context.
 * Highlights when dark pool volume exceeds 40% of daily vol
 * and when large prints coincide with Wave 2/4 retrace.
 */

import React from 'react';
import {
  View, Text, Pressable, StyleSheet, ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useDarkPoolFeed }  from '../hooks/useDarkPoolFeed';
import { useDarkPoolStore, applyDarkPoolFilter } from '../stores/darkpool';
import { DarkPoolList }    from '../components/darkpool/DarkPoolList';
import { DARK }            from '../theme/colors';

const MIN_NOTIONALS = [100_000, 500_000, 1_000_000, 5_000_000, 10_000_000] as const;

function formatMin(n: number): string {
  if (n >= 1e6) return `$${n / 1e6}M+`;
  return `$${n / 1000}K+`;
}

export function DarkPoolScreen() {
  const { refresh }   = useDarkPoolFeed();
  const prints        = useDarkPoolStore((s) => s.prints);
  const filter        = useDarkPoolStore((s) => s.filter);
  const setFilter     = useDarkPoolStore((s) => s.setFilter);
  const status        = useDarkPoolStore((s) => s.status);
  const lastFetch     = useDarkPoolStore((s) => s.lastFetch);

  const visible       = applyDarkPoolFilter(prints, filter);
  const isRefreshing  = status === 'loading';

  const updatedAt = lastFetch > 0
    ? `${Math.round((Date.now() - lastFetch) / 1000)}s ago`
    : '—';

  const statusColor =
    status === 'live'    ? DARK.bullish
    : status === 'error'  ? DARK.bearish
    : status === 'loading'? DARK.neutral
    : DARK.textMuted;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <View style={[styles.dot, { backgroundColor: statusColor }]} />
          <Text style={styles.title}>Dark Pool</Text>
        </View>
        <Text style={styles.meta}>{visible.length} prints · {updatedAt}</Text>
      </View>

      {/* Filters */}
      <View style={styles.filters}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          {MIN_NOTIONALS.map((mn) => (
            <Pressable
              key={mn}
              style={[styles.pill, filter.minNotional === mn && styles.pillActive]}
              onPress={() => setFilter({ minNotional: mn })}
            >
              <Text style={[styles.pillText, filter.minNotional === mn && styles.pillTextActive]}>
                {formatMin(mn)}
              </Text>
            </Pressable>
          ))}
          <Pressable
            style={[styles.pill, filter.largeOnly && styles.pillActive]}
            onPress={() => setFilter({ largeOnly: !filter.largeOnly })}
          >
            <Text style={[styles.pillText, filter.largeOnly && styles.pillTextActive]}>
              ⬛ Large Only
            </Text>
          </Pressable>
        </ScrollView>
      </View>

      {/* List */}
      <DarkPoolList
        prints={visible}
        onRefresh={() => { void refresh(); }}
        isRefreshing={isRefreshing}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:      { flex: 1, backgroundColor: DARK.background },
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
  dot:   { width: 7, height: 7, borderRadius: 3.5 },
  title: { color: DARK.textPrimary, fontSize: 18, fontWeight: '700' },
  meta:  { color: DARK.textMuted, fontSize: 11 },
  filters: {
    paddingHorizontal: 12,
    paddingVertical:   6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: DARK.separator,
  },
  pill: {
    paddingHorizontal: 12,
    paddingVertical:    5,
    borderRadius:       4,
    borderWidth:        1,
    borderColor:        DARK.border,
    marginRight:        6,
  },
  pillActive:    { backgroundColor: '#1d4ed8', borderColor: '#1d4ed8' },
  pillText:      { color: DARK.textMuted,    fontSize: 12, fontWeight: '600' },
  pillTextActive: { color: '#fff' },
});
