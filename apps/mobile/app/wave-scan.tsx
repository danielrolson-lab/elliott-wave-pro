/**
 * app/wave-scan.tsx — WaveScanResults screen
 *
 * Shows historical analogs for a given wave type + ticker.
 * Each analog is a horizontally scrollable card with mini chart + returns.
 * Tapping a card selects it for replay (D2).
 *
 * Header controls: ticker input, timeframe picker, wave type picker,
 * lookback slider, and Run Scan button.
 */

import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  ScrollView,
  FlatList,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useWaveScan }       from '../hooks/useWaveScan';
import { useWaveScanStore }  from '../stores/waveScan';
import { AnalogCard }        from '../components/scan/AnalogCard';
import { DARK }              from '../theme/colors';
import type { ScanStackParamList } from '../navigation/AppNavigator';

const TIMEFRAMES = ['5m', '15m', '30m', '1h', '4h', '1D'] as const;
const WAVE_TYPES = ['any', '1', '2', '3', '4', '5', 'A', 'B', 'C'] as const;
const LOOKBACKS  = [30, 60, 90, 180, 365, 730] as const;

// ── Stats row ─────────────────────────────────────────────────────────────────

function StatBox({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <View style={statsStyles.box}>
      <Text style={statsStyles.label}>{label}</Text>
      <Text style={[statsStyles.value, color ? { color } : {}]}>{value}</Text>
    </View>
  );
}

const statsStyles = StyleSheet.create({
  box:   { alignItems: 'center', flex: 1 },
  label: { color: DARK.textMuted, fontSize: 9, marginBottom: 2 },
  value: { color: DARK.textPrimary, fontSize: 13, fontWeight: '700' },
});

// ── Screen ────────────────────────────────────────────────────────────────────

export function WaveScanScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<ScanStackParamList>>();

  const [ticker,   setTicker]   = useState('SPY');
  const [tf,       setTf]       = useState<string>('1D');
  const [waveType, setWaveType] = useState<string>('3');
  const [lookback, setLookback] = useState<number>(180);

  const { scan } = useWaveScan();

  const key     = `${ticker.toUpperCase()}_${tf}_${waveType}`;
  const result  = useWaveScanStore((s) => s.results[key]);
  const status  = useWaveScanStore((s) => s.status[key] ?? 'idle');
  const errMsg  = useWaveScanStore((s) => s.error[key]);
  const selIdx  = useWaveScanStore((s) => s.selectedInstanceIdx);
  const selectInstance = useWaveScanStore((s) => s.selectInstance);

  const runScan = useCallback(() => {
    void scan({ ticker: ticker.toUpperCase(), timeframe: tf, lookback_days: lookback, wave_type: waveType });
  }, [scan, ticker, tf, lookback, waveType]);

  const handleSelect = useCallback((idx: number) => {
    selectInstance(selIdx === idx ? null : idx);
  }, [selIdx, selectInstance]);

  const goReplay = useCallback(() => {
    if (selIdx === null || !result) return;
    navigation.navigate('Replay', { instanceIdx: selIdx, scanKey: key });
  }, [navigation, selIdx, result, key]);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>

        {/* ── Header ── */}
        <View style={styles.header}>
          <Text style={styles.title}>Wave Scanner</Text>
        </View>

        {/* ── Controls ── */}
        <View style={styles.controls}>
          <TextInput
            style={styles.tickerInput}
            value={ticker}
            onChangeText={(v) => setTicker(v.toUpperCase())}
            autoCapitalize="characters"
            placeholder="Ticker"
            placeholderTextColor={DARK.textMuted}
          />

          {/* Timeframe picker */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.pillRow}>
            {TIMEFRAMES.map((t) => (
              <Pressable
                key={t}
                style={[styles.pill, tf === t && styles.pillActive]}
                onPress={() => setTf(t)}
              >
                <Text style={[styles.pillText, tf === t && styles.pillTextActive]}>{t}</Text>
              </Pressable>
            ))}
          </ScrollView>

          {/* Wave type picker */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.pillRow}>
            {WAVE_TYPES.map((w) => (
              <Pressable
                key={w}
                style={[styles.pill, waveType === w && styles.pillActive]}
                onPress={() => setWaveType(w)}
              >
                <Text style={[styles.pillText, waveType === w && styles.pillTextActive]}>
                  {w === 'any' ? 'Any' : `W${w}`}
                </Text>
              </Pressable>
            ))}
          </ScrollView>

          {/* Lookback picker */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.pillRow}>
            {LOOKBACKS.map((lb) => (
              <Pressable
                key={lb}
                style={[styles.pill, lookback === lb && styles.pillActive]}
                onPress={() => setLookback(lb)}
              >
                <Text style={[styles.pillText, lookback === lb && styles.pillTextActive]}>
                  {lb < 365 ? `${lb}d` : lb === 365 ? '1Y' : '2Y'}
                </Text>
              </Pressable>
            ))}
          </ScrollView>

          <Pressable
            style={[styles.runBtn, status === 'loading' && styles.runBtnDisabled]}
            onPress={runScan}
            disabled={status === 'loading'}
          >
            {status === 'loading' ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Text style={styles.runBtnText}>Run Scan</Text>
            )}
          </Pressable>
        </View>

        {/* ── Error ── */}
        {status === 'error' && (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{errMsg ?? 'Scan failed'}</Text>
          </View>
        )}

        {/* ── Stats ── */}
        {result && (
          <View style={styles.statsRow}>
            <StatBox label="Samples"  value={String(result.stats.sample_count)} />
            <StatBox label="Win Rate" value={`${result.stats.win_rate_5d}%`}
              color={result.stats.win_rate_5d >= 50 ? DARK.bullish : DARK.bearish} />
            <StatBox label="Median 5d" value={`${result.stats.median_return_5d >= 0 ? '+' : ''}${result.stats.median_return_5d}%`}
              color={result.stats.median_return_5d >= 0 ? DARK.bullish : DARK.bearish} />
            <StatBox label="Max MAE"   value={`${result.stats.max_drawdown_before_target}%`}
              color={DARK.bearish} />
            <StatBox label="Best"      value={`+${result.stats.best_return}%`}  color={DARK.bullish} />
          </View>
        )}

        {/* ── Analog cards ── */}
        {result && result.instances.length > 0 && (
          <View style={styles.cardsSection}>
            <Text style={styles.sectionTitle}>
              {result.instances.length} Analogs — {result.ticker} {result.wave_type === 'any' ? 'All Waves' : `Wave ${result.wave_type}`} ({result.timeframe})
            </Text>
            <FlatList
              horizontal
              data={result.instances}
              keyExtractor={(_, i) => String(i)}
              renderItem={({ item, index }) => (
                <AnalogCard
                  instance={item}
                  isSelected={selIdx === index}
                  onPress={() => handleSelect(index)}
                />
              )}
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ paddingVertical: 8, paddingHorizontal: 12 }}
            />

            {/* Replay CTA */}
            {selIdx !== null && (
              <Pressable style={styles.replayBtn} onPress={goReplay}>
                <Text style={styles.replayBtnText}>▶ Replay Analog {selIdx + 1}</Text>
              </Pressable>
            )}
          </View>
        )}

        {result && result.instances.length === 0 && (
          <View style={styles.emptyBox}>
            <Text style={styles.emptyText}>No analogs found. Try a different wave type or longer lookback.</Text>
          </View>
        )}

      </ScrollView>
    </SafeAreaView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe:   { flex: 1, backgroundColor: DARK.background },
  scroll: { flex: 1 },

  header: {
    paddingHorizontal: 16,
    paddingTop:        12,
    paddingBottom:     8,
  },
  title: {
    color:      DARK.textPrimary,
    fontSize:   20,
    fontWeight: '700',
  },

  controls: {
    paddingHorizontal: 12,
    gap: 8,
    marginBottom: 8,
  },
  tickerInput: {
    backgroundColor:  DARK.surface,
    borderColor:      DARK.border,
    borderWidth:      1,
    borderRadius:     6,
    color:            DARK.textPrimary,
    paddingHorizontal: 12,
    paddingVertical:   8,
    fontSize:         15,
    fontWeight:       '700',
  },
  pillRow: {
    flexGrow: 0,
  },
  pill: {
    paddingHorizontal: 12,
    paddingVertical:    5,
    borderRadius:       4,
    borderWidth:        1,
    borderColor:        DARK.border,
    marginRight:        6,
  },
  pillActive: {
    backgroundColor: '#1d4ed8',
    borderColor:     '#1d4ed8',
  },
  pillText:       { color: DARK.textMuted,    fontSize: 12, fontWeight: '600' },
  pillTextActive: { color: '#fff' },

  runBtn: {
    backgroundColor: '#1d6fe8',
    borderRadius:     6,
    paddingVertical:  11,
    alignItems:       'center',
  },
  runBtnDisabled: { opacity: 0.5 },
  runBtnText: {
    color:      '#fff',
    fontSize:   14,
    fontWeight: '700',
  },

  errorBox: {
    margin:        12,
    padding:       10,
    backgroundColor: '#7f1d1d30',
    borderRadius:  6,
    borderWidth:   1,
    borderColor:   DARK.bearish,
  },
  errorText: { color: DARK.bearish, fontSize: 12 },

  statsRow: {
    flexDirection:     'row',
    marginHorizontal:  12,
    marginBottom:      10,
    backgroundColor:   DARK.surface,
    borderRadius:      8,
    padding:           10,
    borderWidth:       1,
    borderColor:       DARK.border,
  },

  cardsSection: { marginBottom: 20 },
  sectionTitle: {
    color:             DARK.textSecondary,
    fontSize:          11,
    paddingHorizontal: 16,
    marginBottom:      4,
  },

  replayBtn: {
    marginHorizontal:  12,
    marginTop:         6,
    backgroundColor:   '#065f46',
    borderRadius:      6,
    paddingVertical:   10,
    alignItems:        'center',
  },
  replayBtnText: {
    color:      '#34d399',
    fontSize:   13,
    fontWeight: '700',
  },

  emptyBox: {
    margin: 16,
    padding: 16,
    backgroundColor: DARK.surface,
    borderRadius: 8,
    alignItems: 'center',
  },
  emptyText: { color: DARK.textMuted, fontSize: 13, textAlign: 'center' },
});
