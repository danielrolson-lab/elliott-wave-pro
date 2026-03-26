/**
 * OptionsScreen (app/options.tsx)
 *
 * Full options chain + IV surface for the active ticker.
 * Hosts OptionsChain (strike ladder) above IVSurface (term structure + skew),
 * separated by a swipeable tab row so the user can switch between views.
 */

import React, { useState } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useOptionsChain }  from '../hooks/useOptionsChain';
import { OptionsChain }     from '../components/options/OptionsChain';
import { IVSurface }        from '../components/options/IVSurface';
import { DARK }             from '../theme/colors';

const ACTIVE_TICKER = 'SPY';

type OptionTab = 'chain' | 'surface';

export function OptionsScreen() {
  const [tab, setTab] = useState<OptionTab>('chain');
  const { status, error, refresh } = useOptionsChain(ACTIVE_TICKER);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.container}>

        {/* ── Header ── */}
        <View style={styles.header}>
          <Text style={styles.ticker}>{ACTIVE_TICKER} Options</Text>
          {status === 'loading' && (
            <ActivityIndicator size="small" color={DARK.textMuted} />
          )}
        </View>

        {/* ── Tab row ── */}
        <View style={styles.tabRow}>
          {(['chain', 'surface'] as OptionTab[]).map((t) => (
            <Pressable
              key={t}
              style={[styles.tab, tab === t && styles.tabActive]}
              onPress={() => setTab(t)}
              hitSlop={6}
            >
              <Text style={[styles.tabText, tab === t && styles.tabTextActive]}>
                {t === 'chain' ? 'Chain' : 'IV Surface'}
              </Text>
            </Pressable>
          ))}
        </View>

        {/* ── Error state ── */}
        {status === 'error' && (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{error ?? 'Failed to load options'}</Text>
            <Pressable onPress={() => void refresh()} hitSlop={8}>
              <Text style={styles.retryText}>Retry</Text>
            </Pressable>
          </View>
        )}

        {/* ── Content ── */}
        {tab === 'chain' ? (
          <OptionsChain ticker={ACTIVE_TICKER} />
        ) : (
          <ScrollView showsVerticalScrollIndicator={false}>
            <IVSurface ticker={ACTIVE_TICKER} />
          </ScrollView>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex:            1,
    backgroundColor: DARK.background,
  },
  container: {
    flex:            1,
    backgroundColor: DARK.background,
  },
  header: {
    flexDirection:  'row',
    alignItems:     'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical:    8,
    borderBottomWidth:  StyleSheet.hairlineWidth,
    borderBottomColor:  DARK.separator,
  },
  ticker: {
    color:     DARK.textPrimary,
    fontSize:  16,
    fontWeight: '700',
  },
  tabRow: {
    flexDirection:   'row',
    paddingHorizontal: 12,
    paddingVertical:    6,
    gap:               8,
    borderBottomWidth:  StyleSheet.hairlineWidth,
    borderBottomColor:  DARK.separator,
  },
  tab: {
    paddingHorizontal: 14,
    paddingVertical:    5,
    borderRadius:      4,
    borderWidth:       1,
    borderColor:       DARK.border,
  },
  tabActive: {
    backgroundColor: '#1d4ed8',
    borderColor:     '#1d4ed8',
  },
  tabText: {
    color:    DARK.textMuted,
    fontSize: 12,
    fontWeight: '600',
  },
  tabTextActive: {
    color: '#FFFFFF',
  },
  errorBox: {
    flexDirection:  'row',
    alignItems:     'center',
    gap:            12,
    padding:        12,
    backgroundColor: 'rgba(239,83,80,0.1)',
    margin:          10,
    borderRadius:    6,
    borderWidth:     1,
    borderColor:     '#EF5350',
  },
  errorText: {
    flex:     1,
    color:    '#EF5350',
    fontSize: 12,
  },
  retryText: {
    color:    DARK.textPrimary,
    fontSize: 12,
    fontWeight: '600',
  },
});
