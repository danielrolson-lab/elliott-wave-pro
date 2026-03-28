/**
 * FlowScreen (app/flow.tsx)
 *
 * The Flow tab hosts two sub-views:
 *
 *   [Flow] — real-time unusual options activity tape (D5)
 *   [Chain] — options chain + IV surface (D4)
 *
 * The Flow tab is the live tape with filter bar.
 * The Chain tab re-uses the D4 OptionsScreen content inline.
 *
 * Header shows:
 *   - Live / Error / Loading status dot
 *   - Last-fetch timestamp ("Updated 12s ago")
 *   - Count of visible prints after filter
 */

import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFlowFeed }    from '../hooks/useFlowFeed';
import { useOptionsChain } from '../hooks/useOptionsChain';
import { useFlowStore, applyFlowFilter } from '../stores/flow';
import { useWatchlistStore } from '../stores/watchlist';
import { FlowFilterBar }  from '../components/flow/FlowFilterBar';
import { FlowFeedList }   from '../components/flow/FlowFeedList';
import { OptionsChain }   from '../components/options/OptionsChain';
import { IVSurface }      from '../components/options/IVSurface';
import { DARK }           from '../theme/colors';
import { DataDelayFooter } from '../components/common/DataDelayFooter';
import { useTheme }        from '../theme/ThemeContext';

const ACTIVE_TICKER = 'SPY';
const FALLBACK_TICKERS = ['SPY', 'QQQ', 'AAPL', 'TSLA', 'NVDA', 'MSFT', 'AMZN', 'META', 'GS'];

type FlowTab = 'flow' | 'chain' | 'surface';

// ── Status dot ────────────────────────────────────────────────────────────────

const STATUS_COLOR = {
  idle:    '#6E7681',
  loading: '#FFA726',
  live:    '#66BB6A',
  error:   '#EF5350',
} as const;

function useRelativeTime(ms: number): string {
  const delta = Math.round((Date.now() - ms) / 1000);
  if (ms === 0)      return 'never';
  if (delta < 5)     return 'just now';
  if (delta < 60)    return `${delta}s ago`;
  return `${Math.round(delta / 60)}m ago`;
}

// ── Screen ────────────────────────────────────────────────────────────────────

export function FlowScreen() {
  const theme = useTheme();
  const [tab, setTab] = useState<FlowTab>('flow');

  // Pass watchlist tickers to flow feed so user's holdings are always included
  const watchlistItems   = useWatchlistStore((s) => s.items);
  const watchlistTickers = watchlistItems.map((i) => i.id);
  const extraTickers     = watchlistTickers.length > 0 ? watchlistTickers : FALLBACK_TICKERS;

  // Flow feed hook (polls every 30s)
  const { status: flowStatus, error: flowError, refresh } = useFlowFeed(extraTickers);

  // Options chain (fetched once on mount, refresh on demand)
  const { status: chainStatus, error: chainError } = useOptionsChain(ACTIVE_TICKER);

  // Derived counts for header
  const prints    = useFlowStore((s) => s.prints);
  const filter    = useFlowStore((s) => s.filter);
  const lastFetch = useFlowStore((s) => s.lastFetch);
  const visible   = applyFlowFilter(prints, filter);
  const updatedAt = useRelativeTime(lastFetch);

  const isRefreshing = flowStatus === 'loading';

  const handleRefresh = useCallback(() => { void refresh(); }, [refresh]);

  const statusColor = STATUS_COLOR[flowStatus];

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.background }]} edges={['top']}>
      <View style={[styles.container, { backgroundColor: theme.background }]}>

        {/* ── Header ── */}
        <View style={[styles.header, { borderBottomColor: theme.separator }]}>
          <View style={styles.headerLeft}>
            <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
            <Text style={[styles.headerTitle, { color: theme.textPrimary }]}>Options Flow</Text>
          </View>
          <View style={styles.headerRight}>
            {tab === 'flow' && flowStatus !== 'error' && (
              <Text style={styles.headerMeta}>
                {visible.length} prints · {updatedAt}
              </Text>
            )}
            {tab === 'flow' && flowStatus === 'error' && (
              <Text style={[styles.headerMeta, { color: STATUS_COLOR.error }]} numberOfLines={1}>
                {flowError ?? 'Fetch error'}
              </Text>
            )}
          </View>
        </View>

        {/* ── Tab row ── */}
        <View style={[styles.tabRow, { borderBottomColor: theme.separator }]}>
          {(['flow', 'chain', 'surface'] as FlowTab[]).map((t) => (
            <Pressable
              key={t}
              style={[styles.tab, tab === t && styles.tabActive]}
              onPress={() => setTab(t)}
              hitSlop={6}
            >
              <Text style={[styles.tabText, tab === t && styles.tabTextActive]}>
                {t === 'flow' ? 'Flow' : t === 'chain' ? 'Chain' : 'IV Surface'}
              </Text>
            </Pressable>
          ))}
        </View>

        {/* ── Flow tape ── */}
        {tab === 'flow' && (
          <View style={styles.flex}>
            <FlowFilterBar />
            <FlowFeedList onRefresh={handleRefresh} isRefreshing={isRefreshing} />
            <DataDelayFooter ticker={ACTIVE_TICKER} timeframe="5m" />
          </View>
        )}

        {/* ── Options chain ── */}
        {tab === 'chain' && (
          <View style={styles.flex}>
            {chainStatus === 'loading' && (
              <View style={styles.center}>
                <ActivityIndicator size="large" color="#1d4ed8" />
                <Text style={styles.loadingText}>Loading options chain…</Text>
              </View>
            )}
            {chainStatus === 'error' && (
              <View style={styles.center}>
                <Text style={styles.errorText}>Failed to load options chain</Text>
                <Text style={styles.errorDetail}>{chainError}</Text>
              </View>
            )}
            {(chainStatus === 'success' || chainStatus === 'idle') && (
              <OptionsChain ticker={ACTIVE_TICKER} />
            )}
          </View>
        )}

        {/* ── IV Surface ── */}
        {tab === 'surface' && (
          <View style={styles.flex}>
            {chainStatus === 'loading' && (
              <View style={styles.center}>
                <ActivityIndicator size="large" color="#1d4ed8" />
                <Text style={styles.loadingText}>Loading IV data…</Text>
              </View>
            )}
            {chainStatus === 'error' && (
              <View style={styles.center}>
                <Text style={styles.errorText}>Failed to load IV surface</Text>
                <Text style={styles.errorDetail}>{chainError}</Text>
              </View>
            )}
            {(chainStatus === 'success' || chainStatus === 'idle') && (
              <ScrollView showsVerticalScrollIndicator={false}>
                <IVSurface ticker={ACTIVE_TICKER} />
              </ScrollView>
            )}
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: {
    flex:            1,
    backgroundColor: DARK.background,
  },
  container: {
    flex:            1,
    backgroundColor: DARK.background,
  },
  flex: {
    flex: 1,
  },

  // Header
  header: {
    flexDirection:     'row',
    alignItems:        'center',
    justifyContent:    'space-between',
    paddingHorizontal: 12,
    paddingVertical:   8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: DARK.separator,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           7,
  },
  statusDot: {
    width:        7,
    height:       7,
    borderRadius: 3.5,
  },
  headerTitle: {
    color:      DARK.textPrimary,
    fontSize:   16,
    fontWeight: '700',
  },
  headerRight: {},
  headerMeta: {
    color:    DARK.textMuted,
    fontSize: 11,
  },

  // Tab row
  tabRow: {
    flexDirection:     'row',
    paddingHorizontal: 12,
    paddingVertical:   6,
    gap:               8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: DARK.separator,
  },
  tab: {
    paddingHorizontal: 14,
    paddingVertical:    5,
    borderRadius:       4,
    borderWidth:        1,
    borderColor:        DARK.border,
  },
  tabActive: {
    backgroundColor: '#1d4ed8',
    borderColor:     '#1d4ed8',
  },
  tabText: {
    color:      DARK.textMuted,
    fontSize:   12,
    fontWeight: '600',
  },
  tabTextActive: {
    color: '#FFFFFF',
  },

  // Loading / error states
  center: {
    flex:           1,
    alignItems:     'center',
    justifyContent: 'center',
    gap:            8,
    padding:        24,
  },
  loadingText: {
    color:    DARK.textMuted,
    fontSize: 13,
  },
  errorText: {
    color:      STATUS_COLOR.error,
    fontSize:   14,
    fontWeight: '600',
    textAlign:  'center',
  },
  errorDetail: {
    color:     DARK.textMuted,
    fontSize:  11,
    textAlign: 'center',
  },
});
