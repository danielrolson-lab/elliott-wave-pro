/**
 * HomeScreen (app/index.tsx)
 *
 * Layout:
 *   • Market status badge (OPEN / PRE-MARKET / AFTER-HOURS / CLOSED)
 *     with countdown timer to the next session boundary
 *   • Index strip: SPY, QQQ, IWM — price + percent change
 *   • Macro strip: VIX, 10Y, DXY — marked TODO: REPLACE WITH LIVE DATA
 */

import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import { useMarketDataStore } from '../stores/marketData';
import { useWatchlistStore } from '../stores/watchlist';
import { CHART_COLORS } from '../components/chart/chartTypes';
import { RegimeBadge } from '../components/common/RegimeBadge';
import { REGIME_META } from '../utils/regimeClassifier';
import type { RootTabParamList } from '../navigation/AppNavigator';
import type { MarketRegime } from '@elliott-wave-pro/wave-engine';

// ── Market hours (NYSE — ET, UTC-4 or UTC-5) ─────────────────────────────────

type MarketStatus = 'PRE-MARKET' | 'OPEN' | 'AFTER-HOURS' | 'CLOSED';

interface StatusInfo {
  status:     MarketStatus;
  label:      string;
  color:      string;
  nextLabel:  string;    // "Opens in" / "Closes in" / etc.
  nextMs:     number;    // ms until next boundary
}

function getEasternDate(d: Date): { h: number; m: number; dayOfWeek: number } {
  // Approximate ET — does not account for DST transitions intraday.
  // Convert UTC to ET (UTC-5 standard / UTC-4 daylight).
  // For simplicity, use the Intl API to get the hour in ET.
  const etStr = d.toLocaleString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: 'numeric', hour12: false, weekday: 'short' });
  // format: "Mon 09:30"
  const parts = etStr.split(' ');
  const weekdays: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const dayOfWeek = weekdays[parts[0]] ?? 1;
  const [hStr, mStr] = (parts[1] ?? '0:0').split(':');
  return { h: parseInt(hStr, 10), m: parseInt(mStr, 10), dayOfWeek };
}

function computeStatus(now: Date): StatusInfo {
  const { h, m, dayOfWeek } = getEasternDate(now);
  const etMinutes = h * 60 + m;

  const PRE_OPEN  = 4 * 60;       // 04:00 ET
  const OPEN      = 9 * 60 + 30;  // 09:30 ET
  const CLOSE     = 16 * 60;      // 16:00 ET
  const AFTER_END = 20 * 60;      // 20:00 ET

  const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

  if (isWeekend) {
    // Next session: Monday 09:30 ET
    const daysUntilMon = dayOfWeek === 6 ? 2 : 1;
    const nextOpen = new Date(now);
    nextOpen.setDate(nextOpen.getDate() + daysUntilMon);
    nextOpen.toLocaleString('en-US', { timeZone: 'America/New_York' }); // trigger tz
    return {
      status:    'CLOSED',
      label:     'CLOSED',
      color:     '#6E7681',
      nextLabel: 'Opens Mon',
      nextMs:    nextOpen.getTime() - now.getTime(),
    };
  }

  if (etMinutes < PRE_OPEN) {
    const msUntilPre = (PRE_OPEN - etMinutes) * 60_000;
    return { status: 'CLOSED', label: 'CLOSED', color: '#6E7681', nextLabel: 'Pre-market in', nextMs: msUntilPre };
  }
  if (etMinutes < OPEN) {
    const msUntilOpen = (OPEN - etMinutes) * 60_000;
    return { status: 'PRE-MARKET', label: 'PRE-MARKET', color: '#FF9800', nextLabel: 'Opens in', nextMs: msUntilOpen };
  }
  if (etMinutes < CLOSE) {
    const msUntilClose = (CLOSE - etMinutes) * 60_000;
    return { status: 'OPEN', label: 'OPEN', color: '#26A69A', nextLabel: 'Closes in', nextMs: msUntilClose };
  }
  if (etMinutes < AFTER_END) {
    const msUntilEnd = (AFTER_END - etMinutes) * 60_000;
    return { status: 'AFTER-HOURS', label: 'AFTER-HOURS', color: '#FF9800', nextLabel: 'Ends in', nextMs: msUntilEnd };
  }
  return { status: 'CLOSED', label: 'CLOSED', color: '#6E7681', nextLabel: 'Pre-market', nextMs: (24 * 60 - etMinutes + PRE_OPEN) * 60_000 };
}

function formatCountdown(ms: number): string {
  if (ms <= 0) return '0:00';
  const totalS = Math.floor(ms / 1000);
  const h      = Math.floor(totalS / 3600);
  const min    = Math.floor((totalS % 3600) / 60);
  const sec    = totalS % 60;
  if (h > 0) return `${h}h ${min}m`;
  return `${min}:${String(sec).padStart(2, '0')}`;
}

// ── Index strip data ──────────────────────────────────────────────────────────

const INDEX_TICKERS = ['SPY', 'QQQ', 'IWM'] as const;
const MACRO_ITEMS = [
  { label: 'VIX',  suffix: '' },
  { label: '10Y',  suffix: '%' },
  { label: 'DXY',  suffix: '' },
] as const;

const POLYGON_API_KEY = process.env['EXPO_PUBLIC_POLYGON_API_KEY'] ?? '';

interface SnapshotQuote { price: number; change: number }

interface PolygonTickerSnapshot {
  ticker:            string;
  todaysChangePerc?: number;
  day?:              { c?: number; o?: number };
  lastTrade?:        { p?: number };
  prevDay?:          { c?: number };
}

async function fetchIndexSnapshots(): Promise<Record<string, SnapshotQuote>> {
  if (!POLYGON_API_KEY) {
    console.warn('[HomeScreen] EXPO_PUBLIC_POLYGON_API_KEY not set');
    return {};
  }
  try {
    const url = `https://api.polygon.io/v2/snapshot/locale/us/markets/stocks/tickers?tickers=SPY,QQQ,IWM&apiKey=${POLYGON_API_KEY}`;
    const res  = await fetch(url);
    if (!res.ok) {
      console.warn('[HomeScreen] snapshot fetch failed:', res.status);
      return {};
    }
    const json = await res.json() as { tickers?: PolygonTickerSnapshot[] };
    const out: Record<string, SnapshotQuote> = {};
    for (const t of json.tickers ?? []) {
      // Priority: last trade > today's close > previous close
      const price = t.lastTrade?.p ?? t.day?.c ?? t.prevDay?.c ?? 0;
      const change = t.todaysChangePerc ?? 0;
      console.log(`[HomeScreen] ${t.ticker}: price=${price} change=${change}`);
      if (price > 0) out[t.ticker] = { price, change };
    }
    return out;
  } catch (e) {
    console.warn('[HomeScreen] snapshot fetch error:', e);
    return {};
  }
}

// ── Component ─────────────────────────────────────────────────────────────────

export function HomeScreen() {
  const navigation = useNavigation<BottomTabNavigationProp<RootTabParamList>>();
  const [statusInfo, setStatusInfo] = useState<StatusInfo>(() => computeStatus(new Date()));
  const [snapshots,  setSnapshots]  = useState<Record<string, SnapshotQuote>>({});
  const quotes         = useMarketDataStore((s) => s.quotes);
  const regimes        = useMarketDataStore((s) => s.regimes);
  const watchlistItems = useWatchlistStore((s) => s.items);

  // Tick every second for the countdown
  useEffect(() => {
    const id = setInterval(() => setStatusInfo(computeStatus(new Date())), 1000);
    return () => clearInterval(id);
  }, []);

  // BUG-015: fetch latest SPY/QQQ/IWM prices on mount (fallback when WS not connected)
  useEffect(() => {
    void fetchIndexSnapshots().then(setSnapshots);
  }, []);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* ── Screen header ── */}
      <View style={styles.screenHeader}>
        <Text style={styles.screenTitle}>Markets</Text>
        <Pressable
          style={styles.editBtn}
          onPress={() => navigation.navigate('Watchlist')}
          hitSlop={8}
        >
          <Text style={styles.editBtnText}>Edit</Text>
        </Pressable>
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>

        {/* ── Market status badge ── */}
        <View style={styles.statusRow}>
          <View style={[styles.statusBadge, { borderColor: statusInfo.color }]}>
            <View style={[styles.statusDot, { backgroundColor: statusInfo.color }]} />
            <Text style={[styles.statusText, { color: statusInfo.color }]}>
              {statusInfo.label}
            </Text>
          </View>
          <Text style={styles.countdownText}>
            {statusInfo.nextLabel} {formatCountdown(statusInfo.nextMs)}
          </Text>
        </View>

        {/* ── Index strip ── */}
        <Text style={styles.sectionHeader}>INDICES</Text>
        <View style={styles.stripRow}>
          {INDEX_TICKERS.map((ticker) => {
            const q = quotes[ticker];
            // Live WS quote takes precedence; fall back to Polygon REST snapshot
            const price  = q?.last         ?? snapshots[ticker]?.price  ?? null;
            const change = q?.changePercent ?? snapshots[ticker]?.change ?? null;
            const isPos  = (change ?? 0) >= 0;
            return (
              <View key={ticker} style={styles.stripCard}>
                <Text style={styles.stripTicker}>{ticker}</Text>
                <Text style={styles.stripPrice}>
                  {price !== null ? `$${price.toFixed(2)}` : '—'}
                </Text>
                <Text style={[styles.stripChange, { color: isPos ? CHART_COLORS.bullBody : CHART_COLORS.bearBody }]}>
                  {change !== null ? `${isPos ? '+' : ''}${change.toFixed(2)}%` : '—'}
                </Text>
              </View>
            );
          })}
        </View>

        {/* ── Regime strip ── */}
        {Object.keys(regimes).length > 0 && (
          <>
            <Text style={styles.sectionHeader}>REGIME</Text>
            <View style={styles.regimeRow}>
              {INDEX_TICKERS.map((ticker) => {
                const regime = regimes[ticker] as MarketRegime | undefined;
                if (!regime) return null;
                const meta = REGIME_META[regime];
                return (
                  <View key={ticker} style={[styles.regimeCard, { borderColor: meta.color }]}>
                    <Text style={styles.stripTicker}>{ticker}</Text>
                    <RegimeBadge ticker={ticker} size="md" />
                    <Text style={[styles.regimeDesc, { color: meta.color }]} numberOfLines={2}>
                      {meta.label}
                    </Text>
                  </View>
                );
              })}
            </View>
          </>
        )}

        {/* ── Macro strip ── */}
        <Text style={styles.sectionHeader}>MACRO</Text>
        <View style={styles.stripRow}>
          {MACRO_ITEMS.map(({ label, suffix }) => (
            <View key={label} style={styles.stripCard}>
              <Text style={styles.stripTicker}>{label}</Text>
              {/* TODO: REPLACE WITH LIVE DATA */}
              <Text style={styles.stripPrice}>—{suffix}</Text>
              <Text style={[styles.stripChange, { color: CHART_COLORS.textMuted }]}>—</Text>
            </View>
          ))}
        </View>

        {/* ── Watchlist preview ── */}
        {watchlistItems.length > 0 && (
          <>
            <View style={styles.watchlistHeader}>
              <Text style={styles.sectionHeader}>WATCHLIST</Text>
              <Pressable onPress={() => navigation.navigate('Watchlist')} hitSlop={8}>
                <Text style={styles.seeAllText}>See All</Text>
              </Pressable>
            </View>
            {watchlistItems.slice(0, 6).map((item) => {
              const q       = quotes[item.id];
              const price   = item.lastPrice ?? q?.last ?? null;
              const change  = item.changePercent ?? q?.changePercent ?? null;
              const isPos   = (change ?? 0) >= 0;
              return (
                <Pressable
                  key={item.id}
                  style={styles.watchlistRow}
                  onPress={() => navigation.navigate('Chart')}
                >
                  <View style={styles.watchlistLeft}>
                    <Text style={styles.watchlistTicker}>{item.id}</Text>
                    {item.waveLabel && (
                      <Text style={styles.watchlistWave}>W{item.waveLabel}</Text>
                    )}
                  </View>
                  <View style={styles.watchlistRight}>
                    <Text style={styles.watchlistPrice}>
                      {price !== null ? `$${price.toFixed(2)}` : '—'}
                    </Text>
                    <Text style={[styles.watchlistChange, { color: isPos ? CHART_COLORS.bullBody : CHART_COLORS.bearBody }]}>
                      {change !== null ? `${isPos ? '+' : ''}${change.toFixed(2)}%` : '—'}
                    </Text>
                  </View>
                </Pressable>
              );
            })}
          </>
        )}

      </ScrollView>
    </SafeAreaView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: {
    flex:            1,
    backgroundColor: CHART_COLORS.background,
  },

  // Screen header (title + Edit button)
  screenHeader: {
    flexDirection:     'row',
    alignItems:        'center',
    justifyContent:    'space-between',
    paddingHorizontal: 16,
    paddingVertical:   10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: CHART_COLORS.gridLine,
  },
  screenTitle: {
    color:      CHART_COLORS.textPrimary,
    fontSize:   18,
    fontWeight: '700',
  },
  editBtn: {
    paddingHorizontal: 12,
    paddingVertical:    5,
    borderRadius:       6,
    borderWidth:        1,
    borderColor:        CHART_COLORS.gridLine,
  },
  editBtnText: {
    color:      '#1d4ed8',
    fontSize:   13,
    fontWeight: '600',
  },

  scroll: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 14,
    paddingTop:        16,
    paddingBottom:     32,
  },
  statusRow: {
    flexDirection:  'row',
    alignItems:     'center',
    justifyContent: 'space-between',
    marginBottom:   20,
  },
  statusBadge: {
    flexDirection:  'row',
    alignItems:     'center',
    borderWidth:    1,
    borderRadius:   6,
    paddingHorizontal: 10,
    paddingVertical:    4,
    gap: 6,
  },
  statusDot: {
    width:        7,
    height:       7,
    borderRadius: 4,
  },
  statusText: {
    fontSize:   12,
    fontWeight: '700',
    letterSpacing: 0.8,
  },
  countdownText: {
    color:    CHART_COLORS.textMuted,
    fontSize: 12,
  },
  sectionHeader: {
    color:         CHART_COLORS.textMuted,
    fontSize:      10,
    fontWeight:    '700',
    letterSpacing: 1.2,
    marginBottom:  8,
    marginTop:     4,
  },
  stripRow: {
    flexDirection:  'row',
    gap:            10,
    marginBottom:   20,
  },
  stripCard: {
    flex:            1,
    backgroundColor: '#161B22',
    borderRadius:    8,
    padding:         12,
    borderWidth:     1,
    borderColor:     CHART_COLORS.gridLine,
    gap:             2,
  },
  stripTicker: {
    color:      CHART_COLORS.textMuted,
    fontSize:   10,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  stripPrice: {
    color:      CHART_COLORS.textPrimary,
    fontSize:   15,
    fontWeight: '600',
    marginTop:  2,
  },
  stripChange: {
    fontSize:   12,
    fontWeight: '500',
  },
  regimeRow: {
    flexDirection: 'row',
    gap:           10,
    marginBottom:  20,
  },
  regimeCard: {
    flex:            1,
    backgroundColor: '#161B22',
    borderRadius:    8,
    padding:         10,
    borderWidth:     1,
    gap:             4,
  },
  regimeDesc: {
    fontSize:   9,
    fontWeight: '500',
    marginTop:  2,
  },

  // Watchlist preview
  watchlistHeader: {
    flexDirection:  'row',
    alignItems:     'center',
    justifyContent: 'space-between',
    marginBottom:   8,
  },
  seeAllText: {
    color:    '#1d4ed8',
    fontSize: 12,
    fontWeight: '600',
  },
  watchlistRow: {
    flexDirection:     'row',
    alignItems:        'center',
    justifyContent:    'space-between',
    backgroundColor:   '#161B22',
    borderRadius:       8,
    paddingHorizontal: 14,
    paddingVertical:   11,
    marginBottom:       8,
    borderWidth:        1,
    borderColor:        CHART_COLORS.gridLine,
  },
  watchlistLeft: {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           8,
  },
  watchlistTicker: {
    color:      CHART_COLORS.textPrimary,
    fontSize:   14,
    fontWeight: '700',
  },
  watchlistWave: {
    color:      CHART_COLORS.textMuted,
    fontSize:   11,
    fontWeight: '500',
  },
  watchlistRight: {
    alignItems: 'flex-end',
  },
  watchlistPrice: {
    color:      CHART_COLORS.textPrimary,
    fontSize:   14,
    fontWeight: '600',
  },
  watchlistChange: {
    fontSize:   12,
    fontWeight: '500',
  },
});
