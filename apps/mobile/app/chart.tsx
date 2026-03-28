/**
 * ChartScreen (app/chart.tsx)
 *
 * Chart tab root — hosts the full CandlestickChart + IndicatorPanel.
 * Historical OHLCV is backfilled from Polygon REST via usePolygonCandles;
 * live ticks are appended by usePolygonWebSocket.
 */

import React, { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useSharedValue } from 'react-native-reanimated';
import { CandlestickChart }  from '../components/chart/CandlestickChart';
import { TimeframeSelector } from '../components/chart/TimeframeSelector';
import { IndicatorPanel }    from '../components/chart/IndicatorPanel';
import { CHART_COLORS, CHART_LAYOUT, type TimeframeOption } from '../components/chart/chartTypes';
import { useWaveEngine }       from '../hooks/useWaveEngine';
import { useIndicators }       from '../hooks/useIndicators';
import { usePolygonCandles }   from '../hooks/usePolygonCandles';
import { useGEXLevels }          from '../hooks/useGEXLevels';
import { useRegimeClassifier }   from '../hooks/useRegimeClassifier';
import { useL2WebSocket }        from '../hooks/useL2WebSocket';
import { useCVD }               from '../hooks/useCVD';
import { useScenarioCommentary } from '../hooks/useScenarioCommentary';
import { useMarketDataStore }    from '../stores/marketData';
import { useGEXStore }         from '../stores/gex';
import { useWaveCountStore }   from '../stores/waveCount';
import { useWaveAlerts }       from '../hooks/useWaveAlerts';
import { ScenarioPanel }       from '../components/scenarios/ScenarioPanel';
import { DepthLadder }         from '../components/l2/DepthLadder';
import { TimeAndSales }        from '../components/l2/TimeAndSales';
import { DecayMeter }          from '../components/chart/DecayMeter';
import { VoiceCommandHandler } from '../components/voice/VoiceCommandHandler';
import { SentimentOverlay }   from '../components/sentiment/SentimentOverlay';
import { useSentiment }       from '../hooks/useSentiment';
import { ChartGrid }          from '../components/chart/ChartGrid';
import { EarningsPlaybook, EarningsCountdownBadge } from '../components/earnings/EarningsPlaybook';
import { useEarnings }        from '../hooks/useEarnings';
import { DARK }                from '../theme/colors';

const ACTIVE_TICKER = 'SPY';

const IPAD_MIN_WIDTH = 768;

export function ChartScreen() {
  const [timeframe,    setTimeframe]    = useState<TimeframeOption>('5m');
  const [showL2,       setShowL2]       = useState(false);
  const [l2Tab,        setL2Tab]        = useState<'depth' | 'tape'>('depth');
  const [compareMode,     setCompareMode]     = useState(false);
  const [showPlaybook,    setShowPlaybook]    = useState(false);
  const { width: screenW } = useWindowDimensions();
  const isIPad = screenW > IPAD_MIN_WIDTH;

  // Backfill real historical candles from Polygon REST
  const { status, error } = usePolygonCandles(ACTIVE_TICKER, timeframe);

  // Read candles written by the backfill hook (and merged by WS hook)
  const candles = useMarketDataStore(
    (s) => s.candles[`${ACTIVE_TICKER}_${timeframe}`] ?? [],
  );

  const translateX = useSharedValue(0);
  const candleW    = useSharedValue<number>(CHART_LAYOUT.candleDefaultW);

  const { waveCounts, sliceOffset } = useWaveEngine(ACTIVE_TICKER, timeframe, candles);
  useIndicators(ACTIVE_TICKER, timeframe, candles);
  useGEXLevels(ACTIVE_TICKER);
  useRegimeClassifier(ACTIVE_TICKER, timeframe, candles);
  useL2WebSocket(ACTIVE_TICKER);
  useCVD(ACTIVE_TICKER, timeframe, candles);
  useScenarioCommentary(ACTIVE_TICKER, timeframe);
  useSentiment(ACTIVE_TICKER);
  useEarnings(ACTIVE_TICKER);
  const gexLevels = useGEXStore((s) => s.levels[ACTIVE_TICKER] ?? null);

  // Active stop price: use pinned count if set, otherwise primary count
  const pinnedCountId = useWaveCountStore((s) => s.pinnedCountId[`${ACTIVE_TICKER}_${timeframe}`]);
  const activeStopPrice = useMemo(() => {
    if (!waveCounts.length) return 0;
    const pinned = pinnedCountId ? waveCounts.find((c) => c.id === pinnedCountId) : null;
    return (pinned ?? waveCounts[0]).stopPrice;
  }, [waveCounts, pinnedCountId]);

  // Wave completion alerts (E9)
  useWaveAlerts(ACTIVE_TICKER, timeframe, candles, waveCounts);

  const overlays = useMemo(() => ({
    ema9: false, ema21: true, ema50: true, ema200: false,
    sma20: false, sma50: false, sma200: false,
    vwap: false, anchoredVwap: false,
    bollingerBands: false, bollingerSd: 2 as const,
    keltnerChannels: false, ichimoku: false, vpvr: false,
    elliottWaveLabels: true,
    fibRetracements: true, fibExtensions: true, fibTimeZones: false,
    gexLevels: false, priorDayLevels: false, priorWeekLevels: false,
    monthlyOpen: false, roundNumbers: false,
  }), []);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.container}>
        <View style={styles.chartHeader}>
          <Text style={styles.tickerLabel}>{ACTIVE_TICKER}</Text>
          <TimeframeSelector activeTimeframe={timeframe} onSelect={setTimeframe} />
          {isIPad && (
            <Pressable
              style={[styles.comparePill, compareMode && styles.comparePillActive]}
              onPress={() => setCompareMode((v) => !v)}
            >
              <Text style={styles.comparePillText}>{compareMode ? 'Grid' : 'Compare'}</Text>
            </Pressable>
          )}
          <VoiceCommandHandler />
        </View>

        {isIPad && (
          <ChartGrid timeframe={timeframe} compareMode={compareMode} />
        )}

        {status === 'loading' && candles.length === 0 && (
          <View style={styles.loadingOverlay}>
            <ActivityIndicator color={CHART_COLORS.textPrimary} size="small" />
            <Text style={styles.loadingText}>Loading {ACTIVE_TICKER}…</Text>
          </View>
        )}

        {status === 'error' && candles.length === 0 && (
          <View style={styles.loadingOverlay}>
            <Text style={styles.errorText}>{error ?? 'Failed to load candles'}</Text>
          </View>
        )}

        {candles.length > 0 && (
          <>
            <View style={styles.chartRow}>
              <View style={styles.chartMain}>
                <CandlestickChart
                  candles={candles}
                  overlays={overlays}
                  ticker={ACTIVE_TICKER}
                  waveCounts={waveCounts}
                  waveSliceOffset={sliceOffset}
                  gexLevels={gexLevels}
                  activeStopPrice={activeStopPrice}
                  externalTranslateX={translateX}
                  externalCandleW={candleW}
                />
              </View>
              {showL2 && (
                <View style={styles.l2Panel}>
                  <View style={styles.l2TabBar}>
                    <Pressable
                      style={[styles.l2TabBtn, l2Tab === 'depth' && styles.l2TabActive]}
                      onPress={() => setL2Tab('depth')}
                    >
                      <Text style={[styles.l2TabText, l2Tab === 'depth' && styles.l2TabTextActive]}>
                        DEPTH
                      </Text>
                    </Pressable>
                    <Pressable
                      style={[styles.l2TabBtn, l2Tab === 'tape' && styles.l2TabActive]}
                      onPress={() => setL2Tab('tape')}
                    >
                      <Text style={[styles.l2TabText, l2Tab === 'tape' && styles.l2TabTextActive]}>
                        TAPE
                      </Text>
                    </Pressable>
                  </View>
                  {l2Tab === 'depth' ? (
                    <DepthLadder ticker={ACTIVE_TICKER} />
                  ) : (
                    <TimeAndSales />
                  )}
                </View>
              )}
            </View>
            <View style={styles.l2Toggle}>
              <Pressable style={styles.l2ToggleBtn} onPress={() => setShowL2((v) => !v)}>
                <Text style={styles.l2ToggleText}>{showL2 ? '▶ Hide L2' : '◀ Show L2'}</Text>
              </Pressable>
            </View>
            <DecayMeter ticker={ACTIVE_TICKER} candles={candles} />
            <IndicatorPanel
              ticker={ACTIVE_TICKER}
              timeframe={timeframe}
              candles={candles}
              translateX={translateX}
              candleW={candleW}
              font={null}
            />
            <ScrollView style={styles.bottomScroll} showsVerticalScrollIndicator={false}>
              <EarningsCountdownBadge ticker={ACTIVE_TICKER} onPress={() => setShowPlaybook(true)} />
              <ScenarioPanel ticker={ACTIVE_TICKER} timeframe={timeframe} />
              <SentimentOverlay ticker={ACTIVE_TICKER} timeframe={timeframe} />
            </ScrollView>
            <EarningsPlaybook
              ticker={ACTIVE_TICKER}
              timeframe={timeframe}
              visible={showPlaybook}
              onClose={() => setShowPlaybook(false)}
            />
          </>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex:            1,
    backgroundColor: CHART_COLORS.background,
  },
  container: {
    flex:            1,
    backgroundColor: CHART_COLORS.background,
  },
  chartHeader: {
    flexDirection:     'row',
    alignItems:        'center',
    paddingRight:      8,
  },
  tickerLabel: {
    color:      CHART_COLORS.textPrimary,
    fontSize:   17,
    fontWeight: '700',
    paddingHorizontal: 12,
    paddingVertical:   6,
    letterSpacing:     0.5,
  },
  comparePill: {
    paddingHorizontal: 10,
    paddingVertical:   4,
    borderRadius:      4,
    borderWidth:       1,
    borderColor:       DARK.border,
    marginRight:       6,
  },
  comparePillActive: {
    backgroundColor: '#1d4ed8',
    borderColor:     '#1d4ed8',
  },
  comparePillText: {
    color:    DARK.textSecondary,
    fontSize: 11,
    fontWeight: '600',
  },

  // L2 side-panel layout
  chartRow:  { flex: 1, flexDirection: 'row' },
  chartMain: { flex: 1 },
  l2Panel: {
    width:           160,
    backgroundColor: DARK.background,
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderLeftColor: DARK.separator,
  },
  l2TabBar: {
    flexDirection:    'row',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: DARK.separator,
  },
  l2TabBtn: {
    flex:           1,
    paddingVertical: 5,
    alignItems:     'center',
  },
  l2TabActive: {
    borderBottomWidth: 2,
    borderBottomColor: '#3b82f6',
  },
  l2TabText: {
    color:     DARK.textMuted,
    fontSize:  9,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  l2TabTextActive: { color: DARK.textPrimary },

  l2Toggle: {
    alignItems: 'flex-end',
    paddingHorizontal: 8,
    paddingVertical:   2,
  },
  l2ToggleBtn: {
    paddingHorizontal: 8,
    paddingVertical:   3,
    backgroundColor:   DARK.surface,
    borderRadius:      4,
    borderWidth:       StyleSheet.hairlineWidth,
    borderColor:       DARK.border,
  },
  l2ToggleText: {
    color:    DARK.textMuted,
    fontSize: 9,
    fontWeight: '600',
  },
  loadingOverlay: {
    flex:           1,
    alignItems:     'center',
    justifyContent: 'center',
    gap:            8,
  },
  loadingText: {
    color:    CHART_COLORS.textMuted,
    fontSize: 13,
  },
  errorText: {
    color:    '#EF5350',
    fontSize: 13,
    textAlign: 'center',
    paddingHorizontal: 24,
  },
  bottomScroll: {
    maxHeight: 280,
  },
});
