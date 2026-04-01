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
import { useFont, type SkFont } from '@shopify/react-native-skia';
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

export interface VisiblePages {
  rsi:    boolean;
  macd:   boolean;
  volume: boolean;
  cvd:    boolean;
}

export interface IndicatorPanelProps {
  ticker:       string;
  timeframe:    string;
  candles:      readonly OHLCV[];
  translateX:   SharedValue<number>;
  candleW:      SharedValue<number>;
  visiblePages?: VisiblePages;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function IndicatorPanel({
  ticker,
  timeframe,
  candles,
  translateX,
  candleW,
  visiblePages,
}: IndicatorPanelProps) {
  const font: SkFont | null = useFont(require('../../assets/fonts/Roboto-Regular.ttf'), 10);
  const { width: screenW } = useWindowDimensions();
  const scrollRef = useRef<ScrollView>(null);
  const [activePage, setActivePage] = useState<PageIndex>(0);

  // Build the list of visible page labels based on the visiblePages prop
  const visiblePageLabels = PAGES.filter((p) => {
    if (!visiblePages) return true;
    if (p === 'RSI 14')         return visiblePages.rsi;
    if (p === 'MACD (12,26,9)') return visiblePages.macd;
    if (p === 'Volume')         return visiblePages.volume;
    if (p === 'CVD')            return visiblePages.cvd;
    return true;
  });

  // If all pages are hidden, render nothing
  if (visiblePageLabels.length === 0) return null;

  // Clamp activePage if the selected index is now out of range
  const clampedPage = Math.min(activePage, (visiblePageLabels.length - 1) as PageIndex) as PageIndex;

  const handleScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const page = Math.round(e.nativeEvent.contentOffset.x / screenW) as PageIndex;
    if (page !== clampedPage) setActivePage(page);
  };

  const sharedProps = {
    ticker,
    timeframe,
    translateX,
    candleW,
    font,
    numCandles: candles.length,
  };

  const showRSI    = !visiblePages || visiblePages.rsi;
  const showMACD   = !visiblePages || visiblePages.macd;
  const showVolume = !visiblePages || visiblePages.volume;
  const showCVD    = !visiblePages || visiblePages.cvd;

  return (
    <View style={styles.wrapper}>
      {/* ── Header: label + page dots ── */}
      <View style={styles.header}>
        <Text style={styles.pageLabel}>{visiblePageLabels[clampedPage]}</Text>
        <View style={styles.dots}>
          {visiblePageLabels.map((_, i) => (
            <View
              key={i}
              style={[styles.dot, i === clampedPage && styles.dotActive]}
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
        {/* RSI page (conditional) */}
        {showRSI && (
          <View style={{ width: screenW }}>
            <RSIIndicator {...sharedProps} />
          </View>
        )}

        {/* MACD page (conditional) */}
        {showMACD && (
          <View style={{ width: screenW }}>
            <MACDIndicator {...sharedProps} />
          </View>
        )}

        {/* Volume page (conditional) */}
        {showVolume && (
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
        )}

        {/* CVD page (conditional) */}
        {showCVD && (
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
        )}
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
