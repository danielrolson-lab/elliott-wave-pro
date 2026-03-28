/**
 * ScenarioPanel.tsx
 *
 * Displays up to 4 Elliott Wave count scenarios ranked by posterior probability.
 *
 * Layout:
 *   ┌─ header ─────────────────────────────────────────────┐
 *   │ SCENARIOS                             (i) [ℹ info]   │
 *   ├──────────────────────────────────────────────────────┤
 *   │ ScenarioCard rank=0 (primary,   full opacity)        │
 *   │ ScenarioCard rank=1 (secondary, 35% opacity)         │
 *   │ ScenarioCard rank=2 (collapsed, 35% opacity)         │
 *   │ ScenarioCard rank=3 (collapsed, 35% opacity)         │
 *   └──────────────────────────────────────────────────────┘
 *
 * Animated reorder: each card is wrapped in an Animated.View whose key is the
 * count ID.  When probabilities shift and the array reorders, React moves the
 * keyed elements and react-native-reanimated animates the layout transition
 * using a spring-based LinearTransition.
 *
 * The panel reads directly from the Zustand waveCount store — no prop drilling.
 */

import React, { useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import Animated, { LinearTransition } from 'react-native-reanimated';
import { useShallow } from 'zustand/react/shallow';
import { useWaveCountStore } from '../../stores/waveCount';
import { useMarketDataStore } from '../../stores/marketData';
import { ScenarioCard } from './ScenarioCard';
import { ScenarioCommentary } from './ScenarioCommentary';
import { DARK } from '../../theme/colors';

// ── Layout spring config ──────────────────────────────────────────────────────

const LAYOUT_ANIM = LinearTransition.springify().damping(16).stiffness(110);

// ── Calibration info text ─────────────────────────────────────────────────────

const CALIBRATION_NOTE =
  'Probabilities reflect Bayesian scoring across 8 factors: Fibonacci ' +
  'confluence, volume profile, RSI divergence, MACD momentum, MTF alignment, ' +
  'time symmetry, breadth, and GEX regime. Not a guarantee of outcome.';

// ── Component ─────────────────────────────────────────────────────────────────

export interface ScenarioPanelProps {
  ticker:    string;
  timeframe: string;
}

export function ScenarioPanel({ ticker, timeframe }: ScenarioPanelProps) {
  const counts = useWaveCountStore(
    useShallow((s) => s.counts[`${ticker}_${timeframe}`] ?? []),
  );
  const pinCount      = useWaveCountStore((s) => s.pinCount);
  const quotes        = useMarketDataStore((s) => s.quotes);
  const currentPrice  = quotes[ticker]?.last ?? 0;

  const [showInfo,    setShowInfo]    = useState(false);
  const [expandedId,  setExpandedId]  = useState<string | null>(null);

  if (counts.length === 0) {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.title}>SCENARIOS</Text>
        </View>
        <View style={styles.empty}>
          <Text style={styles.emptyText}>Computing wave counts…</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* ── Header ── */}
      <View style={styles.header}>
        <Text style={styles.title}>SCENARIOS</Text>
        <Pressable
          onPress={() => setShowInfo((v) => !v)}
          hitSlop={8}
          accessibilityLabel="Scenario probability info"
        >
          <Text style={styles.infoIcon}>ⓘ</Text>
        </Pressable>
      </View>

      {/* ── Info tooltip ── */}
      {showInfo && (
        <View style={styles.infoBox}>
          <Text style={styles.infoText}>{CALIBRATION_NOTE}</Text>
        </View>
      )}

      {/* ── Scenario cards (animated reorder) ── */}
      {counts.slice(0, 4).map((count, index) => {
        const isExpanded = expandedId !== null ? count.id === expandedId : index < 2;
        return (
          <Animated.View
            key={count.id}
            layout={LAYOUT_ANIM}
          >
            <ScenarioCard
              count={count}
              rank={index}
              isExpanded={isExpanded}
              currentPrice={currentPrice}
              onPress={() => {
                setExpandedId(count.id === expandedId ? null : count.id);
                pinCount(`${ticker}_${timeframe}`, count.id);
              }}
            />
          </Animated.View>
        );
      })}

      {/* ── AI commentary (primary count only) ── */}
      <ScenarioCommentary ticker={ticker} timeframe={timeframe} />
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    backgroundColor: DARK.background,
    borderTopWidth:  1,
    borderTopColor:  DARK.separator,
    paddingHorizontal: 10,
    paddingTop:        6,
    paddingBottom:     8,
  },

  // Header row
  header: {
    flexDirection:  'row',
    alignItems:     'center',
    justifyContent: 'space-between',
    marginBottom:   6,
  },
  title: {
    color:     DARK.textMuted,
    fontSize:  10,
    fontWeight: '700',
    letterSpacing: 1.2,
  },
  infoIcon: {
    color:    DARK.textMuted,
    fontSize: 13,
  },

  // Info tooltip box
  infoBox: {
    backgroundColor: DARK.surfaceRaised,
    borderRadius:    6,
    borderWidth:     1,
    borderColor:     DARK.border,
    padding:         8,
    marginBottom:    6,
  },
  infoText: {
    color:      DARK.textSecondary,
    fontSize:   11,
    lineHeight: 16,
  },

  // Empty state
  empty: {
    alignItems:     'center',
    justifyContent: 'center',
    paddingVertical: 16,
  },
  emptyText: {
    color:    DARK.textMuted,
    fontSize: 12,
  },
});
