/**
 * ChartScreen (app/chart.tsx)
 *
 * Chart tab root — hosts the full CandlestickChart + IndicatorPanel
 * with synthetic SPY data. Live data wiring happens in a later deliverable.
 */

import React, { useMemo, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useSharedValue } from 'react-native-reanimated';
import { CandlestickChart }  from '../components/chart/CandlestickChart';
import { TimeframeSelector } from '../components/chart/TimeframeSelector';
import { IndicatorPanel }    from '../components/chart/IndicatorPanel';
import { CHART_COLORS, CHART_LAYOUT, type TimeframeOption } from '../components/chart/chartTypes';
import { useWaveEngine }   from '../hooks/useWaveEngine';
import { useIndicators }   from '../hooks/useIndicators';
import type { OHLCV }      from '@elliott-wave-pro/wave-engine';

// ── Synthetic dataset (same generator as App.tsx) ────────────────────────────

function mulberry32(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface PhaseSpec { bars: number; start: number; end: number; vol: number; }

const PHASES: PhaseSpec[] = [
  { bars: 30, start: 575.00, end: 575.50, vol:  72_000 },
  { bars: 25, start: 575.00, end: 586.00, vol:  96_000 },
  { bars: 18, start: 586.00, end: 579.80, vol:  64_000 },
  { bars: 42, start: 579.80, end: 601.80, vol: 144_000 },
  { bars: 22, start: 601.80, end: 594.30, vol:  60_000 },
  { bars: 28, start: 594.30, end: 604.00, vol:  88_000 },
  { bars: 30, start: 604.00, end: 596.00, vol:  68_000 },
  { bars: 20, start: 596.00, end: 597.00, vol:  56_000 },
];

function generateCandles(): OHLCV[] {
  const rand = mulberry32(0xdeadbeef);
  const candles: OHLCV[] = [];
  let ts = 1742217000000;
  const BAR_MS = 5 * 60 * 1000;
  let prevClose = PHASES[0].start;

  for (const phase of PHASES) {
    const movePerBar = (phase.end - phase.start) / phase.bars;
    const dir = movePerBar >= 0 ? 1 : -1;
    for (let b = 0; b < phase.bars; b++) {
      const targetClose = phase.start + movePerBar * (b + 1);
      const noise  = (rand() - 0.5) * 0.6;
      const open   = prevClose + noise * 0.3;
      const drift  = dir * (rand() * 0.25 + 0.02);
      const rawClose = open + drift + (rand() - 0.5) * 0.2;
      const close  = rawClose * 0.4 + targetClose * 0.6;
      const high   = Math.max(open, close) + rand() * 0.4;
      const low    = Math.min(open, close) - rand() * 0.4;
      const volume = Math.round(phase.vol * (0.7 + rand() * 0.6));
      candles.push({ timestamp: ts, open, high, low, close, volume });
      prevClose = close;
      ts += BAR_MS;
    }
  }
  return candles;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function ChartScreen() {
  const candles   = useMemo(generateCandles, []);
  const [timeframe, setTimeframe] = useState<TimeframeOption>('5m');

  const translateX = useSharedValue(0);
  const candleW    = useSharedValue<number>(CHART_LAYOUT.candleDefaultW);

  const { waveCounts, sliceOffset } = useWaveEngine('SPY', timeframe, candles);
  useIndicators('SPY', timeframe, candles);

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
        <TimeframeSelector activeTimeframe={timeframe} onSelect={setTimeframe} />
        <CandlestickChart
          candles={candles}
          overlays={overlays}
          ticker="SPY"
          waveCounts={waveCounts}
          waveSliceOffset={sliceOffset}
          externalTranslateX={translateX}
          externalCandleW={candleW}
        />
        <IndicatorPanel
          ticker="SPY"
          timeframe={timeframe}
          candles={candles}
          translateX={translateX}
          candleW={candleW}
          font={null}
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
});
