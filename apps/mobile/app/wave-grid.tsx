/**
 * app/wave-grid.tsx — WaveGridScreen
 *
 * Sortable table of all watchlist tickers showing:
 *   Ticker | Wave | Structure | Probability | Next Target | Invalidation | Regime
 *
 * Sortable by: probability, wave number, % to target
 * Tap a row → navigate to full chart
 */

import React, { useState, useMemo, useCallback } from 'react';
import {
  View, Text, FlatList, Pressable, StyleSheet,
} from 'react-native';
import { SafeAreaView }   from 'react-native-safe-area-context';
import { useNavigation }  from '@react-navigation/native';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import { useWatchlistStore }    from '../stores/watchlist';
import { useWaveCountStore }    from '../stores/waveCount';
import { useMarketDataStore }   from '../stores/marketData';
import { RegimeBadge }          from '../components/common/RegimeBadge';
import { DARK }                 from '../theme/colors';
import type { RootTabParamList } from '../navigation/AppNavigator';

type SortKey = 'probability' | 'wave' | 'pct_to_target';
type SortDir = 'asc' | 'desc';

// ── Helper ────────────────────────────────────────────────────────────────────

function waveOrder(label: string): number {
  const map: Record<string, number> = {
    '1': 1, '2': 2, '3': 3, '4': 4, '5': 5,
    'A': 6, 'B': 7, 'C': 8,
  };
  return map[label] ?? 99;
}

// ── Row ───────────────────────────────────────────────────────────────────────

interface RowData {
  ticker:      string;
  waveLabel:   string;
  structure:   string;
  probability: number;
  nextTarget:  number | null;
  invalidation:number | null;
  pctToTarget: number | null;
  regime:      string | null;
  price:       number | null;
}

function GridRow({ row, onPress }: { row: RowData; onPress: () => void }) {
  const probColor =
    row.probability >= 0.7 ? DARK.bullish
    : row.probability >= 0.45 ? DARK.neutral
    : DARK.bearish;

  const pctColor =
    row.pctToTarget === null ? DARK.textMuted
    : row.pctToTarget > 0 ? DARK.bullish : DARK.bearish;

  return (
    <Pressable style={rowStyles.row} onPress={onPress}>
      {/* Ticker + price */}
      <View style={rowStyles.col1}>
        <Text style={rowStyles.ticker}>{row.ticker}</Text>
        {row.price && <Text style={rowStyles.price}>{row.price.toFixed(2)}</Text>}
      </View>

      {/* Wave + structure */}
      <View style={rowStyles.col2}>
        <Text style={rowStyles.wave}>W{row.waveLabel}</Text>
        <Text style={rowStyles.structure} numberOfLines={1}>{row.structure}</Text>
      </View>

      {/* Probability */}
      <View style={rowStyles.col3}>
        <Text style={[rowStyles.prob, { color: probColor }]}>
          {Math.round(row.probability * 100)}%
        </Text>
        <View style={rowStyles.probBar}>
          <View style={[rowStyles.probFill, {
            width: `${row.probability * 100}%`,
            backgroundColor: probColor,
          }]} />
        </View>
      </View>

      {/* Target / Invalidation */}
      <View style={rowStyles.col4}>
        {row.nextTarget   && <Text style={rowStyles.target}>{row.nextTarget.toFixed(2)}</Text>}
        {row.invalidation && <Text style={rowStyles.invalid}>↓{row.invalidation.toFixed(2)}</Text>}
        {row.pctToTarget  !== null && (
          <Text style={[rowStyles.pct, { color: pctColor }]}>
            {row.pctToTarget >= 0 ? '+' : ''}{row.pctToTarget.toFixed(1)}%
          </Text>
        )}
      </View>

      {/* Regime badge */}
      <View style={rowStyles.col5}>
        {row.regime && <RegimeBadge ticker={row.ticker} size="sm" />}
      </View>
    </Pressable>
  );
}

const rowStyles = StyleSheet.create({
  row: {
    flexDirection:     'row',
    alignItems:        'center',
    paddingHorizontal: 10,
    paddingVertical:   9,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: DARK.separator,
  },
  col1: { flex: 1.5, gap: 1 },
  col2: { flex: 1.8, gap: 1 },
  col3: { flex: 1.2, gap: 2 },
  col4: { flex: 1.5, gap: 1 },
  col5: { flex: 1.5, alignItems: 'flex-end' },

  ticker:    { color: DARK.textPrimary,   fontSize: 12, fontWeight: '700' },
  price:     { color: DARK.textMuted,     fontSize: 10 },
  wave:      { color: '#60a5fa',          fontSize: 13, fontWeight: '700' },
  structure: { color: DARK.textMuted,     fontSize: 9 },
  prob:      { fontSize: 13, fontWeight: '700' },
  probBar:   { height: 3, backgroundColor: DARK.border, borderRadius: 1.5, overflow: 'hidden' },
  probFill:  { height: 3, borderRadius: 1.5 },
  target:    { color: DARK.bullish,       fontSize: 10, fontWeight: '600' },
  invalid:   { color: DARK.bearish,       fontSize: 10 },
  pct:       { fontSize: 11, fontWeight: '600' },
});

// ── Screen ────────────────────────────────────────────────────────────────────

export function WaveGridScreen() {
  const [sortKey, setSortKey] = useState<SortKey>('probability');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  const items     = useWatchlistStore((s) => s.items);
  const waveCounts = useWaveCountStore((s) => s.counts);
  const posteriors = useWaveCountStore((s) => s.posteriors);
  const quotes     = useMarketDataStore((s) => s.quotes);
  const regimes    = useMarketDataStore((s) => s.regimes);

  const rows: RowData[] = useMemo(() => {
    return items.map((item) => {
      const ticker = item.instrument.ticker;
      const key    = `${ticker}_5m`;
      const counts = waveCounts[key] ?? [];
      const top    = counts[0];
      if (!top) {
        return {
          ticker,
          waveLabel:   '—',
          structure:   '—',
          probability: 0,
          nextTarget:  null,
          invalidation: null,
          pctToTarget: null,
          regime:      regimes[ticker] ?? null,
          price:       quotes[ticker]?.last ?? null,
        };
      }

      const post  = posteriors[top.id];
      const prob  = post?.posterior ?? top.posterior?.posterior ?? 0;
      const price = quotes[ticker]?.last ?? null;

      // Target = first target price; invalidation = stopPrice
      const nextTarget   = top.targets?.[0] ?? null;
      const invalidation = top.stopPrice ?? post?.invalidation_price ?? null;
      const pctToTarget  = price && nextTarget ? (nextTarget - price) / price * 100 : null;
      const lastWave     = top.currentWave;

      return {
        ticker,
        waveLabel:    String(lastWave?.label ?? '?'),
        structure:    top.currentWave?.structure ?? '',
        probability:  Math.min(1, Math.max(0, prob)),
        nextTarget,
        invalidation,
        pctToTarget:  pctToTarget ? Math.round(pctToTarget * 10) / 10 : null,
        regime:       regimes[ticker] ?? null,
        price,
      };
    });
  }, [items, waveCounts, posteriors, quotes, regimes]);

  const sorted = useMemo(() => {
    return [...rows].sort((a, b) => {
      let diff = 0;
      switch (sortKey) {
        case 'probability':  diff = a.probability - b.probability; break;
        case 'wave':         diff = waveOrder(a.waveLabel) - waveOrder(b.waveLabel); break;
        case 'pct_to_target':
          diff = (a.pctToTarget ?? -999) - (b.pctToTarget ?? -999); break;
      }
      return sortDir === 'desc' ? -diff : diff;
    });
  }, [rows, sortKey, sortDir]);

  const toggleSort = useCallback((key: SortKey) => {
    if (sortKey === key) setSortDir((d) => d === 'desc' ? 'asc' : 'desc');
    else { setSortKey(key); setSortDir('desc'); }
  }, [sortKey]);

  const navigation = useNavigation<BottomTabNavigationProp<RootTabParamList>>();
  const openChart  = useCallback((_ticker: string) => {
    navigation.navigate('Chart');
  }, [navigation]);


  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>Wave Grid</Text>
        <Text style={styles.subtitle}>{items.length} tickers</Text>
      </View>

      {/* Column headers */}
      <View style={styles.colHeaders}>
        <Text style={[styles.colHdr, { flex: 1.5 }]}>TICKER</Text>
        <Text style={[styles.colHdr, { flex: 1.8 }]}>WAVE</Text>
        <Pressable style={{ flex: 1.2 }} onPress={() => toggleSort('probability')}>
          <Text style={[styles.colHdr, sortKey === 'probability' && styles.colHdrActive]}>
            PROB{sortKey === 'probability' ? (sortDir === 'desc' ? ' ↓' : ' ↑') : ''}
          </Text>
        </Pressable>
        <Pressable style={{ flex: 1.5 }} onPress={() => toggleSort('pct_to_target')}>
          <Text style={[styles.colHdr, sortKey === 'pct_to_target' && styles.colHdrActive]}>
            TARGET{sortKey === 'pct_to_target' ? (sortDir === 'desc' ? ' ↓' : ' ↑') : ''}
          </Text>
        </Pressable>
        <Text style={[styles.colHdr, { flex: 1.5, textAlign: 'right' }]}>REGIME</Text>
      </View>

      {items.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>Add tickers to your watchlist first.</Text>
        </View>
      ) : (
        <FlatList
          data={sorted}
          keyExtractor={(r) => r.ticker}
          renderItem={({ item }) => (
            <GridRow row={item} onPress={() => openChart(item.ticker)} />
          )}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:    { flex: 1, backgroundColor: DARK.background },
  header:  {
    flexDirection: 'row', alignItems: 'baseline', gap: 8,
    paddingHorizontal: 16, paddingTop: 12, paddingBottom: 6,
  },
  title:    { color: DARK.textPrimary,   fontSize: 20, fontWeight: '700' },
  subtitle: { color: DARK.textMuted,     fontSize: 12 },
  colHeaders: {
    flexDirection:     'row',
    paddingHorizontal: 10,
    paddingVertical:   6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: DARK.separator,
  },
  colHdr:       { color: DARK.textMuted,    fontSize: 9, fontWeight: '600', flex: 1 },
  colHdrActive: { color: DARK.textPrimary },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  emptyText: { color: DARK.textMuted, fontSize: 13, textAlign: 'center' },
});
