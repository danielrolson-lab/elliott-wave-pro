/**
 * DepthLadder.tsx
 *
 * Top-10 bid/ask depth table.
 *
 *   Bid side (left)    │ Price   │ Ask side (right)
 *   Size ████████       │ 580.01  │        ████ Size
 *
 * Color intensity scales with size relative to the max size on that side.
 * Imbalance ratio displayed at the top (green if bid-heavy, red if ask-heavy).
 * Best 3 levels on each side show exchange tag.
 */

import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useL2Store, bidAskImbalance } from '../../stores/l2';
import { DARK } from '../../theme/colors';

const BID_COLOR  = '#22c55e';
const ASK_COLOR  = '#ef4444';
const ROW_H      = 22;
const BAR_MAX_W  = 80;

interface SizeBarProps {
  size:    number;
  maxSize: number;
  color:   string;
  align:   'left' | 'right';
}

function SizeBar({ size, maxSize, color, align }: SizeBarProps) {
  const w = maxSize > 0 ? Math.round((size / maxSize) * BAR_MAX_W) : 0;
  return (
    <View style={[styles.barWrap, align === 'right' && styles.barWrapRight]}>
      <View style={[styles.bar, { width: w, backgroundColor: color + '55' }]} />
    </View>
  );
}

interface LevelRowProps {
  price:   number;
  size:    number;
  maxSize: number;
  side:    'bid' | 'ask';
  rank:    number;   // 0-indexed
}

function LevelRow({ price, size, maxSize, side, rank }: LevelRowProps) {
  const color     = side === 'bid' ? BID_COLOR : ASK_COLOR;
  const isBest3   = rank < 3;
  const textAlpha = isBest3 ? 'E6' : '80';

  const sizeStr  = size >= 1_000 ? `${(size / 1_000).toFixed(1)}K` : String(size);
  const priceStr = price.toFixed(2);

  if (side === 'bid') {
    return (
      <View style={styles.levelRow}>
        <Text style={[styles.sizeText, { color: color + textAlpha, textAlign: 'right', flex: 1 }]}>
          {sizeStr}
        </Text>
        <SizeBar size={size} maxSize={maxSize} color={color} align="right" />
        <Text style={[styles.priceText, { color: isBest3 ? DARK.textPrimary : DARK.textMuted }]}>
          {priceStr}
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.levelRow}>
      <Text style={[styles.priceText, { color: isBest3 ? DARK.textPrimary : DARK.textMuted }]}>
        {priceStr}
      </Text>
      <SizeBar size={size} maxSize={maxSize} color={color} align="left" />
      <Text style={[styles.sizeText, { color: color + textAlpha, textAlign: 'left', flex: 1 }]}>
        {sizeStr}
      </Text>
    </View>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export interface DepthLadderProps {
  ticker: string;
}

export function DepthLadder({ ticker }: DepthLadderProps) {
  const book      = useL2Store((s) => s.books[ticker]);
  const connected = useL2Store((s) => s.connected);

  const imbalance = useMemo(() => (book ? bidAskImbalance(book) : 1), [book]);
  const imbalColor = imbalance > 1.2 ? BID_COLOR : imbalance < 0.8 ? ASK_COLOR : DARK.textMuted;
  const imbalLabel = imbalance > 1.2 ? 'BID HEAVY' : imbalance < 0.8 ? 'ASK HEAVY' : 'BALANCED';

  const maxBid = useMemo(() => Math.max(1, ...(book?.bids.map((l) => l.size) ?? [1])), [book]);
  const maxAsk = useMemo(() => Math.max(1, ...(book?.asks.map((l) => l.size) ?? [1])), [book]);

  if (!book) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>
          {connected ? `Waiting for ${ticker} L2 data…` : 'L2 connecting…'}
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* ── Imbalance header ── */}
      <View style={styles.imbalanceRow}>
        <Text style={[styles.imbalanceText, { color: imbalColor }]}>
          {imbalLabel}  {imbalance.toFixed(2)}x
        </Text>
        <Text style={styles.columnHeaders}>
          {'BID SIZE'.padEnd(10)} PRICE {'ASK SIZE'.padStart(10)}
        </Text>
      </View>

      {/* ── Bid + Ask levels interleaved ── */}
      <View style={styles.levels}>
        {/* Asks (top) reversed so best ask at bottom */}
        {[...book.asks].reverse().map((level, i) => (
          <LevelRow
            key={`ask-${level.price}`}
            price={level.price}
            size={level.size}
            maxSize={maxAsk}
            side="ask"
            rank={book.asks.length - 1 - i}
          />
        ))}

        {/* Spread separator */}
        <View style={styles.spreadRow}>
          <Text style={styles.spreadText}>
            Spread: {book.asks[0] && book.bids[0]
              ? ((book.asks[0].price - book.bids[0].price) * 100).toFixed(1) + '¢'
              : '—'}
          </Text>
        </View>

        {/* Bids (bottom) */}
        {book.bids.map((level, i) => (
          <LevelRow
            key={`bid-${level.price}`}
            price={level.price}
            size={level.size}
            maxSize={maxBid}
            side="bid"
            rank={i}
          />
        ))}
      </View>
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { backgroundColor: DARK.background },
  empty:     { padding: 16, alignItems: 'center' },
  emptyText: { color: DARK.textMuted, fontSize: 12 },

  imbalanceRow: {
    paddingHorizontal: 10,
    paddingVertical:    4,
    borderBottomWidth:  StyleSheet.hairlineWidth,
    borderBottomColor:  DARK.separator,
    gap: 2,
  },
  imbalanceText: { fontSize: 10, fontWeight: '700', letterSpacing: 0.5 },
  columnHeaders: { color: DARK.textMuted, fontSize: 9, fontFamily: 'monospace' },

  levels: { paddingHorizontal: 6 },

  levelRow: {
    height:        ROW_H,
    flexDirection: 'row',
    alignItems:    'center',
    gap:           4,
  },
  priceText: { fontSize: 11, fontWeight: '600', width: 56, textAlign: 'center', fontVariant: ['tabular-nums'] },
  sizeText:  { fontSize: 10, fontVariant: ['tabular-nums'] },

  barWrap:      { width: BAR_MAX_W, height: 12, justifyContent: 'center', alignItems: 'flex-start' },
  barWrapRight: { alignItems: 'flex-end' },
  bar:          { height: 8, borderRadius: 2 },

  spreadRow:  { alignItems: 'center', paddingVertical: 2 },
  spreadText: { color: DARK.textMuted, fontSize: 9 },
});
