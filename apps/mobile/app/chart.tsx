/**
 * ChartScreen (app/chart.tsx)
 *
 * Chart tab root — hosts the full CandlestickChart + IndicatorPanel.
 * Historical OHLCV is backfilled from Polygon REST via usePolygonCandles;
 * live ticks are appended by usePolygonWebSocket.
 */

import React, { useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import type { View as RNView } from 'react-native';
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
import { useCVD }               from '../hooks/useCVD';
import { useScenarioCommentary } from '../hooks/useScenarioCommentary';
import { useMarketDataStore }    from '../stores/marketData';
import { useGEXStore }         from '../stores/gex';
import { useWaveCountStore }   from '../stores/waveCount';
import { useWaveAlerts }       from '../hooks/useWaveAlerts';
import { ScenarioPanel }       from '../components/scenarios/ScenarioPanel';
import { DecayMeter }          from '../components/chart/DecayMeter';
import { VoiceCommandHandler } from '../components/voice/VoiceCommandHandler';
import { LayerTogglePanel }  from '../components/chart/LayerTogglePanel';
import { ShareExportSheet }  from '../components/chart/ShareExportSheet';
import { useChartLayersStore } from '../stores/chartLayers';
import { SentimentOverlay }   from '../components/sentiment/SentimentOverlay';
import { useSentiment }       from '../hooks/useSentiment';
import { ChartGrid }          from '../components/chart/ChartGrid';
import { EarningsPlaybook, EarningsCountdownBadge } from '../components/earnings/EarningsPlaybook';
import { useEarnings }        from '../hooks/useEarnings';
import { DataDelayFooter }    from '../components/common/DataDelayFooter';
import { TickerPickerModal }  from '../components/chart/TickerPickerModal';
import { DARK }                from '../theme/colors';

// ACTIVE_TICKER is now driven by the store (set when user taps a watchlist card).
// Falls back to 'SPY' if nothing has been selected yet.

const IPAD_MIN_WIDTH = 768;

export function ChartScreen() {
  const [timeframe,    setTimeframe]    = useState<TimeframeOption>('5m');
  const [compareMode,     setCompareMode]     = useState(false);
  const [showPlaybook,    setShowPlaybook]    = useState(false);
  const [showTickerPicker, setShowTickerPicker] = useState(false);
  const [showShare,    setShowShare]    = useState(false);
  const chartViewRef = useRef<RNView>(null);
  const layers = useChartLayersStore();
  const { width: screenW } = useWindowDimensions();
  const isIPad = screenW > IPAD_MIN_WIDTH;

  // Active ticker: set when user taps a watchlist card; defaults to SPY
  const ACTIVE_TICKER = useMarketDataStore((s) => s.activeTicker ?? 'SPY');

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
    ema9: false,
    ema21:           layers.ma20,
    ema50:           layers.ma50,
    ema200:          layers.ma200,
    sma20: false, sma50: false, sma200: false,
    vwap:            layers.vwap,
    anchoredVwap: false,
    bollingerBands:  layers.bb,
    bollingerSd: 2 as const,
    keltnerChannels: false, ichimoku: false, vpvr: false,
    elliottWaveLabels: layers.ewWaves,
    fibRetracements: layers.fibLevels,
    fibExtensions:   layers.fibLevels,
    fibTimeZones: false,
    gexLevels:       layers.showGEX,
    priorDayLevels: false, priorWeekLevels: false,
    monthlyOpen: false, roundNumbers: false,
    showEWChannel:    layers.ewChannel,
    showInvalidation: layers.invalidation,
    showWaveLabels:   layers.waveLabels,
  }), [layers]);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.container}>
        <View style={styles.chartHeader}>
          <Pressable
            style={styles.tickerButton}
            onPress={() => setShowTickerPicker(true)}
            hitSlop={8}
          >
            <Text style={styles.tickerLabel}>{ACTIVE_TICKER}</Text>
            <Text style={styles.tickerChevron}>▾</Text>
          </Pressable>
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
          <Pressable style={styles.shareBtn} onPress={() => setShowShare(true)} hitSlop={8}>
            <Text style={styles.shareBtnText}>⎋</Text>
          </Pressable>
        </View>
        <LayerTogglePanel />

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
            <View style={styles.chartRow} ref={chartViewRef}>
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
              {waveCounts.length === 0 && candles.length > 0 && (
                <View style={styles.analyzingOverlay} pointerEvents="none">
                  <Text style={styles.analyzingText}>Analyzing…</Text>
                </View>
              )}
            </View>
            <DecayMeter ticker={ACTIVE_TICKER} candles={candles} />
            <DataDelayFooter ticker={ACTIVE_TICKER} timeframe={timeframe} />
            <IndicatorPanel
              ticker={ACTIVE_TICKER}
              timeframe={timeframe}
              candles={candles}
              translateX={translateX}
              candleW={candleW}
              visiblePages={{
                rsi:    layers.showRSI,
                macd:   layers.showMACD,
                volume: layers.showVolume,
                cvd:    layers.showCVD,
              }}
            />
            <ScrollView style={styles.bottomScroll} showsVerticalScrollIndicator={false} nestedScrollEnabled>
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

        <TickerPickerModal
          visible={showTickerPicker}
          onClose={() => setShowTickerPicker(false)}
          onSelect={() => setShowTickerPicker(false)}
          currentTicker={ACTIVE_TICKER}
        />
        <ShareExportSheet
          visible={showShare}
          onClose={() => setShowShare(false)}
          exportCtx={showShare && candles.length > 0 ? {
            ticker: ACTIVE_TICKER,
            timeframe,
            currentPrice: candles[candles.length - 1]?.close ?? 0,
            waveCounts: waveCounts as import('@elliott-wave-pro/wave-engine').WaveCount[],
            candles,
            chartRef: chartViewRef,
          } : null}
        />
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
  tickerButton: {
    flexDirection:     'row',
    alignItems:        'center',
    paddingHorizontal: 12,
    paddingVertical:   6,
    gap:               4,
  },
  tickerLabel: {
    color:        CHART_COLORS.textPrimary,
    fontSize:     17,
    fontWeight:   '700',
    letterSpacing: 0.5,
  },
  tickerChevron: {
    color:    CHART_COLORS.textMuted,
    fontSize: 12,
    marginTop: 2,
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

  chartRow:  { flex: 1 },
  analyzingOverlay: {
    position:       'absolute',
    top:            8,
    right:          64,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius:   4,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  analyzingText: {
    color:    CHART_COLORS.textMuted,
    fontSize: 10,
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
    maxHeight: 420,
  },
  shareBtn: {
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  shareBtnText: {
    color: DARK.textSecondary,
    fontSize: 16,
  },
});
