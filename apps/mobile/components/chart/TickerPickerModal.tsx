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

const POLYGON_API_KEY = process.env['EXPO_PUBLIC_POLYGON_API_KEY'] ?? '';

interface TickerResult {
  ticker: string;
  name:   string;
}

async function searchTickers(query: string): Promise<TickerResult[]> {
  if (!query || query.length < 1) return [];
  const url =
    `https://api.polygon.io/v3/reference/tickers` +
    `?search=${encodeURIComponent(query)}&active=true&limit=12&apiKey=${POLYGON_API_KEY}`;
  try {
    const res  = await fetch(url);
    if (!res.ok) return [];
    const json = await res.json() as { results?: TickerResult[] };
    const results = json.results ?? [];
    const upper = query.toUpperCase();
    return results.sort((a, b) => {
      const aRank = a.ticker === upper ? 0 : a.ticker.startsWith(upper) ? 1 : 2;
      const bRank = b.ticker === upper ? 0 : b.ticker.startsWith(upper) ? 1 : 2;
      return aRank - bRank;
    });
  } catch {
    return [];
  }
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

  // Debounced search
  const handleQueryChange = useCallback((v: string) => {
    setQuery(v);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!v.trim()) {
      setResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    debounceRef.current = setTimeout(async () => {
      const found = await searchTickers(v.trim());
      setResults(found);
      setSearching(false);
    }, 200);
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
    return (
      <TouchableOpacity
        style={[styles.resultRow, isCurrent && styles.resultRowActive]}
        onPress={() => handleSelect(item.ticker, item.name)}
        activeOpacity={0.7}
      >
        <Text style={[styles.resultTicker, isCurrent && styles.resultTickerActive]}>
          {item.ticker}
        </Text>
        <Text style={styles.resultName} numberOfLines={1}>{item.name}</Text>
        {isCurrent && <Text style={styles.currentDot}>●</Text>}
      </TouchableOpacity>
    );
  }, [currentTicker, handleSelect]);

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
                <Text style={styles.sectionLabel}>RESULTS</Text>
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
  empty: {
    paddingVertical:  40,
    alignItems:       'center',
  },
  emptyText: {
    color:    DARK.textMuted,
    fontSize: 13,
  },
});
