/**
 * WatchlistScreen (app/watchlist.tsx)
 *
 * Features:
 *   • Search bar with 200 ms debounce → Polygon ticker search API autocomplete
 *   • WatchlistCard per saved ticker:
 *       ticker + company name, current price, % change today
 *       wave label from waveCount store, probability bar (Skia-free — RN View)
 *       30-candle sparkline (Skia Canvas)
 *       border color: green = bullish primary, red = bearish, amber = neutral
 *   • Swipe left to delete (RNGH + Reanimated)
 *   • Long press + drag to reorder
 *   • MMKV persistence on every store change
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  type ListRenderItemInfo,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  runOnJS,
} from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { Canvas, Path, Skia } from '@shopify/react-native-skia';
import { MMKV } from 'react-native-mmkv';
import { useWatchlistStore, type WatchlistItem } from '../stores/watchlist';
import { useWaveCountStore } from '../stores/waveCount';
import { useMarketDataStore } from '../stores/marketData';
import { CHART_COLORS } from '../components/chart/chartTypes';
import type { Instrument } from '@elliott-wave-pro/wave-engine';
import { getLeveragedSpec, decayColor, decaySeverity, computeDecay } from '../utils/etfDecayEngine';

// ── MMKV storage ─────────────────────────────────────────────────────────────

const storage = new MMKV({ id: 'watchlist-v1' });
const STORAGE_KEY = 'items';

function persistItems(items: WatchlistItem[]): void {
  storage.set(STORAGE_KEY, JSON.stringify(items));
}

function loadPersistedItems(): WatchlistItem[] | null {
  const raw = storage.getString(STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as WatchlistItem[];
  } catch {
    return null;
  }
}

// ── Polygon ticker search ─────────────────────────────────────────────────────

const POLYGON_BASE = 'https://api.polygon.io';

// API key should come from your .env / config.
// Set EXPO_PUBLIC_POLYGON_API_KEY in your .env file.
const POLYGON_API_KEY = process.env['EXPO_PUBLIC_POLYGON_API_KEY'] ?? '';

interface PolygonTickerResult {
  ticker: string;
  name:   string;
  market: string;
  type:   string;
}

async function searchTickers(query: string): Promise<PolygonTickerResult[]> {
  if (!query || query.length < 1) return [];
  const url = `${POLYGON_BASE}/v3/reference/tickers?search=${encodeURIComponent(query)}&active=true&limit=10&apiKey=${POLYGON_API_KEY}`;
  try {
    const res = await fetch(url);
    if (!res.ok) return [];
    const json = await res.json() as { results?: PolygonTickerResult[] };
    return json.results ?? [];
  } catch {
    return [];
  }
}

// ── Sparkline (30-candle Skia line) ─────────────────────────────────────────

const SPARK_W = 80;
const SPARK_H = 36;

interface SparklineProps {
  prices: number[];
}

function Sparkline({ prices }: SparklineProps) {
  if (prices.length < 2) {
    return <View style={{ width: SPARK_W, height: SPARK_H }} />;
  }

  const minP = Math.min(...prices);
  const maxP = Math.max(...prices);
  const range = maxP - minP || 1;
  const stepX = SPARK_W / (prices.length - 1);

  const path = Skia.Path.Make();
  prices.forEach((p, i) => {
    const x = i * stepX;
    const y = SPARK_H - ((p - minP) / range) * (SPARK_H - 4) - 2;
    if (i === 0) path.moveTo(x, y);
    else         path.lineTo(x, y);
  });

  const isUp = prices[prices.length - 1] >= prices[0];
  const color = isUp ? 'rgba(38,166,154,0.9)' : 'rgba(239,83,80,0.9)';

  return (
    <Canvas style={{ width: SPARK_W, height: SPARK_H }}>
      <Path path={path} style="stroke" strokeWidth={1.5} color={color} />
    </Canvas>
  );
}

// ── Probability bar ───────────────────────────────────────────────────────────

interface ProbBarProps {
  probability: number;  // 0–1
  isBullish:   boolean;
}

function ProbabilityBar({ probability, isBullish }: ProbBarProps) {
  const fillColor = isBullish ? CHART_COLORS.bullBody : CHART_COLORS.bearBody;
  return (
    <View style={probStyles.track}>
      <View style={[probStyles.fill, { width: `${Math.round(probability * 100)}%` as `${number}%`, backgroundColor: fillColor }]} />
      <Text style={probStyles.label}>{Math.round(probability * 100)}%</Text>
    </View>
  );
}

const probStyles = StyleSheet.create({
  track: {
    height:          4,
    backgroundColor: '#1E2530',
    borderRadius:    2,
    overflow:        'hidden',
    marginTop:       4,
    position:        'relative',
  },
  fill: {
    height:       '100%',
    borderRadius: 2,
  },
  label: {
    position:   'absolute',
    right:      0,
    top:        -14,
    fontSize:   9,
    color:      CHART_COLORS.textMuted,
  },
});

// ── WatchlistCard ─────────────────────────────────────────────────────────────

interface WatchlistCardProps {
  item:      WatchlistItem;
  onDelete:  (id: string) => void;
  onDragStart: (id: string) => void;
  isDragging: boolean;
}

function WatchlistCard({ item, onDelete, onDragStart, isDragging }: WatchlistCardProps) {
  const waveCounts = useWaveCountStore((s) => s.counts[`${item.id}_5m`]);
  const posteriors = useWaveCountStore((s) => s.posteriors);
  const quote      = useMarketDataStore((s) => s.quotes[item.id]);

  // Leveraged ETF decay flag
  const candles5m    = useMarketDataStore((s) => s.candles[`${item.id}_5m`]);
  const leveragedSpec = getLeveragedSpec(item.id);
  const decayResult   = leveragedSpec && candles5m && candles5m.length >= 5
    ? computeDecay(leveragedSpec, candles5m)
    : null;
  const decayBadgeColor = decayResult ? decayColor(decaySeverity(decayResult)) : null;

  const primaryCount = waveCounts?.[0] ?? null;
  // Bullish = first wave in the count moves up
  const isBullish = primaryCount
    ? (primaryCount.allWaves[0]?.startPivot.price ?? 0) <
      (primaryCount.allWaves[0]?.endPivot?.price ?? Infinity)
    : true;
  // WavePosterior.posterior holds the probability (0–1)
  const probability = primaryCount ? (posteriors[primaryCount.id]?.posterior ?? 0.5) : 0.5;

  // Determine border color
  let borderColor = '#FF9800'; // amber = neutral
  if (primaryCount) {
    borderColor = isBullish ? CHART_COLORS.bullBody : CHART_COLORS.bearBody;
  }

  // Wave label: label of the current (in-progress) wave
  const waveLabel = item.waveLabel ?? (primaryCount ? primaryCount.currentWave.label : '—');

  // Price data from quote or snapshot
  const price  = quote?.last        ?? item.lastPrice;
  const change = quote?.changePercent ?? item.changePercent;

  // Sparkline: use marketData 5m candles, last 30
  const candles = useMarketDataStore((s) => s.candles[`${item.id}_5m`]);
  const sparkPrices = (candles ?? []).slice(-30).map((c) => c.close);

  // Swipe-to-delete
  const translateX = useSharedValue(0);
  const SWIPE_THRESHOLD = -80;
  const CARD_H = 88;

  const swipeGesture = Gesture.Pan()
    .activeOffsetX([-10, 10])
    .onUpdate((e) => {
      'worklet';
      if (e.translationX < 0) translateX.value = e.translationX;
    })
    .onEnd((e) => {
      'worklet';
      if (e.translationX < SWIPE_THRESHOLD) {
        translateX.value = withTiming(-300, { duration: 200 }, () => {
          runOnJS(onDelete)(item.id);
        });
      } else {
        translateX.value = withTiming(0);
      }
    });

  const animStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
  }));

  // Long press for drag
  const longPressGesture = Gesture.LongPress()
    .minDuration(400)
    .onStart(() => {
      'worklet';
      runOnJS(onDragStart)(item.id);
    });

  const composed = Gesture.Exclusive(longPressGesture, swipeGesture);

  return (
    <View style={[cardStyles.outer, { height: CARD_H, opacity: isDragging ? 0.4 : 1 }]}>
      {/* Delete background */}
      <View style={cardStyles.deleteBackground}>
        <Text style={cardStyles.deleteText}>Delete</Text>
      </View>

      {/* Card content (swipeable) */}
      <GestureDetector gesture={composed}>
        <Animated.View style={[cardStyles.card, { borderLeftColor: borderColor }, animStyle]}>
          {/* Left: ticker + wave label */}
          <View style={cardStyles.left}>
            <Text style={cardStyles.ticker}>{item.instrument.ticker}</Text>
            <Text style={cardStyles.name} numberOfLines={1}>{item.instrument.name}</Text>
            <View style={cardStyles.waveBadge}>
              <Text style={cardStyles.waveLabel}>{waveLabel}</Text>
            </View>
            {decayBadgeColor && (
              <View style={[cardStyles.decayBadge, { borderColor: decayBadgeColor }]}>
                <Text style={[cardStyles.decayBadgeText, { color: decayBadgeColor }]}>
                  ⚠ {decayResult!.leverage > 0 ? '' : '−'}{Math.abs(decayResult!.leverage)}× DECAY
                </Text>
              </View>
            )}
          </View>

          {/* Center: price + change + prob bar */}
          <View style={cardStyles.center}>
            <Text style={cardStyles.price}>
              {price !== null ? `$${price.toFixed(2)}` : '—'}
            </Text>
            <Text style={[cardStyles.change, { color: (change ?? 0) >= 0 ? CHART_COLORS.bullBody : CHART_COLORS.bearBody }]}>
              {change !== null ? `${change >= 0 ? '+' : ''}${change.toFixed(2)}%` : '—'}
            </Text>
            <ProbabilityBar probability={probability} isBullish={isBullish} />
          </View>

          {/* Right: sparkline */}
          <View style={cardStyles.right}>
            <Sparkline prices={sparkPrices} />
          </View>
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

const cardStyles = StyleSheet.create({
  outer: {
    marginHorizontal: 12,
    marginVertical:    5,
    borderRadius:      8,
    overflow:          'hidden',
    position:          'relative',
  },
  deleteBackground: {
    position:        'absolute',
    right:           0,
    top:             0,
    bottom:          0,
    width:           80,
    backgroundColor: CHART_COLORS.bearBody,
    justifyContent:  'center',
    alignItems:      'center',
    borderRadius:    8,
  },
  deleteText: {
    color:      '#FFF',
    fontSize:   13,
    fontWeight: '600',
  },
  card: {
    flexDirection:   'row',
    alignItems:      'center',
    backgroundColor: '#161B22',
    borderRadius:    8,
    borderWidth:     1,
    borderColor:     CHART_COLORS.gridLine,
    borderLeftWidth: 3,
    paddingHorizontal: 12,
    paddingVertical:   10,
    gap:             10,
    flex:            1,
  },
  left: {
    width: 80,
    gap:   2,
  },
  ticker: {
    color:      CHART_COLORS.textPrimary,
    fontSize:   15,
    fontWeight: '700',
  },
  name: {
    color:    CHART_COLORS.textMuted,
    fontSize: 10,
  },
  waveBadge: {
    backgroundColor: '#1E2530',
    borderRadius:    4,
    paddingHorizontal: 5,
    paddingVertical:   2,
    alignSelf:       'flex-start',
    marginTop:       2,
  },
  waveLabel: {
    color:      CHART_COLORS.ema21,
    fontSize:   10,
    fontWeight: '600',
  },
  decayBadge: {
    borderWidth:  1,
    borderRadius: 3,
    paddingHorizontal: 4,
    paddingVertical:   1,
    alignSelf:   'flex-start',
    marginTop:   2,
  },
  decayBadgeText: {
    fontSize:  8,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  center: {
    flex: 1,
    gap:  2,
  },
  price: {
    color:      CHART_COLORS.textPrimary,
    fontSize:   16,
    fontWeight: '600',
  },
  change: {
    fontSize:   12,
    fontWeight: '500',
  },
  right: {
    alignItems: 'flex-end',
  },
});

// ── Search bar ────────────────────────────────────────────────────────────────

interface SearchBarProps {
  value:    string;
  onChange: (v: string) => void;
}

function SearchBar({ value, onChange }: SearchBarProps) {
  return (
    <View style={searchStyles.wrapper}>
      <Text style={searchStyles.icon}>⌕</Text>
      <TextInput
        style={searchStyles.input}
        value={value}
        onChangeText={onChange}
        placeholder="Search tickers…"
        placeholderTextColor={CHART_COLORS.textMuted}
        autoCapitalize="characters"
        autoCorrect={false}
        returnKeyType="search"
        clearButtonMode="while-editing"
      />
    </View>
  );
}

const searchStyles = StyleSheet.create({
  wrapper: {
    flexDirection:   'row',
    alignItems:      'center',
    backgroundColor: '#161B22',
    borderRadius:    8,
    borderWidth:     1,
    borderColor:     CHART_COLORS.gridLine,
    marginHorizontal: 12,
    marginBottom:    12,
    paddingHorizontal: 10,
    paddingVertical:   8,
    gap: 6,
  },
  icon: {
    color:    CHART_COLORS.textMuted,
    fontSize: 16,
  },
  input: {
    flex:     1,
    color:    CHART_COLORS.textPrimary,
    fontSize: 14,
    padding:  0,
  },
});

// ── Autocomplete dropdown ─────────────────────────────────────────────────────

interface AutocompleteDropdownProps {
  results: PolygonTickerResult[];
  onSelect: (result: PolygonTickerResult) => void;
}

function AutocompleteDropdown({ results, onSelect }: AutocompleteDropdownProps) {
  if (results.length === 0) return null;
  return (
    <View style={dropdownStyles.container}>
      {results.map((r) => (
        <TouchableOpacity
          key={r.ticker}
          style={dropdownStyles.row}
          onPress={() => onSelect(r)}
          activeOpacity={0.7}
        >
          <Text style={dropdownStyles.ticker}>{r.ticker}</Text>
          <Text style={dropdownStyles.name} numberOfLines={1}>{r.name}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

const dropdownStyles = StyleSheet.create({
  container: {
    position:        'absolute',
    top:             60,   // below search bar
    left:            12,
    right:           12,
    backgroundColor: '#1C2128',
    borderRadius:    8,
    borderWidth:     1,
    borderColor:     CHART_COLORS.gridLine,
    zIndex:          100,
    elevation:       8,
    shadowColor:     '#000',
    shadowOpacity:   0.4,
    shadowRadius:    8,
    shadowOffset:    { width: 0, height: 4 },
  },
  row: {
    flexDirection:   'row',
    alignItems:      'center',
    paddingHorizontal: 12,
    paddingVertical:   10,
    borderBottomWidth: 1,
    borderBottomColor: CHART_COLORS.gridLine,
    gap: 10,
  },
  ticker: {
    color:      CHART_COLORS.textPrimary,
    fontSize:   13,
    fontWeight: '600',
    width:      52,
  },
  name: {
    color:    CHART_COLORS.textMuted,
    fontSize: 12,
    flex:     1,
  },
});

// ── WatchlistScreen ───────────────────────────────────────────────────────────

export function WatchlistScreen() {
  const { items, addItem, removeItem, reorderItems } = useWatchlistStore();

  const [query, setQuery]               = useState('');
  const [suggestions, setSuggestions]   = useState<PolygonTickerResult[]>([]);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [draggingId, setDraggingId]     = useState<string | null>(null);
  const dragTargetRef = useRef<number | null>(null);

  // ── Load persisted items on mount ─────────────────────────────────────────
  useEffect(() => {
    const saved = loadPersistedItems();
    if (saved && saved.length > 0) {
      const existingIds = new Set(items.map((i) => i.id));
      for (const item of saved) {
        if (!existingIds.has(item.id)) {
          addItem(item.instrument);
        }
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Persist on every items change ─────────────────────────────────────────
  useEffect(() => {
    persistItems(items);
  }, [items]);

  // ── Debounced search ──────────────────────────────────────────────────────
  const handleQueryChange = useCallback((v: string) => {
    setQuery(v);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!v.trim()) { setSuggestions([]); return; }
    debounceRef.current = setTimeout(async () => {
      const results = await searchTickers(v.trim());
      setSuggestions(results);
    }, 200);
  }, []);

  const handleSelectSuggestion = useCallback((result: PolygonTickerResult) => {
    const instrument: Instrument = {
      ticker:   result.ticker,
      name:     result.name,
      exchange: '',
      type:     'equity',
    };
    addItem(instrument);
    setQuery('');
    setSuggestions([]);
  }, [addItem]);

  // ── Drag to reorder ───────────────────────────────────────────────────────
  const handleDragStart = useCallback((id: string) => {
    setDraggingId(id);
  }, []);

  const handleDragEnd = useCallback((toIndex: number) => {
    if (draggingId === null) return;
    const fromIndex = items.findIndex((i) => i.id === draggingId);
    if (fromIndex !== -1 && fromIndex !== toIndex) {
      reorderItems(fromIndex, toIndex);
    }
    setDraggingId(null);
    dragTargetRef.current = null;
  }, [draggingId, items, reorderItems]);

  // ── Render ────────────────────────────────────────────────────────────────
  const renderItem = useCallback(({ item, index }: ListRenderItemInfo<WatchlistItem>) => (
    <TouchableOpacity
      activeOpacity={1}
      onLongPress={() => handleDragStart(item.id)}
      onPressOut={() => {
        if (draggingId === item.id) {
          const target = dragTargetRef.current ?? index;
          handleDragEnd(target);
        }
      }}
    >
      <WatchlistCard
        item={item}
        onDelete={removeItem}
        onDragStart={handleDragStart}
        isDragging={draggingId === item.id}
      />
    </TouchableOpacity>
  ), [draggingId, removeItem, handleDragStart, handleDragEnd]);

  const keyExtractor = useCallback((item: WatchlistItem) => item.id, []);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.root}>

        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Watchlist</Text>
          <Text style={styles.headerCount}>{items.length} tickers</Text>
        </View>

        {/* Search bar */}
        <SearchBar value={query} onChange={handleQueryChange} />

        {/* Autocomplete dropdown (absolute, overlays list) */}
        <AutocompleteDropdown results={suggestions} onSelect={handleSelectSuggestion} />

        {/* Watchlist items */}
        {items.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyIcon}>☆</Text>
            <Text style={styles.emptyTitle}>No tickers yet</Text>
            <Text style={styles.emptyBody}>Search for a ticker above to add it to your watchlist.</Text>
          </View>
        ) : (
          <FlatList
            data={items}
            keyExtractor={keyExtractor}
            renderItem={renderItem}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.list}
          />
        )}
      </View>
    </SafeAreaView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: {
    flex:            1,
    backgroundColor: CHART_COLORS.background,
  },
  root: {
    flex: 1,
  },
  header: {
    flexDirection:   'row',
    alignItems:      'baseline',
    paddingHorizontal: 14,
    paddingTop:      16,
    paddingBottom:   12,
    gap:             8,
  },
  headerTitle: {
    color:      CHART_COLORS.textPrimary,
    fontSize:   22,
    fontWeight: '700',
  },
  headerCount: {
    color:    CHART_COLORS.textMuted,
    fontSize: 12,
  },
  list: {
    paddingBottom: 32,
  },
  empty: {
    flex:           1,
    alignItems:     'center',
    justifyContent: 'center',
    gap:            8,
    paddingHorizontal: 40,
  },
  emptyIcon: {
    fontSize: 36,
    color:    CHART_COLORS.textMuted,
  },
  emptyTitle: {
    color:      CHART_COLORS.textPrimary,
    fontSize:   16,
    fontWeight: '600',
  },
  emptyBody: {
    color:     CHART_COLORS.textMuted,
    fontSize:  13,
    textAlign: 'center',
  },
});
