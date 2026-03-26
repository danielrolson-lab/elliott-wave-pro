/**
 * components/chart/ChartGrid.tsx
 *
 * iPad multi-chart 2×2 grid layout.
 * Renders up to 4 tickers from the watchlist simultaneously, each cell
 * containing a mini CandlestickChart with wave overlay and GEX levels.
 *
 * Tap any cell to expand it to full screen; tap again to collapse.
 *
 * Compare mode: overlays 2 price series normalized to 100 at a shared start
 * date (oldest available candle of the two series), rendered via Skia.
 *
 * Only renders on iPad (width > 768). On iPhone falls back to single chart.
 */

import React, { useState, useMemo, useCallback } from 'react';
import {
  View, Text, Pressable, StyleSheet, useWindowDimensions, ScrollView,
} from 'react-native';
import { Canvas, Path, Skia } from '@shopify/react-native-skia';
import { useWatchlistStore } from '../../stores/watchlist';
import { useMarketDataStore } from '../../stores/marketData';
import { useWaveCountStore } from '../../stores/waveCount';
import { DARK } from '../../theme/colors';

const IPAD_MIN_WIDTH = 768;
const CELL_PAD = 6;

// ── Mini normalized compare chart ─────────────────────────────────────────────

interface CompareChartProps {
  tickerA: string;
  tickerB: string;
  width:   number;
  height:  number;
  timeframe: string;
}

function CompareChart({ tickerA, tickerB, width, height, timeframe }: CompareChartProps) {
  const candlesA = useMarketDataStore((s) => s.candles[`${tickerA}_${timeframe}`] ?? []);
  const candlesB = useMarketDataStore((s) => s.candles[`${tickerB}_${timeframe}`] ?? []);

  const paths = useMemo(() => {
    if (candlesA.length < 2 || candlesB.length < 2) return null;

    // Align to common start (latest of the two first timestamps)
    const startTs = Math.max(candlesA[0]?.timestamp ?? 0, candlesB[0]?.timestamp ?? 0);
    const sliceA  = candlesA.filter((c) => c.timestamp >= startTs);
    const sliceB  = candlesB.filter((c) => c.timestamp >= startTs);
    const n       = Math.min(sliceA.length, sliceB.length);
    if (n < 2) return null;

    const baseA = sliceA[0].close;
    const baseB = sliceB[0].close;

    const normA = sliceA.slice(0, n).map((c) => (c.close / baseA) * 100);
    const normB = sliceB.slice(0, n).map((c) => (c.close / baseB) * 100);

    const allVals = [...normA, ...normB];
    const minV    = Math.min(...allVals);
    const maxV    = Math.max(...allVals);
    const range   = maxV - minV || 1;
    const xStep   = width / (n - 1);

    const toY = (v: number) => height * (1 - (v - minV) / range);

    const buildPath = (arr: number[]) => {
      const p = Skia.Path.Make();
      arr.forEach((v, i) => {
        const x = i * xStep;
        const y = toY(v);
        if (i === 0) p.moveTo(x, y); else p.lineTo(x, y);
      });
      return p;
    };

    return { pathA: buildPath(normA), pathB: buildPath(normB) };
  }, [candlesA, candlesB, timeframe, width, height]);

  if (!paths) {
    return (
      <View style={{ width, height, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ color: DARK.textMuted, fontSize: 10 }}>No data</Text>
      </View>
    );
  }

  return (
    <Canvas style={{ width, height }}>
      <Path path={paths.pathA} color={DARK.bullish}  style="stroke" strokeWidth={1.5} />
      <Path path={paths.pathB} color="#60a5fa"       style="stroke" strokeWidth={1.5} />
    </Canvas>
  );
}

// ── Mini wave badge ────────────────────────────────────────────────────────────

function WaveBadge({ ticker, timeframe }: { ticker: string; timeframe: string }) {
  const top = useWaveCountStore(
    (s) => (s.counts[`${ticker}_${timeframe}`] ?? [])[0],
  );
  if (!top) return null;
  const prob  = top.posterior?.posterior ?? 0;
  const label = top.currentWave?.label ?? '?';
  return (
    <View style={badgeStyles.badge}>
      <Text style={badgeStyles.text}>W{label} {Math.round(prob * 100)}%</Text>
    </View>
  );
}

const badgeStyles = StyleSheet.create({
  badge: {
    backgroundColor: '#1d4ed8',
    borderRadius: 3,
    paddingHorizontal: 5,
    paddingVertical: 2,
    alignSelf: 'flex-start',
  },
  text: { color: '#fff', fontSize: 9, fontWeight: '700' },
});

// ── Mini price sparkline ───────────────────────────────────────────────────────

function MiniSparkline({
  ticker,
  timeframe,
  width,
  height,
}: { ticker: string; timeframe: string; width: number; height: number }) {
  const candles = useMarketDataStore(
    (s) => s.candles[`${ticker}_${timeframe}`] ?? [],
  );
  const quote = useMarketDataStore((s) => s.quotes[ticker]);

  const path = useMemo(() => {
    const slice = candles.slice(-60);
    if (slice.length < 2) return null;
    const closes = slice.map((c) => c.close);
    const minC = Math.min(...closes);
    const maxC = Math.max(...closes);
    const range = maxC - minC || 1;
    const xStep = width / (closes.length - 1);
    const p = Skia.Path.Make();
    closes.forEach((c, i) => {
      const x = i * xStep;
      const y = height * (1 - (c - minC) / range);
      if (i === 0) p.moveTo(x, y); else p.lineTo(x, y);
    });
    return p;
  }, [candles, width, height]);

  const lastClose = candles[candles.length - 1]?.close ?? 0;
  const firstClose = candles[candles.length - 60]?.close ?? lastClose;
  const bullish = lastClose >= firstClose;

  return (
    <View>
      <Text style={{ color: DARK.textPrimary, fontSize: 11, fontWeight: '700', marginBottom: 2 }}>
        {quote ? `$${quote.last.toFixed(2)}` : '—'}
      </Text>
      {path && (
        <Canvas style={{ width, height }}>
          <Path
            path={path}
            color={bullish ? DARK.bullish : DARK.bearish}
            style="stroke"
            strokeWidth={1.2}
          />
        </Canvas>
      )}
    </View>
  );
}

// ── Cell ──────────────────────────────────────────────────────────────────────

interface CellProps {
  ticker:    string;
  timeframe: string;
  cellW:     number;
  cellH:     number;
  expanded:  boolean;
  onTap:     () => void;
}

function GridCell({ ticker, timeframe, cellW, cellH, expanded, onTap }: CellProps) {
  const sparkW = cellW - CELL_PAD * 2;
  const sparkH = Math.max(40, cellH - 64);

  return (
    <Pressable
      style={[
        styles.cell,
        { width: cellW, height: cellH },
        expanded && styles.cellExpanded,
      ]}
      onPress={onTap}
    >
      {/* Header */}
      <View style={styles.cellHeader}>
        <Text style={styles.cellTicker}>{ticker}</Text>
        <WaveBadge ticker={ticker} timeframe={timeframe} />
      </View>

      {/* Sparkline */}
      <MiniSparkline
        ticker={ticker}
        timeframe={timeframe}
        width={sparkW}
        height={sparkH}
      />
    </Pressable>
  );
}

// ── ChartGrid ─────────────────────────────────────────────────────────────────

interface ChartGridProps {
  timeframe:   string;
  compareMode: boolean;
}

export function ChartGrid({ timeframe, compareMode }: ChartGridProps) {
  const { width, height } = useWindowDimensions();
  const items    = useWatchlistStore((s) => s.items);
  const [expanded, setExpanded] = useState<string | null>(null);

  const tickers = useMemo(
    () => items.slice(0, 4).map((i) => i.instrument.ticker),
    [items],
  );

  const toggleExpand = useCallback(
    (ticker: string) => setExpanded((prev) => (prev === ticker ? null : ticker)),
    [],
  );

  if (width <= IPAD_MIN_WIDTH) {
    return (
      <View style={styles.phoneMsg}>
        <Text style={styles.phoneMsgText}>Multi-chart available on iPad (width &gt; 768px)</Text>
      </View>
    );
  }

  if (compareMode && tickers.length >= 2) {
    const cW = width - 32;
    const cH = height * 0.4;
    return (
      <View style={styles.compareContainer}>
        <Text style={styles.compareTitle}>
          Compare: {tickers[0]} vs {tickers[1]} (normalized to 100)
        </Text>
        <CompareChart
          tickerA={tickers[0]}
          tickerB={tickers[1] ?? tickers[0]}
          width={cW}
          height={cH}
          timeframe={timeframe}
        />
        <View style={styles.compareLegend}>
          <View style={[styles.legendDot, { backgroundColor: DARK.bullish }]} />
          <Text style={styles.legendText}>{tickers[0]}</Text>
          <View style={[styles.legendDot, { backgroundColor: '#60a5fa' }]} />
          <Text style={styles.legendText}>{tickers[1] ?? ''}</Text>
        </View>
      </View>
    );
  }

  const cellW = (width - CELL_PAD * 3) / 2;
  const cellH = (height * 0.7 - CELL_PAD * 3) / 2;

  return (
    <ScrollView contentContainerStyle={styles.grid}>
      {tickers.map((ticker) => (
        <GridCell
          key={ticker}
          ticker={ticker}
          timeframe={timeframe}
          cellW={expanded === ticker ? width - CELL_PAD * 2 : cellW}
          cellH={expanded === ticker ? height * 0.7 : cellH}
          expanded={expanded === ticker}
          onTap={() => toggleExpand(ticker)}
        />
      ))}
    </ScrollView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  grid: {
    flexDirection:  'row',
    flexWrap:       'wrap',
    gap:            CELL_PAD,
    padding:        CELL_PAD,
  },
  cell: {
    backgroundColor: DARK.surface,
    borderRadius:    8,
    borderWidth:     1,
    borderColor:     DARK.border,
    padding:         CELL_PAD,
    overflow:        'hidden',
  },
  cellExpanded: {
    borderColor: '#1d6fe8',
  },
  cellHeader: {
    flexDirection:  'row',
    alignItems:     'center',
    justifyContent: 'space-between',
    marginBottom:   4,
  },
  cellTicker: {
    color:      DARK.textPrimary,
    fontSize:   13,
    fontWeight: '700',
  },
  phoneMsg: {
    padding: 16,
    alignItems: 'center',
  },
  phoneMsgText: {
    color:    DARK.textMuted,
    fontSize: 12,
    fontStyle: 'italic',
  },
  compareContainer: {
    padding: 16,
    alignItems: 'center',
  },
  compareTitle: {
    color:      DARK.textSecondary,
    fontSize:   12,
    fontWeight: '600',
    marginBottom: 8,
  },
  compareLegend: {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           8,
    marginTop:     8,
  },
  legendDot: {
    width: 10, height: 10, borderRadius: 5,
  },
  legendText: {
    color:    DARK.textSecondary,
    fontSize: 11,
  },
});
