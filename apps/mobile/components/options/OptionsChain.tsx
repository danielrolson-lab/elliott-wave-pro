/**
 * OptionsChain.tsx
 *
 * Strike ladder displaying the full options chain for one expiry.
 *
 * Layout (split view — calls left, puts right):
 *
 *   ┌─────────────────────────────────────────────────────────┐
 *   │  [Calls] [Puts] [Both]   │   Δ range: 0.05–0.95        │
 *   ├────────────────────────────────────────────────────────┤
 *   │ Call side │ STRIKE │ Put side                          │
 *   │ Bid Ask Δ Γ IV OI │        │ Bid Ask Δ Γ IV OI        │
 *   │  ...   ATM strike highlighted   ...                    │
 *   └────────────────────────────────────────────────────────┘
 *
 * Moneyness colour coding:
 *   deep_itm  → #1565C0 (strong blue)
 *   itm       → #1976D2 (medium blue)
 *   atm       → #FFFFFF (white — this row is highlighted)
 *   otm       → #6E7681 (dim)
 *   deep_otm  → #3D444D (very dim)
 *
 * Special rows:
 *   Max Gamma strike — ★ badge on strike cell
 *   Max Pain strike  — ⚡ badge on strike cell
 */

import React, { useState, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  Pressable,
  FlatList,
  StyleSheet,
  ScrollView,
} from 'react-native';
import type { ListRenderItemInfo } from 'react-native';
import { useOptionsStore, applyFilter, selectFilter } from '../../stores/options';
import type { OptionRow, ChainSide, FilterConfig } from '../../stores/options';
import { DARK } from '../../theme/colors';

// ── Moneyness colours ─────────────────────────────────────────────────────────

const MONEYNESS_COLOR: Record<string, string> = {
  deep_itm: '#1565C0',
  itm:      '#1976D2',
  atm:      '#FFFFFF',
  otm:      '#6E7681',
  deep_otm: '#3D444D',
};

// ── Header row ────────────────────────────────────────────────────────────────

const CALL_COLS  = ['Bid', 'Ask', 'Δ', 'Γ', 'IV', 'OI'];
const PUT_COLS   = ['Bid', 'Ask', 'Δ', 'Γ', 'IV', 'OI'];
const STRIKE_W   = 56;
const COL_W      = 44;

// ── Format helpers ────────────────────────────────────────────────────────────

function fmt2(n: number): string  { return n.toFixed(2); }
function fmtPct(n: number): string { return `${(n * 100).toFixed(1)}%`; }
function fmtK(n: number): string  {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n);
}
function fmtDelta(n: number): string { return n.toFixed(2); }
function fmtGamma(n: number): string { return n.toFixed(4); }

// ── Side toggle ───────────────────────────────────────────────────────────────

interface ToggleProps {
  side:     ChainSide;
  onChange: (s: ChainSide) => void;
}

function SideToggle({ side, onChange }: ToggleProps) {
  const options: ChainSide[] = ['calls', 'both', 'puts'];
  return (
    <View style={styles.toggleRow}>
      {options.map((opt) => (
        <Pressable
          key={opt}
          style={[styles.toggleBtn, side === opt && styles.toggleBtnActive]}
          onPress={() => onChange(opt)}
          hitSlop={6}
        >
          <Text style={[styles.toggleText, side === opt && styles.toggleTextActive]}>
            {opt.charAt(0).toUpperCase() + opt.slice(1)}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

// ── Expiry picker ─────────────────────────────────────────────────────────────

interface ExpiryPickerProps {
  expiries:         string[];
  selectedExpiry:   string;
  onSelect:         (expiry: string) => void;
}

function ExpiryPicker({ expiries, selectedExpiry, onSelect }: ExpiryPickerProps) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.expiryScroll}>
      {expiries.map((exp) => (
        <Pressable
          key={exp}
          style={[styles.expiryPill, exp === selectedExpiry && styles.expiryPillActive]}
          onPress={() => onSelect(exp)}
          hitSlop={4}
        >
          <Text style={[styles.expiryText, exp === selectedExpiry && styles.expiryTextActive]}>
            {exp.slice(5)}  {/* MM-DD */}
          </Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}

// ── Column header row ─────────────────────────────────────────────────────────

function ColumnHeaders({ side }: { side: ChainSide }) {
  const showCalls = side !== 'puts';
  const showPuts  = side !== 'calls';
  return (
    <View style={styles.headerRow}>
      {showCalls && CALL_COLS.map((c) => (
        <Text key={`ch-${c}`} style={[styles.headerCell, { width: COL_W }]}>{c}</Text>
      ))}
      <Text style={[styles.headerCell, styles.strikeCell]}>Strike</Text>
      {showPuts && PUT_COLS.map((c) => (
        <Text key={`ph-${c}`} style={[styles.headerCell, { width: COL_W }]}>{c}</Text>
      ))}
    </View>
  );
}

// ── Single strike row ─────────────────────────────────────────────────────────

interface StrikeRowProps {
  call:           OptionRow | undefined;
  put:            OptionRow | undefined;
  strike:         number;
  side:           ChainSide;
  isMaxGamma:     boolean;
  isMaxPain:      boolean;
}

function StrikeRow({ call, put, strike, side, isMaxGamma, isMaxPain }: StrikeRowProps) {
  const moneyness  = call?.moneyness ?? put?.moneyness ?? 'otm';
  const color      = MONEYNESS_COLOR[moneyness] ?? DARK.textMuted;
  const isATM      = moneyness === 'atm';

  const showCalls  = side !== 'puts';
  const showPuts   = side !== 'calls';

  function renderCallCell(label: string, value: string) {
    return (
      <Text key={`c-${label}`} style={[styles.cell, { width: COL_W, color, textAlign: 'right' }]}>
        {value}
      </Text>
    );
  }

  function renderPutCell(label: string, value: string) {
    return (
      <Text key={`p-${label}`} style={[styles.cell, { width: COL_W, color, textAlign: 'left' }]}>
        {value}
      </Text>
    );
  }

  return (
    <View style={[styles.strikeRow, isATM && styles.atmRow]}>
      {/* Call side (right-aligned toward strike) */}
      {showCalls && <>
        {renderCallCell('bid',  call ? fmt2(call.bid)         : '—')}
        {renderCallCell('ask',  call ? fmt2(call.ask)         : '—')}
        {renderCallCell('d',    call ? fmtDelta(call.delta)   : '—')}
        {renderCallCell('g',    call ? fmtGamma(call.gamma)   : '—')}
        {renderCallCell('iv',   call ? fmtPct(call.impliedVol): '—')}
        {renderCallCell('oi',   call ? fmtK(call.openInterest): '—')}
      </>}

      {/* Strike cell */}
      <View style={styles.strikeCell}>
        <Text style={[styles.strikeText, { color }]}>
          {strike.toFixed(0)}
        </Text>
        {isMaxGamma && <Text style={styles.badge}>★</Text>}
        {isMaxPain  && <Text style={styles.badgePain}>⚡</Text>}
      </View>

      {/* Put side (left-aligned away from strike) */}
      {showPuts && <>
        {renderPutCell('bid',  put ? fmt2(put.bid)          : '—')}
        {renderPutCell('ask',  put ? fmt2(put.ask)          : '—')}
        {renderPutCell('d',    put ? fmtDelta(put.delta)    : '—')}
        {renderPutCell('g',    put ? fmtGamma(put.gamma)    : '—')}
        {renderPutCell('iv',   put ? fmtPct(put.impliedVol) : '—')}
        {renderPutCell('oi',   put ? fmtK(put.openInterest) : '—')}
      </>}
    </View>
  );
}

// ── IV Rank badge ─────────────────────────────────────────────────────────────

function IVRankBadge({ rank }: { rank: number }) {
  const color =
    rank > 80 ? '#EF5350' :
    rank > 20 ? '#FFA726' :
    '#66BB6A';
  return (
    <View style={[styles.ivRankBadge, { borderColor: color }]}>
      <Text style={[styles.ivRankText, { color }]}>IV Rank {rank}</Text>
    </View>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export interface OptionsChainProps {
  ticker: string;
}

export function OptionsChain({ ticker }: OptionsChainProps) {
  const expiries       = useOptionsStore((s) => s.expiries[ticker] ?? []);
  const storeExpiry    = useOptionsStore((s) => s.selectedExpiry[ticker] ?? '');
  const setExpiry      = useOptionsStore((s) => s.setSelectedExpiry);
  const maxGamma       = useOptionsStore((s) => s.maxGammaStrike[ticker] ?? -1);
  const maxPain        = useOptionsStore((s) => s.maxPain[ticker] ?? -1);
  const ivRank         = useOptionsStore((s) => s.ivRank[ticker] ?? 50);
  const filter         = useOptionsStore((s) => selectFilter(s, ticker));
  const setFilter      = useOptionsStore((s) => s.setFilter);

  const [localSide, setLocalSide] = useState<ChainSide>(filter.side);

  const selectedExpiry = storeExpiry || expiries[0] || '';
  const rawRows        = useOptionsStore((s) => s.rows[`${ticker}_${selectedExpiry}`] ?? []);

  // Apply filter
  const activeFilter: FilterConfig = { ...filter, side: localSide };
  const filteredRows  = useMemo(() => applyFilter(rawRows, activeFilter), [rawRows, activeFilter]);

  // Build strike list (unique strikes, sorted)
  const strikes = useMemo(() => {
    const set = new Set(filteredRows.map((r) => r.strike));
    return Array.from(set).sort((a, b) => a - b);
  }, [filteredRows]);

  // Index calls + puts by strike for O(1) lookup
  const callByStrike = useMemo(() => {
    const m = new Map<number, OptionRow>();
    filteredRows.filter((r) => r.contractType === 'call').forEach((r) => m.set(r.strike, r));
    return m;
  }, [filteredRows]);

  const putByStrike = useMemo(() => {
    const m = new Map<number, OptionRow>();
    filteredRows.filter((r) => r.contractType === 'put').forEach((r) => m.set(r.strike, r));
    return m;
  }, [filteredRows]);

  const handleSide = useCallback((s: ChainSide) => {
    setLocalSide(s);
    setFilter(ticker, 'side', s);
  }, [ticker, setFilter]);

  const renderItem = useCallback(({ item: strike }: ListRenderItemInfo<number>) => (
    <StrikeRow
      call={callByStrike.get(strike)}
      put={putByStrike.get(strike)}
      strike={strike}
      side={localSide}
      isMaxGamma={strike === maxGamma}
      isMaxPain={strike === maxPain}
    />
  ), [callByStrike, putByStrike, localSide, maxGamma, maxPain]);

  if (expiries.length === 0) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>Loading options chain…</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* ── Controls row ── */}
      <View style={styles.controls}>
        <SideToggle side={localSide} onChange={handleSide} />
        <IVRankBadge rank={ivRank} />
      </View>

      {/* ── Expiry picker ── */}
      <ExpiryPicker
        expiries={expiries}
        selectedExpiry={selectedExpiry}
        onSelect={(e) => setExpiry(ticker, e)}
      />

      {/* ── Column headers ── */}
      <ColumnHeaders side={localSide} />

      {/* ── Strike ladder ── */}
      <FlatList
        data={strikes}
        keyExtractor={(s) => String(s)}
        renderItem={renderItem}
        initialNumToRender={30}
        maxToRenderPerBatch={20}
        windowSize={5}
        showsVerticalScrollIndicator={false}
      />

      {/* ── Legend ── */}
      <View style={styles.legend}>
        <Text style={styles.legendText}>★ Max Gamma  ⚡ Max Pain</Text>
      </View>
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: DARK.background,
  },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyText: {
    color: DARK.textMuted,
    fontSize: 13,
  },

  // Controls
  controls: {
    flexDirection:  'row',
    alignItems:     'center',
    justifyContent: 'space-between',
    paddingHorizontal: 10,
    paddingVertical:   6,
  },
  toggleRow: {
    flexDirection: 'row',
    gap: 4,
  },
  toggleBtn: {
    borderWidth:   1,
    borderColor:   DARK.border,
    borderRadius:  4,
    paddingHorizontal: 10,
    paddingVertical:    4,
  },
  toggleBtnActive: {
    backgroundColor: '#1d4ed8',
    borderColor:     '#1d4ed8',
  },
  toggleText: {
    color:    DARK.textMuted,
    fontSize: 11,
    fontWeight: '600',
  },
  toggleTextActive: {
    color: '#FFFFFF',
  },

  // Expiry picker
  expiryScroll: {
    paddingHorizontal: 10,
    marginBottom: 4,
  },
  expiryPill: {
    borderWidth:   1,
    borderColor:   DARK.border,
    borderRadius:  12,
    paddingHorizontal: 10,
    paddingVertical:    3,
    marginRight:   6,
  },
  expiryPillActive: {
    backgroundColor: DARK.surfaceRaised,
    borderColor:     DARK.textSecondary,
  },
  expiryText: {
    color:    DARK.textMuted,
    fontSize: 11,
  },
  expiryTextActive: {
    color: DARK.textPrimary,
  },

  // Column headers
  headerRow: {
    flexDirection:   'row',
    alignItems:      'center',
    paddingHorizontal: 10,
    paddingVertical:   4,
    borderBottomWidth: 1,
    borderBottomColor: DARK.separator,
    backgroundColor:   DARK.surface,
  },
  headerCell: {
    color:     DARK.textMuted,
    fontSize:  9,
    fontWeight: '700',
    textAlign: 'center',
    letterSpacing: 0.5,
  },

  // Strike rows
  strikeRow: {
    flexDirection:    'row',
    alignItems:       'center',
    paddingHorizontal: 10,
    paddingVertical:   3,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: DARK.separator,
  },
  atmRow: {
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
  cell: {
    fontSize: 10,
    fontVariant: ['tabular-nums'],
  },
  strikeCell: {
    width:          STRIKE_W,
    flexDirection:  'row',
    alignItems:     'center',
    justifyContent: 'center',
    gap:            2,
  },
  strikeText: {
    fontSize:  11,
    fontWeight: '700',
  },
  badge: {
    fontSize: 9,
    color:    '#FFA726',
  },
  badgePain: {
    fontSize: 9,
    color:    '#AB47BC',
  },

  // IV Rank
  ivRankBadge: {
    borderWidth:   1,
    borderRadius:  4,
    paddingHorizontal: 8,
    paddingVertical:   3,
  },
  ivRankText: {
    fontSize:  11,
    fontWeight: '700',
  },

  // Legend
  legend: {
    paddingHorizontal: 10,
    paddingVertical:   4,
    borderTopWidth:    StyleSheet.hairlineWidth,
    borderTopColor:    DARK.separator,
  },
  legendText: {
    color:    DARK.textMuted,
    fontSize: 9,
  },
});
