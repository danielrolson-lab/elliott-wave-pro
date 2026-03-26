/**
 * RegimeBadge.tsx
 *
 * Compact pill badge showing the current market regime for a ticker.
 * Used on HomeScreen, ScenarioCard, and WatchlistCard.
 *
 * Sizes:
 *   'sm'  — 9px text, tight padding  (ScenarioCard, WatchlistCard)
 *   'md'  — 11px text                (HomeScreen)
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useMarketDataStore }  from '../../stores/marketData';
import { REGIME_META }         from '../../utils/regimeClassifier';
import type { MarketRegime }   from '@elliott-wave-pro/wave-engine';

export type RegimeBadgeSize = 'sm' | 'md';

interface RegimeBadgeProps {
  ticker: string;
  size?:  RegimeBadgeSize;
}

export function RegimeBadge({ ticker, size = 'md' }: RegimeBadgeProps) {
  const regime = useMarketDataStore((s) => s.regimes[ticker] as MarketRegime | undefined);

  if (!regime) return null;

  const meta     = REGIME_META[regime];
  const fontSize = size === 'sm' ? 8 : 10;
  const px       = size === 'sm' ? 5 : 7;
  const py       = size === 'sm' ? 1 : 2;

  return (
    <View style={[styles.badge, { borderColor: meta.color, paddingHorizontal: px, paddingVertical: py }]}>
      <Text style={[styles.text, { color: meta.color, fontSize }]}>
        {meta.shortLabel}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    borderWidth:  1,
    borderRadius: 4,
  },
  text: {
    fontWeight:    '700',
    letterSpacing: 0.4,
  },
});
