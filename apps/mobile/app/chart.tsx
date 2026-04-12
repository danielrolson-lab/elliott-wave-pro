/**
 * ChartScreen (app/chart.tsx)
 *
 * Chart tab root — hosts the full CandlestickChart + IndicatorPanel.
 * Historical OHLCV is backfilled from Polygon REST via usePolygonCandles;
 * live ticks are appended by usePolygonWebSocket.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import type { View as RNView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useSharedValue } from 'react-native-reanimated';
import { CandlestickChart, type CandlestickChartHandle } from '../components/chart/CandlestickChart';
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
import { MultiDegreeContextBanner } from '../components/chart/MultiDegreeContextBanner';
import { DARK }                from '../theme/colors';
import { MMKV } from 'react-native-mmkv';
import { useWaveConfluence }   from '../hooks/useWaveConfluence';
import { WaveConfluenceModal } from '../components/chart/WaveConfluenceModal';
import { detectPivots, generateWaveCountsV3 } from '@elliott-wave-pro/wave-engine';
import type { OHLCV, WaveCount, PatternCandidate } from '@elliott-wave-pro/wave-engine';
import { HISTORY_COLORS, type WaveHistoryPattern } from '../components/chart/WaveHistoryLayer';

// ACTIVE_TICKER is now driven by the store (set when user taps a watchlist card).
// Falls back to 'SPY' if nothing has been selected yet.

const IPAD_MIN_WIDTH = 768;

// Per-ticker timeframe persistence
const tfStorage = new MMKV({ id: 'chart-timeframe' });
const DEFAULT_TIMEFRAME: TimeframeOption = '1h';

// HTF mapping for Multi-Degree mode
const HTF_MAP: Record<string, TimeframeOption> = {
  '1m':  '15m',
  '5m':  '1h',
  '15m': '4h',
  '30m': '4h',
  '1h':  '1D',
  '4h':  '1W',
  '1D':  '1W',
  '1W':  '1W',
};

const MIN_SWING_PCT_HISTORY: Record<string, number> = {
  '1m': 0.00015, '5m': 0.00020, '15m': 0.00025, '30m': 0.00030,
  '1h': 0.00035, '4h': 0.00040, '1D': 0.00050,  '1W': 0.00080,
};

/** Map HTF WaveCount pivot bar-indices to current-TF bar positions via timestamp matching. */
function mapHtfToCurrentTF(
  htfWaveCount: WaveCount,
  htfCandles: readonly OHLCV[],
  currentCandles: readonly OHLCV[],
): WaveCount {
  const mapIndex = (htfBarIdx: number): number => {
    const htfTs = htfCandles[htfBarIdx]?.timestamp;
    if (!htfTs) return 0;
    let best = 0;
    let bestDist = Infinity;
    for (let i = 0; i < currentCandles.length; i++) {
      const dist = Math.abs(currentCandles[i].timestamp - htfTs);
      if (dist < bestDist) { bestDist = dist; best = i; }
    }
    return best;
  };

  const mapPivot = (pivot: WaveCount['allWaves'][0]['startPivot']) => {
    if (!pivot) return pivot;
    return { ...pivot, index: mapIndex(pivot.index) };
  };

  return {
    ...htfWaveCount,
    allWaves: htfWaveCount.allWaves.map((w) => ({
      ...w,
      startPivot: mapPivot(w.startPivot) as typeof w.startPivot,
      endPivot:   mapPivot(w.endPivot as NonNullable<typeof w.endPivot>) as typeof w.endPivot,
    })),
    currentWave: {
      ...htfWaveCount.currentWave,
      startPivot: mapPivot(htfWaveCount.currentWave.startPivot) as typeof htfWaveCount.currentWave.startPivot,
      endPivot:   htfWaveCount.currentWave.endPivot
        ? mapPivot(htfWaveCount.currentWave.endPivot as NonNullable<typeof htfWaveCount.currentWave.endPivot>) as typeof htfWaveCount.currentWave.endPivot
        : htfWaveCount.currentWave.endPivot,
    },
  };
}

/** Run overlapping window scan for Wave History mode. */
function computeHistoryPatterns(
  candles: readonly OHLCV[],
  timeframe: string,
): WaveHistoryPattern[] {
  const cap = Math.min(200, candles.length);
  const histCandles = candles.slice(-cap) as OHLCV[];
  const windowSize  = Math.min(80, Math.floor(histCandles.length / 2));
  const stepSize    = Math.max(1, Math.floor(windowSize * 0.4));
  const swingFloor  = MIN_SWING_PCT_HISTORY[timeframe] ?? 0.0005;

  const patterns: WaveHistoryPattern[] = [];
  let colorIdx = 0;

  for (let start = 0; start <= histCandles.length - windowSize; start += stepSize) {
    const window = histCandles.slice(start, start + windowSize);
    const pivots = detectPivots(window, 0.5, timeframe, swingFloor);
    if (pivots.length < 4) continue;

    const v3Pivots = pivots.map((p) => ({
      ts: p.timestamp, price: p.price,
      isHigh: p.type === 'HH' || p.type === 'LH',
      bar:    p.index,
    }));

    const candidates = generateWaveCountsV3({
      pivots: v3Pivots, ticker: 'HIST', timeframe,
      assetClass: 'equity', state: {},
      candles: window.map((c) => ({
        ts: c.timestamp, open: c.open, high: c.high,
        low: c.low, close: c.close, volume: c.volume,
      })),
    });

    const top: PatternCandidate | undefined = candidates.find(
      (c) => c.stage === 'complete' && c.confidence > 0.5
    );
    if (!top) continue;

    // Adjust pivot bar indices to full (sliced) candle array coords
    const isCorrective = top.type === 'zigzag' || top.type === 'regular_flat' || top.type === 'expanded_flat';
    const waveLabels = isCorrective ? ['A', 'B', 'C'] : ['1', '2', '3', '4', '5'];
    const pairCount  = Math.min(top.pivots.length - 1, waveLabels.length);
    const sliceOffset = candles.length - cap + start;

    const allWaves: WaveCount['allWaves'] = [];
    for (let i = 0; i < pairCount; i++) {
      const p0 = top.pivots[i];
      const p1 = top.pivots[i + 1];
      allWaves.push({
        label:  waveLabels[i] as WaveCount['currentWave']['label'],
        degree: 'minor',
        structure: isCorrective ? 'zigzag' : 'impulse',
        startPivot: { index: sliceOffset + (p0.bar ?? 0), timestamp: p0.ts, price: p0.price, type: p0.isHigh ? 'HH' : 'LL', timeframe },
        endPivot:   { index: sliceOffset + (p1.bar ?? 0), timestamp: p1.ts, price: p1.price, type: p1.isHigh ? 'HH' : 'LL', timeframe },
        subwaves: [],
      });
    }
    if (!allWaves.length) continue;

    const wc: WaveCount = {
      id:           `hist_${start}_${top.id}`,
      ticker:       'HIST',
      timeframe,
      degree:       'minor',
      currentWave:  allWaves[allWaves.length - 1],
      allWaves,
      posterior:    { countId: top.id, prior: 0.2, posterior: top.confidence, likelihood_components: {} as WaveCount['posterior']['likelihood_components'], decay_factor: 1, last_updated: Date.now(), invalidation_price: 0, confidence_interval: [0, 1], mtf_conflict: false },
      targets:      [0, 0, 0],
      stopPrice:    top.invalidation ?? 0,
      rrRatio:      0,
      isValid:      top.hardViolations.length === 0,
      violations:   top.hardViolations,
      softWarnings: [],
      createdAt:    Date.now(),
      updatedAt:    Date.now(),
    };

    // Deduplicate: skip if >60% pivot overlap with an existing pattern
    const newIndices = allWaves.map((w) => w.startPivot.index);
    const isDup = patterns.some((existing) => {
      const existingIndices = existing.waveCount.allWaves.map((w) => w.startPivot.index);
      const overlap = newIndices.filter((idx) => existingIndices.some((ei) => Math.abs(ei - idx) < 5)).length;
      return overlap / newIndices.length > 0.6;
    });
    if (isDup) continue;

    patterns.push({
      id:        wc.id,
      color:     HISTORY_COLORS[colorIdx % HISTORY_COLORS.length],
      waveCount: wc,
    });
    colorIdx++;
    if (patterns.length >= 6) break; // cap at 6 patterns
  }

  return patterns;
}

export function ChartScreen() {
  const [timeframe,    setTimeframe]    = useState<TimeframeOption>(
    () => (tfStorage.getString('last') as TimeframeOption | undefined) ?? DEFAULT_TIMEFRAME,
  );
  const [compareMode,     setCompareMode]     = useState(false);
  const [showPlaybook,    setShowPlaybook]    = useState(false);
  const [showTickerPicker, setShowTickerPicker] = useState(false);
  const [showShare,    setShowShare]    = useState(false);
  const [showConfluence,  setShowConfluence]  = useState(false);
  const [, setCrosshairActive] = useState(false);
  const [chartH,          setChartH]          = useState(0);
  const chartViewRef = useRef<RNView>(null);
  const chartRef     = useRef<CandlestickChartHandle>(null);
  const layers = useChartLayersStore();
  const ewMode = layers.ewMode;
  const { width: screenW, height: screenH } = useWindowDimensions();
  const isIPad = screenW > IPAD_MIN_WIDTH;

  // Active ticker: set when user taps a watchlist card; defaults to SPY
  const ACTIVE_TICKER = useMarketDataStore((s) => s.activeTicker ?? 'SPY');

  // Persist timeframe per-ticker; restore when ticker changes
  const setTimeframePersisted = useCallback((tf: TimeframeOption) => {
    tfStorage.set('last', tf);
    tfStorage.set(`ticker_${ACTIVE_TICKER}`, tf);
    setTimeframe(tf);
  }, [ACTIVE_TICKER]);

  useEffect(() => {
    const saved = tfStorage.getString(`ticker_${ACTIVE_TICKER}`) as TimeframeOption | undefined;
    setTimeframe(saved ?? DEFAULT_TIMEFRAME);
  }, [ACTIVE_TICKER]);

  // Backfill real historical candles from Polygon REST
  const { status, error } = usePolygonCandles(ACTIVE_TICKER, timeframe);

  // Read candles written by the backfill hook (and merged by WS hook)
  const candles = useMarketDataStore(
    (s) => s.candles[`${ACTIVE_TICKER}_${timeframe}`] ?? [],
  );

  const translateX = useSharedValue(0);
  const candleW    = useSharedValue<number>(CHART_LAYOUT.candleDefaultW);

  // Reset translateX to 0 on ticker/timeframe change so CandlestickChart
  // re-initialises to the rightmost bars for the new symbol/timeframe.
  useEffect(() => {
    translateX.value = 0;
  }, [ACTIVE_TICKER, timeframe, translateX]);

  // Viewport start index from pan/pinch — drives historical wave recalc
  const [viewportStart, setViewportStart] = useState<number | undefined>(undefined);

  // Multi-Degree mode: HTF candles + mapped wave counts
  const [htfWaveCounts, setHtfWaveCounts] = useState<readonly WaveCount[]>([]);
  const htfCandlesRef = useRef<OHLCV[]>([]);
  const htfFetchKey   = useRef('');

  // Wave History mode: computed patterns + scanning flag
  const [historyPatterns,  setHistoryPatterns]  = useState<WaveHistoryPattern[]>([]);
  const [historyScanning,  setHistoryScanning]  = useState(false);
  const historyComputeKey  = useRef('');
  // Stable ref so the setTimeout callback always reads the latest candles
  // without `candles` needing to be in any effect dependency array.
  const candlesRef = useRef(candles);
  // Keep ref current on every render (intentional — not inside an effect)
  candlesRef.current = candles;

  // Reset viewport when ticker or timeframe changes
  useEffect(() => {
    setViewportStart(undefined);
  }, [ACTIVE_TICKER, timeframe]);

  const handleVisibleWindowChange = useCallback((startIdx: number, _endIdx: number) => {
    setViewportStart(startIdx);
  }, []);

  const { waveCounts, sliceOffset, isHistorical } = useWaveEngine(ACTIVE_TICKER, timeframe, candles, viewportStart);
  useIndicators(ACTIVE_TICKER, timeframe, candles);
  useGEXLevels(ACTIVE_TICKER);
  useRegimeClassifier(ACTIVE_TICKER, timeframe, candles);
  useCVD(ACTIVE_TICKER, timeframe, candles);
  useScenarioCommentary(ACTIVE_TICKER, timeframe, ewMode, htfWaveCounts);
  useSentiment(ACTIVE_TICKER);
  useEarnings(ACTIVE_TICKER);
  const gexLevels = useGEXStore((s) => s.levels[ACTIVE_TICKER] ?? null);

  // Wave Confluence hook (fetches in background)
  const confluence = useWaveConfluence(ACTIVE_TICKER);

  // ── Multi-Degree mode: fetch HTF candles + run engine ──────────────────────
  useEffect(() => {
    if (ewMode !== 'multi-degree') { setHtfWaveCounts([]); return; }

    const htfTF   = HTF_MAP[timeframe] ?? '1D';
    const fetchKey = `${ACTIVE_TICKER}_${htfTF}`;
    if (htfFetchKey.current === fetchKey && htfCandlesRef.current.length > 0) {
      // Already have HTF candles for this ticker/TF combo — just re-map
      const htfCandles = htfCandlesRef.current;
      if (htfCandles.length < 20) return;
      const swingFloor = MIN_SWING_PCT_HISTORY[htfTF] ?? 0.0005;
      const pivots = detectPivots(htfCandles, 0.5, htfTF, swingFloor);
      if (pivots.length < 4) return;
      const v3Pivots = pivots.map((p) => ({
        ts: p.timestamp, price: p.price,
        isHigh: p.type === 'HH' || p.type === 'LH', bar: p.index,
      }));
      const candidates = generateWaveCountsV3({
        pivots: v3Pivots, ticker: ACTIVE_TICKER, timeframe: htfTF,
        assetClass: 'equity', state: {},
        candles: htfCandles.map((c) => ({
          ts: c.timestamp, open: c.open, high: c.high,
          low: c.low, close: c.close, volume: c.volume,
        })),
      });
      if (!candidates.length) return;
      // We only need the basic WaveCount for rendering — build a minimal one
      const top = candidates[0];
      const isCorrective = top.type === 'zigzag' || top.type === 'regular_flat' || top.type === 'expanded_flat';
      const labels = isCorrective ? ['A','B','C'] : ['1','2','3','4','5'];
      const pairCount = Math.min(top.pivots.length - 1, labels.length);
      const allWaves: WaveCount['allWaves'] = [];
      for (let i = 0; i < pairCount; i++) {
        const p0 = top.pivots[i]; const p1 = top.pivots[i+1];
        allWaves.push({
          label: labels[i] as WaveCount['currentWave']['label'], degree: 'primary', structure: isCorrective ? 'zigzag' : 'impulse',
          startPivot: { index: p0.bar ?? 0, timestamp: p0.ts, price: p0.price, type: p0.isHigh ? 'HH':'LL', timeframe: htfTF },
          endPivot:   { index: p1.bar ?? 0, timestamp: p1.ts, price: p1.price, type: p1.isHigh ? 'HH':'LL', timeframe: htfTF },
          subwaves: [],
        });
      }
      if (!allWaves.length) return;
      const htfWC: WaveCount = {
        id: `htf_${fetchKey}`, ticker: ACTIVE_TICKER, timeframe: htfTF, degree: 'primary',
        currentWave: allWaves[allWaves.length-1], allWaves,
        posterior: { countId: top.id, prior: 0.2, posterior: top.confidence, likelihood_components: {} as WaveCount['posterior']['likelihood_components'], decay_factor: 1, last_updated: Date.now(), invalidation_price: 0, confidence_interval: [0,1], mtf_conflict: false },
        targets: [0,0,0], stopPrice: top.invalidation ?? 0, rrRatio: 0,
        isValid: top.hardViolations.length === 0, violations: top.hardViolations, softWarnings: [], createdAt: Date.now(), updatedAt: Date.now(),
      };
      const mapped = mapHtfToCurrentTF(htfWC, htfCandles, candles);
      setHtfWaveCounts([mapped]);
      return;
    }

    htfFetchKey.current = fetchKey;

    const apiKey = process.env.EXPO_PUBLIC_POLYGON_API_KEY;
    if (!apiKey) return;

    const lookbackDays = (htfTF === '1W' || htfTF === '1D') ? 730 : 90;
    const now = new Date();
    const from = new Date(now.getTime() - lookbackDays * 86_400_000);
    const fmt = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')}`;
    const tfParts: Record<string, {mult:number;span:string}> = {
      '1h': {mult:1,span:'hour'}, '4h': {mult:4,span:'hour'}, '1D': {mult:1,span:'day'}, '1W': {mult:1,span:'week'}, '15m': {mult:15,span:'minute'},
    };
    const spec = tfParts[htfTF] ?? {mult:1,span:'day'};
    const url = `https://api.polygon.io/v2/aggs/ticker/${encodeURIComponent(ACTIVE_TICKER)}/range/${spec.mult}/${spec.span}/${fmt(from)}/${fmt(now)}?adjusted=true&sort=asc&limit=5000&apiKey=${apiKey}`;

    const controller = new AbortController();
    fetch(url, { signal: controller.signal })
      .then((r) => r.json())
      .then((data: {results?: Array<{t:number;o:number;h:number;l:number;c:number;v:number}>}) => {
        if (!data.results?.length) return;
        const htfCandles: OHLCV[] = data.results.map((a) => ({
          timestamp: a.t, open: a.o, high: a.h, low: a.l, close: a.c, volume: a.v,
        }));
        htfCandlesRef.current = htfCandles;
        const swingFloor = MIN_SWING_PCT_HISTORY[htfTF] ?? 0.0005;
        const pivots = detectPivots(htfCandles, 0.5, htfTF, swingFloor);
        if (pivots.length < 4) return;
        const v3Pivots = pivots.map((p) => ({
          ts: p.timestamp, price: p.price, isHigh: p.type === 'HH' || p.type === 'LH', bar: p.index,
        }));
        const candidates = generateWaveCountsV3({
          pivots: v3Pivots, ticker: ACTIVE_TICKER, timeframe: htfTF, assetClass: 'equity', state: {},
          candles: htfCandles.map((c) => ({ ts: c.timestamp, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume })),
        });
        if (!candidates.length) return;
        const top = candidates[0];
        const isCorrective = top.type === 'zigzag' || top.type === 'regular_flat' || top.type === 'expanded_flat';
        const labels = isCorrective ? ['A','B','C'] : ['1','2','3','4','5'];
        const pairCount = Math.min(top.pivots.length - 1, labels.length);
        const allWaves: WaveCount['allWaves'] = [];
        for (let i = 0; i < pairCount; i++) {
          const p0 = top.pivots[i]; const p1 = top.pivots[i+1];
          allWaves.push({
            label: labels[i] as WaveCount['currentWave']['label'], degree: 'primary', structure: isCorrective ? 'zigzag' : 'impulse',
            startPivot: { index: p0.bar ?? 0, timestamp: p0.ts, price: p0.price, type: p0.isHigh ? 'HH':'LL', timeframe: htfTF },
            endPivot:   { index: p1.bar ?? 0, timestamp: p1.ts, price: p1.price, type: p1.isHigh ? 'HH':'LL', timeframe: htfTF },
            subwaves: [],
          });
        }
        if (!allWaves.length) return;
        const htfWC: WaveCount = {
          id: `htf_${fetchKey}`, ticker: ACTIVE_TICKER, timeframe: htfTF, degree: 'primary',
          currentWave: allWaves[allWaves.length-1], allWaves,
          posterior: { countId: top.id, prior: 0.2, posterior: top.confidence, likelihood_components: {} as WaveCount['posterior']['likelihood_components'], decay_factor: 1, last_updated: Date.now(), invalidation_price: 0, confidence_interval: [0,1], mtf_conflict: false },
          targets: [0,0,0], stopPrice: top.invalidation ?? 0, rrRatio: 0,
          isValid: top.hardViolations.length === 0, violations: top.hardViolations, softWarnings: [], createdAt: Date.now(), updatedAt: Date.now(),
        };
        const mapped = mapHtfToCurrentTF(htfWC, htfCandles, candles);
        setHtfWaveCounts([mapped]);
      })
      .catch(() => { /* no-op — HTF fetch fail is non-critical */ });

    return () => controller.abort();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ewMode, ACTIVE_TICKER, timeframe]);

  // ── Wave History mode: overlapping window scan ─────────────────────────────
  // dep: candles.length (primitive) — avoids the `?? []` new-ref-per-render
  // infinite loop that `candles` (object) in deps would cause.
  const candlesLength = candles.length;
  useEffect(() => {
    if (ewMode !== 'history') {
      setHistoryPatterns((prev) => prev.length > 0 ? [] : prev);
      setHistoryScanning(false);
      historyComputeKey.current = ''; // reset so re-entering history mode re-scans
      return;
    }
    const key = `${ACTIVE_TICKER}_${timeframe}_${candlesLength}`;
    if (historyComputeKey.current === key) return;
    historyComputeKey.current = key;
    if (candlesLength < 20) return;

    setHistoryScanning(true);
    const snapshot = candlesRef.current; // stable snapshot at effect-run time
    setTimeout(() => {
      try {
        const patterns = computeHistoryPatterns(snapshot, timeframe);
        setHistoryPatterns(patterns);
      } catch { /* no-op */ }
      setHistoryScanning(false);
    }, 0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ewMode, ACTIVE_TICKER, timeframe, candlesLength]);

  // Clear mode-specific state on ticker/timeframe change — guard to avoid
  // creating new array references (which would trigger downstream effects).
  useEffect(() => {
    setHtfWaveCounts((prev) => prev.length > 0 ? [] : prev);
    setHistoryPatterns((prev) => prev.length > 0 ? [] : prev);
    historyComputeKey.current = '';
    htfFetchKey.current = '';
    htfCandlesRef.current = [];
  }, [ACTIVE_TICKER, timeframe]);

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
    showEWChannel:      layers.ewChannel,
    showInvalidation:   layers.invalidation,
    showWaveLabels:     layers.waveLabels,
    showWaveProjection: layers.waveProjection,
  }), [layers]);

  const chartBlockH = Math.round(screenH * 0.54);

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
          <TimeframeSelector activeTimeframe={timeframe} onSelect={setTimeframePersisted} />
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
        {/* ── Single outer scroll: everything below the sticky header scrolls ── */}
        <ScrollView
          style={styles.outerScroll}
          contentContainerStyle={styles.outerScrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          scrollEventThrottle={16}
        >
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

          {status === 'success' && candles.length === 0 && (
            <View style={styles.loadingOverlay}>
              <Text style={styles.loadingText}>No {timeframe} data available for {ACTIVE_TICKER}</Text>
            </View>
          )}

          {candles.length > 0 && (
            <>
              {ewMode === 'multi-degree' && (
                <MultiDegreeContextBanner
                  htfWaveCounts={htfWaveCounts}
                  waveCounts={waveCounts}
                />
              )}

              {/* Chart canvas + indicator panel — fixed height so gestures work */}
              <View style={[styles.chartAndIndicator, { height: chartBlockH }]}>
                <View
                  style={styles.chartRow}
                  ref={chartViewRef}
                  onLayout={(e) => setChartH(e.nativeEvent.layout.height)}
                >
                  <CandlestickChart
                    ref={chartRef}
                    height={chartH > 0 ? chartH : undefined}
                    candles={candles}
                    overlays={overlays}
                    ticker={ACTIVE_TICKER}
                    timeframe={timeframe}
                    waveCounts={waveCounts}
                    waveSliceOffset={sliceOffset}
                    gexLevels={gexLevels}
                    activeStopPrice={activeStopPrice}
                    externalTranslateX={translateX}
                    externalCandleW={candleW}
                    onCrosshairActiveChange={setCrosshairActive}
                    onVisibleWindowChange={handleVisibleWindowChange}
                    isHistorical={isHistorical}
                    ewMode={ewMode}
                    htfWaveCounts={htfWaveCounts}
                    historyPatterns={historyPatterns}
                    historyScanning={historyScanning}
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
              </View>

              {/* Scenarios and tools — scroll into view by pulling up */}
              <EarningsCountdownBadge ticker={ACTIVE_TICKER} onPress={() => setShowPlaybook(true)} />
              <ScenarioPanel
                ticker={ACTIVE_TICKER}
                timeframe={timeframe}
                ewMode={ewMode}
                htfWaveCounts={htfWaveCounts}
                confluenceMajorityDir={confluence.score?.majorityDir ?? null}
                confluenceDirectionCount={confluence.score?.directionCount ?? 0}
              />

              {/* Wave Confluence Button */}
              <Pressable
                style={styles.confluenceBtn}
                onPress={() => setShowConfluence(true)}
                hitSlop={4}
              >
                <View style={styles.confluenceBtnLeft}>
                  <Text style={styles.confluenceIcon}>◈</Text>
                  <View>
                    <Text style={styles.confluenceBtnTitle}>Wave Confluence</Text>
                    <Text style={styles.confluenceBtnSub}>{ACTIVE_TICKER} across TFs</Text>
                  </View>
                </View>
                <View style={styles.confluenceBtnRight}>
                  {confluence.score && (
                    <Text style={[
                      styles.confluenceTeaser,
                      { color: confluence.score.label === 'Strong Confluence' ? '#22C55E'
                              : confluence.score.label === 'Moderate Confluence' ? '#EAB308'
                              : confluence.score.label === 'Mixed Signals' ? '#F97316' : '#EF4444' }
                    ]}>
                      {confluence.teaser}
                    </Text>
                  )}
                  {!confluence.score && (
                    <Text style={styles.confluenceTeaserDim}>Tap to analyze →</Text>
                  )}
                  <Text style={styles.confluenceArrow}>→</Text>
                </View>
              </Pressable>

              <SentimentOverlay ticker={ACTIVE_TICKER} timeframe={timeframe} />
              <View style={styles.scrollBottomPad} />
            </>
          )}
        </ScrollView>

        <EarningsPlaybook
          ticker={ACTIVE_TICKER}
          timeframe={timeframe}
          visible={showPlaybook}
          onClose={() => setShowPlaybook(false)}
        />

        <WaveConfluenceModal
          visible={showConfluence}
          onClose={() => setShowConfluence(false)}
          ticker={ACTIVE_TICKER}
          results={confluence.results}
          score={confluence.score}
          onSelectTF={(tf) => {
            const tfMap: Record<string, TimeframeOption> = {
              '5m': '5m', '15m': '15m', '30m': '30m', '1h': '1h', '1D': '1D',
            };
            const mapped = tfMap[tf];
            if (mapped) setTimeframePersisted(mapped);
          }}
        />

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

  chartAndIndicator: { overflow: 'hidden' },
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
  outerScroll: {
    flex: 1,
  },
  outerScrollContent: {
    flexGrow: 1,
  },
  scrollBottomPad: {
    height: 32,
  },
  confluenceBtn: {
    flexDirection:     'row',
    justifyContent:    'space-between',
    alignItems:        'center',
    marginHorizontal:  8,
    marginBottom:      6,
    backgroundColor:   '#1a1a2e',
    borderRadius:      8,
    borderWidth:       1,
    borderColor:       '#2a2a4e',
    paddingHorizontal: 12,
    paddingVertical:   10,
  },
  confluenceBtnLeft: {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           8,
  },
  confluenceIcon: {
    color:    '#FFD700',
    fontSize: 16,
  },
  confluenceBtnTitle: {
    color:      '#C9D1D9',
    fontSize:   13,
    fontWeight: '600',
  },
  confluenceBtnSub: {
    color:    '#6E7681',
    fontSize: 10,
    marginTop: 1,
  },
  confluenceBtnRight: {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           6,
  },
  confluenceTeaser: {
    fontSize:   10,
    fontWeight: '600',
  },
  confluenceTeaserDim: {
    color:    '#444',
    fontSize: 10,
  },
  confluenceArrow: {
    color:    '#555',
    fontSize: 12,
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
