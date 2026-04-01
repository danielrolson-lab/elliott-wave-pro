/**
 * components/common/DataDelayFooter.tsx
 *
 * Shows when watchlist prices were last fetched and the Polygon Starter delay.
 *
 * Reads `lastIntradayAt` (Unix ms) from the watchlist store — stamped by
 * useWatchlistPrices every time applyIntradayUpdate succeeds. This avoids
 * reading candle timestamps, which can be stale if usePolygonCandles (chart
 * backfill) wrote an early-morning snapshot to the same store key.
 *
 * Displayed time = lastIntradayAt − 15 min (the Polygon Stocks Starter delay).
 * Falls back to "~15 min delay" while the first fetch is in-flight.
 */

import React, { useEffect, useState } from 'react';
import { Text, View, StyleSheet } from 'react-native';
import { useWatchlistStore } from '../../stores/watchlist';

// Props kept for call-site compatibility; ticker/timeframe no longer used here.
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

export function DataDelayFooter(_props: Props) {
  const lastIntradayAt = useWatchlistStore((s) => s.lastIntradayAt);

  // Re-render every 60 s so the "X min ago" counter stays fresh.
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  let label: string;
  if (lastIntradayAt === 0) {
    label = '~15 min delay · Polygon Stocks Starter';
  } else {
    // Polygon Starter data is 15 min delayed — the bar we just fetched
    // represents market data from ~15 min before the fetch time.
    const dataAsOf  = lastIntradayAt - 15 * 60_000;
    const fetchedMs = Date.now() - lastIntradayAt;
    const fetchedMin = Math.round(fetchedMs / 60_000);
    const timeStr   = formatET(dataAsOf);
    const fetchedStr = fetchedMin <= 1 ? 'just now' : `${fetchedMin} min ago`;
    label = `Data as of ${timeStr} ET · refreshed ${fetchedStr} · Polygon Stocks Starter`;
  }

  return (
    <View style={styles.row}>
      <Text style={styles.text}>{label}</Text>
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
