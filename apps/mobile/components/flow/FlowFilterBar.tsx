/**
 * FlowFilterBar.tsx
 *
 * Horizontal filter controls for the options flow tape.
 *
 *   [Min $] ─ [$10K] [$50K] [$100K] [$500K] [$1M+]
 *   [Type]  ─ [All] [Sweeps] [Blocks] [Unusual]
 *   [Side]  ─ [All] [Bullish] [Bearish]
 */

import React from 'react';
import {
  View,
  Text,
  Pressable,
  ScrollView,
  StyleSheet,
} from 'react-native';
import { useFlowStore } from '../../stores/flow';
import type { MinPremiumTier, FlowTypeFilter } from '../../stores/flow';
import { PREMIUM_TIERS } from '../../stores/flow';
import { DARK } from '../../theme/colors';

// ── Format premium tier labels ────────────────────────────────────────────────

function fmtTier(n: number): string {
  if (n >= 1_000_000) return '$1M+';
  if (n >= 500_000)   return '$500K';
  if (n >= 100_000)   return '$100K';
  if (n >= 50_000)    return '$50K';
  return '$10K';
}

// ── Generic pill row ──────────────────────────────────────────────────────────

interface PillRowProps<T extends string | number> {
  label:    string;
  options:  readonly T[];
  active:   T;
  format?:  (v: T) => string;
  onChange: (v: T) => void;
}

function PillRow<T extends string | number>({
  label,
  options,
  active,
  format,
  onChange,
}: PillRowProps<T>) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.pills}>
        {options.map((opt) => {
          const isActive = opt === active;
          const text = format ? format(opt) : String(opt);
          return (
            <Pressable
              key={String(opt)}
              style={[styles.pill, isActive && styles.pillActive]}
              onPress={() => onChange(opt)}
              hitSlop={6}
            >
              <Text style={[styles.pillText, isActive && styles.pillTextActive]}>
                {text}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function FlowFilterBar() {
  const filter     = useFlowStore((s) => s.filter);
  const setFilter  = useFlowStore((s) => s.setFilter);

  const TYPE_OPTIONS: FlowTypeFilter[] = ['all', 'sweeps', 'blocks', 'unusual'];
  const SENTIMENT_OPTIONS = ['all', 'bullish', 'bearish'] as const;

  const TYPE_LABELS: Record<FlowTypeFilter, string> = {
    all:     'All',
    sweeps:  'Sweeps',
    blocks:  'Blocks',
    unusual: 'Unusual',
  };

  return (
    <View style={styles.container}>
      <PillRow
        label="Min $"
        options={PREMIUM_TIERS}
        active={filter.minPremium}
        format={(v) => fmtTier(v as number)}
        onChange={(v) => setFilter('minPremium', v as MinPremiumTier)}
      />
      <PillRow
        label="Type"
        options={TYPE_OPTIONS}
        active={filter.type}
        format={(v) => TYPE_LABELS[v as FlowTypeFilter]}
        onChange={(v) => setFilter('type', v as FlowTypeFilter)}
      />
      <PillRow
        label="Side"
        options={SENTIMENT_OPTIONS}
        active={filter.sentiment}
        format={(v) => (v as string).charAt(0).toUpperCase() + (v as string).slice(1)}
        onChange={(v) => setFilter('sentiment', v as typeof filter.sentiment)}
      />
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    backgroundColor:   DARK.surface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: DARK.separator,
    paddingVertical:   6,
    gap:               4,
  },
  row: {
    flexDirection: 'row',
    alignItems:    'center',
    paddingLeft:   10,
    gap:           8,
  },
  rowLabel: {
    color:    DARK.textMuted,
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 0.8,
    width:    34,
  },
  pills: {
    flexDirection: 'row',
    gap:           5,
    paddingRight:  10,
  },
  pill: {
    borderWidth:       1,
    borderColor:       DARK.border,
    borderRadius:      10,
    paddingHorizontal: 9,
    paddingVertical:   3,
  },
  pillActive: {
    backgroundColor: '#1d4ed8',
    borderColor:     '#1d4ed8',
  },
  pillText: {
    color:    DARK.textMuted,
    fontSize: 10,
    fontWeight: '500',
  },
  pillTextActive: {
    color:      '#FFFFFF',
    fontWeight: '700',
  },
});
