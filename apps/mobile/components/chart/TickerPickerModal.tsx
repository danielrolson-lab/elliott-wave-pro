/**
 * components/chart/TickerPickerModal.tsx
 *
 * Bottom-sheet modal for switching the active chart ticker.
 *
 * Layout:
 *   ┌─────────────────────────────────┐
 *   │  [drag handle]                  │
 *   │  Search bar (autofocus)         │
 *   │  ── WATCHLIST ──                │
 *   │  [SPY] [QQQ] [AAPL] …          │  ← watchlist quick-picks
 *   │  ── RESULTS ──                  │
 *   │  AAPL  Apple Inc.               │
 *   │  AAPLX  …                       │
 *   └─────────────────────────────────┘
 *
 * Behaviour:
 *  - Opens with keyboard shown immediately (autoFocus on TextInput)
 *  - Typing debounces 200 ms → Polygon ticker search
 *  - Selecting any row calls onSelect(ticker, instrument) and closes
 *  - Empty query shows watchlist items as a scrollable list
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Keyboard,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  type ListRenderItemInfo,
} from 'react-native';
import type { Instrument } from '@elliott-wave-pro/wave-engine';
import { useWatchlistStore } from '../../stores/watchlist';
import { useMarketDataStore } from '../../stores/marketData';
import { DARK } from '../../theme/colors';

// ── Polygon search ─────────────────────────────────────────────────────────

const POLYGON_API_KEY  = process.env['EXPO_PUBLIC_POLYGON_API_KEY'] ?? '';
const POLYGON_BASE     = 'https://api.polygon.io';

interface TickerResult {
  ticker: string;
  name:   string;
}

// Well-known liquid tickers get a relevance boost
const WELL_KNOWN = new Set([
  'SPY','QQQ','AAPL','TSLA','NVDA','MSFT','AMZN','META','GOOGL','GOOG',
  'GS','SLV','GLD','IWM','DIA','TLT','VXX','VIX','XLF','XLK','ARKK',
  'SQQQ','TQQQ','SPXU','UPRO','UVXY','SVXY','INTC','AMD','NFLX','UBER',
]);

function scoreResult(result: TickerResult, query: string): number {
  const q      = query.toUpperCase().trim();
  const ticker = result.ticker.toUpperCase();
  const name   = (result.name ?? '').toUpperCase();
  let score = 0;

  if (ticker === q)              score += 1000;
  else if (ticker.startsWith(q)) score += 500;
  else if (ticker.includes(q))   score += 100;
  else if (name.startsWith(q))   score += 50;
  else if (name.includes(q))     score += 10;

  // Penalise longer tickers when query is a prefix (SPY beats SPYG)
  if (ticker !== q) score -= ticker.length * 2;

  if (WELL_KNOWN.has(ticker)) score += 25;

  return score;
}

async function searchTickers(query: string): Promise<TickerResult[]> {
  if (!query || query.trim().length < 1) return [];
  const q = query.trim().toUpperCase();

  // Two parallel requests: fuzzy name/description search + exact ticker lookup.
  // The exact lookup guarantees tickers like SLV appear even if not in the
  // top fuzzy results.
  const [fuzzyRes, exactRes] = await Promise.all([
    fetch(`${POLYGON_BASE}/v3/reference/tickers?search=${encodeURIComponent(q)}&active=true&limit=50&apiKey=${POLYGON_API_KEY}`)
      .then((r) => r.ok ? r.json() as Promise<{ results?: TickerResult[] }> : { results: [] })
      .catch(() => ({ results: [] as TickerResult[] })),
    fetch(`${POLYGON_BASE}/v3/reference/tickers?ticker=${encodeURIComponent(q)}&active=true&limit=1&apiKey=${POLYGON_API_KEY}`)
      .then((r) => r.ok ? r.json() as Promise<{ results?: TickerResult[] }> : { results: [] })
      .catch(() => ({ results: [] as TickerResult[] })),
  ]);

  const fuzzy = (fuzzyRes as { results?: TickerResult[] }).results ?? [];
  const exact = ((exactRes as { results?: TickerResult[] }).results ?? [])[0] ?? null;

  // Score and sort
  const scored = fuzzy
    .map((r) => ({ r, score: scoreResult(r, q) }))
    .sort((a, b) => b.score - a.score);

  // Push noisy results (containing `:` or spaces) to the bottom
  const clean = scored.filter(({ r }) => !r.ticker.includes(':') && !r.ticker.includes(' '));
  const noisy = scored.filter(({ r }) =>  r.ticker.includes(':') || r.ticker.includes(' '));
  const ranked = [...clean, ...noisy].map(({ r }) => r);

  // Guarantee exact match is position 0
  if (exact && ranked[0]?.ticker !== exact.ticker) {
    return [exact, ...ranked.filter((r) => r.ticker !== exact.ticker)].slice(0, 10);
  }
  return ranked.slice(0, 10);
}

// ── Props ──────────────────────────────────────────────────────────────────

interface Props {
  visible:  boolean;
  onClose:  () => void;
  onSelect: (ticker: string, instrument: Instrument) => void;
  currentTicker: string;
}

// ── Component ──────────────────────────────────────────────────────────────

export function TickerPickerModal({ visible, onClose, onSelect, currentTicker }: Props) {
  const [query,       setQuery]       = useState('');
  const [results,     setResults]     = useState<TickerResult[]>([]);
  const [searching,   setSearching]   = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef    = useRef<TextInput>(null);

  const watchlistItems = useWatchlistStore((s) => s.items);
  const setActiveTicker = useMarketDataStore((s) => s.setActiveTicker);

  // Auto-focus input when modal opens; clear state on close
  useEffect(() => {
    if (visible) {
      setQuery('');
      setResults([]);
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [visible]);

  // Debounced search — matches watchlist logic:
  //   · min 2 chars to trigger
  //   · 0 ms delay for pure uppercase tickers (^[A-Z]{1,5}$)
  //   · 150 ms delay for company-name queries
  const handleQueryChange = useCallback((v: string) => {
    setQuery(v);
    if (debounceRef.current) clearTimeout(debounceRef.current);

    const trimmed = v.trim();
    if (trimmed.length < 2) {
      setResults([]);
      setSearching(false);
      return;
    }

    setSearching(true);
    const isTicker = /^[A-Z]{1,5}$/.test(trimmed);
    const delay    = isTicker ? 0 : 150;

    debounceRef.current = setTimeout(async () => {
      const found = await searchTickers(trimmed);
      setResults(found);
      setSearching(false);
    }, delay);
  }, []);

  const handleSelect = useCallback((ticker: string, name: string) => {
    const instrument: Instrument = { ticker, name, exchange: '', type: 'equity' };
    setActiveTicker(ticker, instrument);
    onSelect(ticker, instrument);
    Keyboard.dismiss();
    onClose();
  }, [setActiveTicker, onSelect, onClose]);

  // ── Render result row ────────────────────────────────────────────────────

  const renderResult = useCallback(({ item }: ListRenderItemInfo<TickerResult>) => {
    const isCurrent = item.ticker === currentTicker;
    // Highlight the matched portion of the ticker
    const q      = query.trim().toUpperCase();
    const idx    = item.ticker.toUpperCase().indexOf(q);
    const before = idx >= 0 ? item.ticker.slice(0, idx) : item.ticker;
    const match  = idx >= 0 ? item.ticker.slice(idx, idx + q.length) : '';
    const after  = idx >= 0 ? item.ticker.slice(idx + q.length) : '';

    return (
      <TouchableOpacity
        style={[styles.resultRow, isCurrent && styles.resultRowActive]}
        onPress={() => handleSelect(item.ticker, item.name)}
        activeOpacity={0.7}
      >
        <Text style={[styles.resultTicker, isCurrent && styles.resultTickerActive]}>
          {match ? (
            <>
              <Text style={styles.tickerDim}>{before}</Text>
              <Text style={styles.tickerMatch}>{match}</Text>
              <Text style={styles.tickerDim}>{after}</Text>
            </>
          ) : item.ticker}
        </Text>
        <Text style={styles.resultName} numberOfLines={1}>{item.name}</Text>
        {isCurrent && <Text style={styles.currentDot}>●</Text>}
      </TouchableOpacity>
    );
  }, [currentTicker, handleSelect, query]);

  const keyExtractor = useCallback((item: TickerResult) => item.ticker, []);

  // ── Watchlist empty-query view ───────────────────────────────────────────

  const showWatchlist = !query.trim() && watchlistItems.length > 0;
  const showResults   = !!query.trim();

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      {/* Backdrop tap to dismiss */}
      <Pressable style={styles.backdrop} onPress={onClose} />

      <View style={styles.sheet}>
        {/* Drag handle */}
        <View style={styles.handle} />

        {/* Search bar */}
        <View style={styles.searchRow}>
          <Text style={styles.searchIcon}>⌕</Text>
          <TextInput
            ref={inputRef}
            style={styles.searchInput}
            value={query}
            onChangeText={handleQueryChange}
            placeholder="Search ticker or company…"
            placeholderTextColor={DARK.textMuted}
            autoCapitalize="characters"
            autoCorrect={false}
            returnKeyType="search"
            clearButtonMode="while-editing"
          />
          {searching && (
            <ActivityIndicator size="small" color={DARK.textMuted} style={styles.spinner} />
          )}
        </View>

        {/* Watchlist quick-picks */}
        {showWatchlist && (
          <>
            <Text style={styles.sectionLabel}>WATCHLIST</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.pillRow}
            >
              {watchlistItems.map((item) => {
                const isCurrent = item.id === currentTicker;
                return (
                  <TouchableOpacity
                    key={item.id}
                    style={[styles.pill, isCurrent && styles.pillActive]}
                    onPress={() => handleSelect(item.instrument.ticker, item.instrument.name)}
                    activeOpacity={0.7}
                  >
                    <Text style={[styles.pillText, isCurrent && styles.pillTextActive]}>
                      {item.id}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>

            <Text style={styles.sectionLabel}>ALL</Text>
            <FlatList
              data={watchlistItems.map((i) => ({ ticker: i.id, name: i.instrument.name }))}
              keyExtractor={keyExtractor}
              renderItem={renderResult}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
            />
          </>
        )}

        {/* Search results */}
        {showResults && (
          <>
            {results.length > 0 && (
              <>
                <Text style={styles.sectionLabel}>
                  {results[0]?.ticker.toUpperCase() === query.trim().toUpperCase()
                    ? `Exact match + ${results.length - 1} similar`
                    : `${results.length} results for "${query.trim().toUpperCase()}"`}
                </Text>
                <FlatList
                  data={results}
                  keyExtractor={keyExtractor}
                  renderItem={renderResult}
                  showsVerticalScrollIndicator={false}
                  keyboardShouldPersistTaps="handled"
                />
              </>
            )}
            {!searching && results.length === 0 && (
              <View style={styles.empty}>
                <Text style={styles.emptyText}>No results for "{query}"</Text>
              </View>
            )}
          </>
        )}

        {/* Initial empty state (no watchlist items either) */}
        {!showWatchlist && !showResults && (
          <View style={styles.empty}>
            <Text style={styles.emptyText}>Start typing to search for a ticker</Text>
          </View>
        )}
      </View>
    </Modal>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  backdrop: {
    flex:            1,
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  sheet: {
    backgroundColor: DARK.surface,
    borderTopLeftRadius:  16,
    borderTopRightRadius: 16,
    paddingBottom:        32,
    maxHeight:            '75%',
  },
  handle: {
    width:           40,
    height:          4,
    borderRadius:    2,
    backgroundColor: DARK.border,
    alignSelf:       'center',
    marginTop:       10,
    marginBottom:    12,
  },
  searchRow: {
    flexDirection:     'row',
    alignItems:        'center',
    backgroundColor:   DARK.background,
    borderRadius:      8,
    borderWidth:       1,
    borderColor:       DARK.border,
    marginHorizontal:  14,
    marginBottom:      12,
    paddingHorizontal: 10,
    paddingVertical:   9,
    gap:               8,
  },
  searchIcon: {
    color:    DARK.textMuted,
    fontSize: 16,
  },
  searchInput: {
    flex:     1,
    color:    DARK.textPrimary,
    fontSize: 15,
    padding:  0,
  },
  spinner: {
    marginLeft: 4,
  },
  sectionLabel: {
    color:         DARK.textMuted,
    fontSize:      10,
    fontWeight:    '700',
    letterSpacing: 1,
    marginHorizontal: 14,
    marginBottom:  6,
    marginTop:     4,
  },
  pillRow: {
    paddingHorizontal: 14,
    paddingBottom:     10,
    gap:               8,
  },
  pill: {
    paddingHorizontal: 14,
    paddingVertical:    6,
    borderRadius:       20,
    borderWidth:        1,
    borderColor:        DARK.border,
    backgroundColor:    DARK.background,
  },
  pillActive: {
    backgroundColor: '#1d4ed8',
    borderColor:     '#1d4ed8',
  },
  pillText: {
    color:      DARK.textMuted,
    fontSize:   13,
    fontWeight: '600',
  },
  pillTextActive: {
    color: '#FFFFFF',
  },
  resultRow: {
    flexDirection:     'row',
    alignItems:        'center',
    paddingHorizontal: 14,
    paddingVertical:   13,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: DARK.separator,
    gap:               12,
  },
  resultRowActive: {
    backgroundColor: 'rgba(29,78,216,0.12)',
  },
  resultTicker: {
    color:      DARK.textPrimary,
    fontSize:   14,
    fontWeight: '700',
    width:      58,
  },
  resultTickerActive: {
    color: '#60a5fa',
  },
  resultName: {
    color:    DARK.textMuted,
    fontSize: 13,
    flex:     1,
  },
  currentDot: {
    color:    '#60a5fa',
    fontSize: 8,
  },
  tickerDim: {
    color:   DARK.textMuted,
  },
  tickerMatch: {
    color:      DARK.textPrimary,
    fontWeight: '800',
  },
  empty: {
    paddingVertical:  40,
    alignItems:       'center',
  },
  emptyText: {
    color:    DARK.textMuted,
    fontSize: 13,
  },
});
