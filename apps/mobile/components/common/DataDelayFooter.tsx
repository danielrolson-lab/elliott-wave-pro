/**
 * components/common/DataDelayFooter.tsx
 *
 * Shows the timestamp of the most recent candle (or fallback quote),
 * an estimated delay in minutes, and the data source tier.
 *
 * Usage:
 *   <DataDelayFooter ticker="SPY" timeframe="5m" />
 *
 * When no candles are available, falls back to a generic "15 min delay" label.
 */

import React, { useMemo } from 'react';
import { Text, View, StyleSheet } from 'react-native';
import { useMarketDataStore } from '../../stores/marketData';

interface Props {
  ticker:    string;
  timeframe: string;
}

function formatET(ts: number): string {
  return new Date(ts).toLocaleTimeString('en-US', {
    timeZone:  'America/New_York',
    hour:      'numeric',
    minute:    '2-digit',
    hour12:    true,
  });
}

export function DataDelayFooter({ ticker, timeframe }: Props) {
  const candles = useMarketDataStore((s) => s.candles[`${ticker}_${timeframe}`]);

  const { timeLabel, delayMins } = useMemo(() => {
    if (!candles || candles.length === 0) {
      return { timeLabel: null, delayMins: 15 };
    }
    const last = candles[candles.length - 1];
    const now  = Date.now();
    const mins = Math.round((now - last.timestamp) / 60_000);
    return {
      timeLabel: formatET(last.timestamp),
      delayMins: Math.max(mins, 0),
    };
  }, [candles]);

  return (
    <View style={styles.row}>
      <Text style={styles.text}>
        {timeLabel ? `Last candle: ${timeLabel} ET · ` : ''}
        {delayMins} min delay · Polygon Stocks Starter
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    paddingHorizontal: 14,
    paddingVertical:    4,
    alignItems:        'center',
  },
  text: {
    color:    '#6E7681',
    fontSize:  10,
    textAlign: 'center',
  },
});
