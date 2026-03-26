/**
 * TimeframeSelector.tsx
 *
 * Horizontal pill row that lets the user switch chart timeframes.
 * The active pill fades in over 150 ms via React Native's Animated API.
 */

import React, { useEffect, useRef } from 'react';
import {
  Text,
  TouchableOpacity,
  StyleSheet,
  Animated,
  ScrollView,
} from 'react-native';
import { CHART_COLORS, TIMEFRAMES, type TimeframeOption } from './chartTypes';

interface TimeframeSelectorProps {
  activeTimeframe: TimeframeOption;
  onSelect: (tf: TimeframeOption) => void;
}

export function TimeframeSelector({ activeTimeframe, onSelect }: TimeframeSelectorProps) {
  // One opacity animated value per timeframe for the active-pill crossfade
  const opacities = useRef<Record<string, Animated.Value>>(
    Object.fromEntries(
      TIMEFRAMES.map((tf) => [tf, new Animated.Value(tf === activeTimeframe ? 1 : 0)]),
    ),
  ).current;

  useEffect(() => {
    const animations = TIMEFRAMES.map((tf) =>
      Animated.timing(opacities[tf], {
        toValue: tf === activeTimeframe ? 1 : 0,
        duration: 150,
        useNativeDriver: true,
      }),
    );
    Animated.parallel(animations).start();
  }, [activeTimeframe, opacities]);

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.scrollContent}
      style={styles.container}
    >
      {TIMEFRAMES.map((tf) => (
        <TouchableOpacity
          key={tf}
          onPress={() => onSelect(tf)}
          activeOpacity={0.75}
          style={styles.pill}
        >
          {/* Active background fades in/out */}
          <Animated.View
            style={[StyleSheet.absoluteFill, styles.activeBg, { opacity: opacities[tf] }]}
          />
          <Text
            style={[
              styles.pillText,
              activeTimeframe === tf ? styles.pillTextActive : styles.pillTextInactive,
            ]}
          >
            {tf}
          </Text>
        </TouchableOpacity>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 0,
    backgroundColor: CHART_COLORS.background,
  },
  scrollContent: {
    paddingHorizontal: 8,
    paddingVertical: 6,
    gap: 4,
    flexDirection: 'row',
    alignItems: 'center',
  },
  pill: {
    position: 'relative',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: CHART_COLORS.tfBorder,
    backgroundColor: CHART_COLORS.tfInactiveBg,
    overflow: 'hidden',
    minWidth: 36,
    alignItems: 'center',
  },
  activeBg: {
    backgroundColor: CHART_COLORS.tfActiveBg,
    borderRadius: 5,
  },
  pillText: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
  pillTextActive: {
    color: CHART_COLORS.tfActiveText,
  },
  pillTextInactive: {
    color: CHART_COLORS.tfText,
  },
});
