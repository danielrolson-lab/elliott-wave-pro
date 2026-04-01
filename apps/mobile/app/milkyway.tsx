/**
 * milkyway.tsx — Milky Way Setups screen
 * Shows top Elliott Wave setups across S&P 500 tickers.
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator, FlatList, Pressable, RefreshControl,
  ScrollView, StyleSheet, Text, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import { useMilkyWay } from '../hooks/useMilkyWay';
import { SetupCard } from '../components/milkyway/SetupCard';
import { useMarketDataStore } from '../stores/marketData';
import { useUIStore } from '../stores/ui';
import type { MilkyWaySetup } from '../stores/milkyway';
import type { RootTabParamList } from '../navigation/AppNavigator';
import { DARK } from '../theme/colors';

type TimeframeTab = '★' | '1m' | '5m' | '15m' | '30m' | '1h' | '4h' | '1D' | '1W';
const TIMEFRAMES: TimeframeTab[] = ['★', '1m', '5m', '15m', '30m', '1h', '4h', '1D', '1W'];

function TimestampText({ generatedAt, scanned }: { generatedAt?: string; scanned?: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 10_000);
    return () => clearInterval(id);
  }, []);
  if (!generatedAt) return null;
  const age = Math.floor((now - new Date(generatedAt).getTime()) / 60_000);
  const nextIn = Math.max(0, 15 - age);
  return (
    <Text style={styles.scanMeta}>
      Scanned {scanned ?? '—'} tickers · Updated {age}m ago · Next scan in {nextIn}m
    </Text>
  );
}

function TimeframeContent({ tf }: { tf: Exclude<TimeframeTab, '★'> }) {
  const { result, status, error, refresh } = useMilkyWay(tf);
  const navigation = useNavigation<BottomTabNavigationProp<RootTabParamList>>();
  const setActiveTicker = useMarketDataStore((s) => s.setActiveTicker);
  const setActiveTimeframe = useUIStore((s) => s.setActiveTimeframe);

  const handlePress = useCallback((setup: MilkyWaySetup) => {
    setActiveTicker(setup.ticker, { ticker: setup.ticker, name: setup.companyName } as any);
    setActiveTimeframe(setup.timeframe as any);
    navigation.navigate('Chart');
  }, [navigation, setActiveTicker, setActiveTimeframe]);

  if (status === 'loading' && !result) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={DARK.textSecondary} size="large" />
        <Text style={styles.scanningText}>Scanning {tf} charts across S&P 500…</Text>
      </View>
    );
  }

  if (status === 'error') {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>Scanner unavailable</Text>
        {error ? (
          <Text style={styles.errorDetail} numberOfLines={2}>{error}</Text>
        ) : null}
        <Pressable style={styles.retryBtn} onPress={() => refresh()}>
          <Text style={styles.retryText}>Tap to retry</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <FlatList
      data={result?.setups ?? []}
      keyExtractor={(item) => `${item.ticker}_${item.timeframe}`}
      renderItem={({ item, index }) => (
        <SetupCard setup={item} rank={index + 1} onPress={handlePress} />
      )}
      ListHeaderComponent={
        <TimestampText generatedAt={result?.generatedAt} scanned={result?.scanned} />
      }
      ListEmptyComponent={
        <View style={styles.center}>
          <Text style={styles.emptyText}>No high-confidence setups found on {tf}.</Text>
        </View>
      }
      contentContainerStyle={styles.listContent}
      refreshControl={<RefreshControl refreshing={status === 'loading'} onRefresh={() => refresh()} tintColor={DARK.textMuted} />}
    />
  );
}

function StarContent() {
  const [results, setResults] = useState<MilkyWaySetup[]>([]);
  const [loading, setLoading] = useState(true);
  const navigation = useNavigation<BottomTabNavigationProp<RootTabParamList>>();
  const setActiveTicker = useMarketDataStore((s) => s.setActiveTicker);
  const setActiveTimeframe = useUIStore((s) => s.setActiveTimeframe);

  const tf1 = useMilkyWay('5m');
  const tf2 = useMilkyWay('15m');
  const tf3 = useMilkyWay('1h');
  const tf4 = useMilkyWay('1D');

  useEffect(() => {
    const all = [
      ...(tf1.result?.setups ?? []),
      ...(tf2.result?.setups ?? []),
      ...(tf3.result?.setups ?? []),
      ...(tf4.result?.setups ?? []),
    ];
    // Dedup by ticker — keep highest confidence per ticker
    const byTicker = new Map<string, MilkyWaySetup>();
    for (const s of all) {
      const existing = byTicker.get(s.ticker);
      if (!existing || s.confidence > existing.confidence) byTicker.set(s.ticker, s);
    }
    const sorted = [...byTicker.values()].sort((a, b) => b.confidence - a.confidence).slice(0, 10);
    setResults(sorted);
    setLoading(tf1.status === 'loading' && tf2.status === 'loading');
  }, [tf1.result, tf2.result, tf3.result, tf4.result, tf1.status, tf2.status]);

  const handlePress = useCallback((setup: MilkyWaySetup) => {
    setActiveTicker(setup.ticker, { ticker: setup.ticker, name: setup.companyName } as any);
    setActiveTimeframe(setup.timeframe as any);
    navigation.navigate('Chart');
  }, [navigation, setActiveTicker, setActiveTimeframe]);

  if (loading && results.length === 0) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={DARK.textSecondary} size="large" />
        <Text style={styles.scanningText}>Scanning best setups across all timeframes…</Text>
      </View>
    );
  }

  return (
    <FlatList
      data={results}
      keyExtractor={(item) => item.ticker}
      renderItem={({ item, index }) => (
        <SetupCard setup={item} rank={index + 1} onPress={handlePress} showTimeframe />
      )}
      ListEmptyComponent={<View style={styles.center}><Text style={styles.emptyText}>No setups found yet.</Text></View>}
      contentContainerStyle={styles.listContent}
    />
  );
}

export function MilkyWayScreen() {
  const [activeTab, setActiveTab] = useState<TimeframeTab>('5m');

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title}>🌌 Milky Waves Setups</Text>
        <Text style={styles.subtitle}>Top Elliott Wave setups across S&P 500</Text>
        <Text style={styles.disclaimer}>Fast scan · positional heuristic · may differ from chart view</Text>
      </View>

      {/* Timeframe tabs */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tabScroll} contentContainerStyle={styles.tabRow}>
        {TIMEFRAMES.map((tf) => (
          <Pressable
            key={tf}
            style={[styles.tab, activeTab === tf && styles.tabActive]}
            onPress={() => setActiveTab(tf)}
          >
            <Text style={[styles.tabText, activeTab === tf && styles.tabTextActive]}>{tf}</Text>
          </Pressable>
        ))}
      </ScrollView>

      {/* Content */}
      <View style={styles.content}>
        {activeTab === '★' ? (
          <StarContent />
        ) : (
          <TimeframeContent tf={activeTab as Exclude<TimeframeTab, '★'>} />
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: DARK.background },
  header: { paddingHorizontal: 16, paddingTop: 4, paddingBottom: 8 },
  title: { color: DARK.textPrimary, fontSize: 20, fontWeight: '700' },
  subtitle: { color: DARK.textMuted, fontSize: 12, marginTop: 2 },
  disclaimer: { color: '#6b7280', fontSize: 10, marginTop: 2, fontStyle: 'italic' },
  tabScroll: { flexGrow: 0, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: DARK.separator },
  tabRow: { paddingHorizontal: 12, gap: 6, paddingBottom: 8 },
  tab: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 16, backgroundColor: DARK.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: DARK.border },
  tabActive: { backgroundColor: '#1d4ed8', borderColor: '#1d4ed8' },
  tabText: { color: DARK.textMuted, fontSize: 12, fontWeight: '700' },
  tabTextActive: { color: '#fff' },
  content: { flex: 1 },
  listContent: { padding: 12, paddingBottom: 40 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 60 },
  scanningText: { color: DARK.textMuted, fontSize: 13, marginTop: 12, textAlign: 'center' },
  emptyText: { color: DARK.textMuted, fontSize: 13, textAlign: 'center' },
  errorText: { color: '#ef5350', fontSize: 14, marginBottom: 4 },
  errorDetail: { color: DARK.textMuted, fontSize: 11, textAlign: 'center', paddingHorizontal: 24, marginBottom: 12 },
  retryBtn: { backgroundColor: DARK.surface, paddingHorizontal: 20, paddingVertical: 10, borderRadius: 8, borderWidth: StyleSheet.hairlineWidth, borderColor: DARK.border },
  retryText: { color: DARK.textSecondary, fontSize: 13, fontWeight: '600' },
  scanMeta: { color: DARK.textMuted, fontSize: 10, textAlign: 'center', paddingVertical: 8 },
});
