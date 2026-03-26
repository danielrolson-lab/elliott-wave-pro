/**
 * FlowFeedList.tsx
 *
 * Virtualized FlatList of unusual options flow prints.
 *
 * Each row (compact — fits on one line + badge row):
 *
 *   ┌────────────────────────────────────────────────────────────┐
 *   │ [TICKER] [STRIKE][C/P] [EXPIRY]  [SIZE]  [$PREM]  [SIDE] │
 *   │ [SWEEP?] [BLOCK?] [REPEAT?]   Δ 0.42 · IV 28% · V/OI 1.2x│
 *   └────────────────────────────────────────────────────────────┘
 *
 * Row background tint:
 *   call (any)  → subtle green tint
 *   put  (any)  → subtle red tint
 *
 * SIDE badge:
 *   BUY  → green text    SELL → red text    MIXED → gray text
 *
 * Flag badges:
 *   SWEEP  → orange pill    BLOCK → purple pill    REPEAT → red pill
 */

import React, { useCallback, useMemo } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  type ListRenderItemInfo,
} from 'react-native';
import { useFlowStore, applyFlowFilter } from '../../stores/flow';
import type { FlowPrint } from '../../services/flowFeed';
import { DARK } from '../../theme/colors';

// ── Colours ───────────────────────────────────────────────────────────────────

const CALL_BG   = 'rgba(76,175,80,0.06)';
const PUT_BG    = 'rgba(239,83,80,0.06)';
const CALL_TEXT = '#66BB6A';
const PUT_TEXT  = '#EF5350';
const BUY_COLOR  = '#66BB6A';
const SELL_COLOR = '#EF5350';
const MIX_COLOR  = '#6E7681';

const SWEEP_BG  = '#E65100';   // deep orange
const BLOCK_BG  = '#6A1B9A';   // purple
const REPEAT_BG = '#B71C1C';   // dark red

// ── Format helpers ────────────────────────────────────────────────────────────

function fmtPremium(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}

function fmtSize(n: number): string {
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function fmtDTE(expiry: string): string {
  // Returns "MMdd" for compact display e.g. "0419"
  return expiry.slice(5).replace('-', '');
}

// ── Badge ─────────────────────────────────────────────────────────────────────

interface BadgeProps {
  label: string;
  bg:    string;
}

function Badge({ label, bg }: BadgeProps) {
  return (
    <View style={[styles.badge, { backgroundColor: bg }]}>
      <Text style={styles.badgeText}>{label}</Text>
    </View>
  );
}

// ── Single row ────────────────────────────────────────────────────────────────

function FlowRow({ item }: { item: FlowPrint }) {
  const typeColor = item.contractType === 'call' ? CALL_TEXT : PUT_TEXT;
  const rowBg     = item.contractType === 'call' ? CALL_BG   : PUT_BG;
  const sideColor =
    item.side === 'buy'  ? BUY_COLOR  :
    item.side === 'sell' ? SELL_COLOR : MIX_COLOR;
  const sideLabel =
    item.side === 'buy'  ? 'BUY ▲' :
    item.side === 'sell' ? 'SELL ▼' : 'MIXED';

  return (
    <View style={[styles.row, { backgroundColor: rowBg }]}>
      {/* ── Top line ── */}
      <View style={styles.topLine}>
        <Text style={styles.ticker}>{item.ticker}</Text>

        <Text style={[styles.strike, { color: typeColor }]}>
          {item.strike.toFixed(0)}{item.contractType === 'call' ? 'C' : 'P'}
        </Text>

        <Text style={styles.expiry}>{fmtDTE(item.expiry)}</Text>

        <Text style={styles.size}>{fmtSize(item.size)}x</Text>

        <Text style={styles.premium}>{fmtPremium(item.premium)}</Text>

        <Text style={[styles.side, { color: sideColor }]}>{sideLabel}</Text>
      </View>

      {/* ── Bottom line: badges + Greeks ── */}
      <View style={styles.bottomLine}>
        <View style={styles.badges}>
          {item.isSweep  && <Badge label="SWEEP"  bg={SWEEP_BG} />}
          {item.isBlock  && <Badge label="BLOCK"  bg={BLOCK_BG} />}
          {item.isRepeat && <Badge label="REPEAT" bg={REPEAT_BG} />}
        </View>

        <Text style={styles.meta}>
          Δ {item.delta.toFixed(2)} · IV {(item.impliedVol * 100).toFixed(0)}% · V/OI {item.volOIRatio.toFixed(1)}x
        </Text>
      </View>
    </View>
  );
}

// ── Empty state ───────────────────────────────────────────────────────────────

function EmptyState() {
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyTitle}>No unusual flow detected</Text>
      <Text style={styles.emptySubtitle}>
        Scanning for premiums above threshold across 9 tickers…
      </Text>
    </View>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

interface FlowFeedListProps {
  onRefresh:   () => void;
  isRefreshing: boolean;
}

export function FlowFeedList({ onRefresh, isRefreshing }: FlowFeedListProps) {
  const prints = useFlowStore((s) => s.prints);
  const filter = useFlowStore((s) => s.filter);

  const visible = useMemo(() => applyFlowFilter(prints, filter), [prints, filter]);

  const keyExtractor = useCallback((item: FlowPrint) => item.id, []);
  const renderItem   = useCallback(
    ({ item }: ListRenderItemInfo<FlowPrint>) => <FlowRow item={item} />,
    [],
  );

  return (
    <FlatList
      data={visible}
      keyExtractor={keyExtractor}
      renderItem={renderItem}
      ListEmptyComponent={EmptyState}
      refreshing={isRefreshing}
      onRefresh={onRefresh}
      initialNumToRender={20}
      maxToRenderPerBatch={15}
      windowSize={5}
      showsVerticalScrollIndicator={false}
      ItemSeparatorComponent={() => <View style={styles.separator} />}
      contentContainerStyle={visible.length === 0 ? styles.emptyContainer : undefined}
    />
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  row: {
    paddingHorizontal: 12,
    paddingVertical:   7,
    gap:               3,
  },

  // Top line
  topLine: {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           8,
    flexWrap:      'nowrap',
  },
  ticker: {
    color:      DARK.textPrimary,
    fontSize:   12,
    fontWeight: '700',
    minWidth:   36,
  },
  strike: {
    fontSize:   12,
    fontWeight: '700',
    minWidth:   44,
  },
  expiry: {
    color:    DARK.textMuted,
    fontSize: 11,
    minWidth: 32,
  },
  size: {
    color:    DARK.textSecondary,
    fontSize: 11,
    minWidth: 36,
    textAlign: 'right',
  },
  premium: {
    color:      DARK.textPrimary,
    fontSize:   12,
    fontWeight: '700',
    minWidth:   52,
    textAlign:  'right',
  },
  side: {
    fontSize:   11,
    fontWeight: '700',
    marginLeft: 'auto',
  },

  // Bottom line
  bottomLine: {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           8,
  },
  badges: {
    flexDirection: 'row',
    gap:           4,
  },
  badge: {
    borderRadius:      3,
    paddingHorizontal: 5,
    paddingVertical:   1,
  },
  badgeText: {
    color:      '#FFFFFF',
    fontSize:   8,
    fontWeight: '800',
    letterSpacing: 0.4,
  },
  meta: {
    color:    DARK.textMuted,
    fontSize: 10,
  },

  // Separator
  separator: {
    height:          StyleSheet.hairlineWidth,
    backgroundColor: DARK.separator,
  },

  // Empty
  emptyContainer: {
    flex: 1,
  },
  empty: {
    flex:           1,
    alignItems:     'center',
    justifyContent: 'center',
    paddingTop:     60,
    gap:            8,
  },
  emptyTitle: {
    color:      DARK.textSecondary,
    fontSize:   15,
    fontWeight: '600',
  },
  emptySubtitle: {
    color:     DARK.textMuted,
    fontSize:  12,
    textAlign: 'center',
    paddingHorizontal: 32,
  },
});
