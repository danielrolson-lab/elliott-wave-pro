/**
 * IndicatorPanel.tsx
 *
 * Horizontal swipeable pager hosting the three sub-indicator canvases.
 *
 * Layout:
 *   ┌─────────────────────────────────────────────┐
 *   │  MACD (12,26,9)              ○ ● ○           │  ← header row
 *   ├─────────────────────────────────────────────┤
 *   │  [RSI page] [MACD page] [Volume page]        │  ← horizontal pager
 *   └─────────────────────────────────────────────┘
 *
 * Pages are all mounted simultaneously for instant, frame-perfect swipes.
 * The RSI, MACD, and Volume canvases share the same translateX / candleW
 * SharedValues as the main chart, so they scroll and zoom in sync.
 */

import React, { useRef, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  type NativeSyntheticEvent,
  type NativeScrollEvent,
} from 'react-native';
import type { SharedValue } from 'react-native-reanimated';
import type { SkFont } from '@shopify/react-native-skia';
import type { OHLCV } from '@elliott-wave-pro/wave-engine';
import { RSIIndicator,    INDICATOR_H } from '../indicators/RSIIndicator';
import { MACDIndicator }   from '../indicators/MACDIndicator';
import { VolumeIndicator } from '../indicators/VolumeIndicator';
import { CVDIndicator }    from '../indicators/CVDIndicator';
import { CHART_COLORS }    from './chartTypes';

// ── Page definitions ──────────────────────────────────────────────────────────

const PAGES = ['RSI 14', 'MACD (12,26,9)', 'Volume', 'CVD'] as const;
type PageIndex = 0 | 1 | 2 | 3;

// ── Props ─────────────────────────────────────────────────────────────────────

export interface IndicatorPanelProps {
  ticker:     string;
  timeframe:  string;
  candles:    readonly OHLCV[];
  translateX: SharedValue<number>;
  candleW:    SharedValue<number>;
  font:       SkFont | null;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function IndicatorPanel({
  ticker,
  timeframe,
  candles,
  translateX,
  candleW,
  font,
}: IndicatorPanelProps) {
  const { width: screenW } = useWindowDimensions();
  const scrollRef = useRef<ScrollView>(null);
  const [activePage, setActivePage] = useState<PageIndex>(0);

  const handleScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const page = Math.round(e.nativeEvent.contentOffset.x / screenW) as PageIndex;
    if (page !== activePage) setActivePage(page);
  };

  const sharedProps = {
    ticker,
    timeframe,
    translateX,
    candleW,
    font,
    numCandles: candles.length,
  };

  return (
    <View style={styles.wrapper}>
      {/* ── Header: label + page dots ── */}
      <View style={styles.header}>
        <Text style={styles.pageLabel}>{PAGES[activePage]}</Text>
        <View style={styles.dots}>
          {PAGES.map((_, i) => (
            <View
              key={i}
              style={[styles.dot, i === activePage && styles.dotActive]}
            />
          ))}
        </View>
      </View>

      {/* ── Pager ── */}
      <ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        scrollEventThrottle={64}
        onMomentumScrollEnd={handleScroll}
        onScroll={handleScroll}
        style={styles.pager}
      >
        {/* Page 0: RSI */}
        <View style={{ width: screenW }}>
          <RSIIndicator {...sharedProps} />
        </View>

        {/* Page 1: MACD */}
        <View style={{ width: screenW }}>
          <MACDIndicator {...sharedProps} />
        </View>

        {/* Page 2: Volume */}
        <View style={{ width: screenW }}>
          <VolumeIndicator
            ticker={ticker}
            timeframe={timeframe}
            candles={candles}
            translateX={translateX}
            candleW={candleW}
            font={font}
          />
        </View>

        {/* Page 3: CVD */}
        <View style={{ width: screenW }}>
          <CVDIndicator
            ticker={ticker}
            timeframe={timeframe}
            translateX={translateX}
            candleW={candleW}
            font={font}
            numCandles={candles.length}
          />
        </View>
      </ScrollView>
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  wrapper: {
    backgroundColor: CHART_COLORS.background,
    borderTopWidth: 1,
    borderTopColor: CHART_COLORS.gridLine,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 10,
    paddingVertical: 4,
    backgroundColor: CHART_COLORS.background,
  },
  pageLabel: {
    color: CHART_COLORS.textMuted,
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.3,
  },
  dots: {
    flexDirection: 'row',
    gap: 5,
    alignItems: 'center',
  },
  dot: {
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: CHART_COLORS.gridLine,
  },
  dotActive: {
    backgroundColor: CHART_COLORS.textPrimary,
  },
  pager: {
    height: INDICATOR_H,
  },
});
