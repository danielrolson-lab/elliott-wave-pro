/**
 * ScenarioCard.tsx
 *
 * Displays one Elliott Wave count scenario with:
 *   Row 1 (all ranks): wave label, animated probability bar, pct, verdict badge
 *   Row 2 (rank < 2):  T1 / T2 / T3 price targets
 *   Row 3 (rank < 2):  stop price, R/R ratio, confidence interval, MTF status
 *
 * Rank 0 (primary)     — full opacity (1.0), expanded
 * Rank 1 (secondary)   — 35% opacity,       expanded
 * Rank 2–3 (collapsed) — 35% opacity,       header row only
 *
 * The probability bar width animates with a Reanimated spring each time the
 * posterior probability changes.
 */

import React, { useEffect } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import Animated, {
  useSharedValue,
  withSpring,
  useAnimatedStyle,
} from 'react-native-reanimated';
import type { WaveCount } from '@elliott-wave-pro/wave-engine';
import { DEGREE_COLORS } from '@elliott-wave-pro/wave-engine';
import { DARK } from '../../theme/colors';
import { RegimeBadge } from '../common/RegimeBadge';

// ── Constants ─────────────────────────────────────────────────────────────────

const SECONDARY_OPACITY = 0.35;
const BAR_TRACK_W       = 88;   // px — fixed track width for probability bar
const SPRING_CONFIG     = { damping: 14, stiffness: 100 } as const;

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt$(n: number): string {
  return `$${n.toFixed(2)}`;
}

function fmtPct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

/** Returns the half-width of the 80% confidence interval. */
function ciHalf(ci: [number, number]): string {
  return `±${fmt$((ci[1] - ci[0]) / 2)}`;
}

/** Short human-readable degree label. */
const DEGREE_ABBREV: Record<string, string> = {
  grand_supercycle: 'GS',
  supercycle:       'SC',
  cycle:            'Cyc',
  primary:          'Pri',
  intermediate:     'Int',
  minor:            'Min',
  minute:           'Mnt',
  minuette:         'Mne',
};

/** Whether the impulse direction is bullish (W1 goes up). */
function isBullishCount(count: WaveCount): boolean {
  const w1 = count.allWaves.find((w) => w.label === '1');
  if (!w1 || !w1.endPivot) return false;
  return w1.startPivot.price < w1.endPivot.price;
}

interface VerdictSpec {
  label: string;
  color: string;
}

function getVerdict(count: WaveCount): VerdictSpec {
  const w1structure = count.allWaves[0]?.structure;
  if (w1structure === 'ending_diagonal')  return { label: 'END DIAG', color: DARK.neutral };
  if (w1structure === 'leading_diagonal') return { label: 'LEAD DIAG', color: DARK.neutral };
  return isBullishCount(count)
    ? { label: 'BULL ▲', color: DARK.bullish }
    : { label: 'BEAR ▼', color: DARK.bearish };
}

// ── Animated probability bar ──────────────────────────────────────────────────

interface BarProps {
  probability: number;
  color: string;
}

function ProbabilityBar({ probability, color }: BarProps) {
  const fillW = useSharedValue(0);

  useEffect(() => {
    fillW.value = withSpring(probability * BAR_TRACK_W, SPRING_CONFIG);
  }, [probability, fillW]);

  const animStyle = useAnimatedStyle(() => ({ width: fillW.value }));

  return (
    <View style={[styles.barTrack, { width: BAR_TRACK_W }]}>
      <Animated.View style={[styles.barFill, { backgroundColor: color }, animStyle]} />
    </View>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

interface ScenarioCardProps {
  count:      WaveCount;
  /** 0=primary, 1=secondary, 2–3=collapsed */
  rank:       number;
  isExpanded: boolean;
  onPress:    () => void;
}

export function ScenarioCard({ count, rank, isExpanded, onPress }: ScenarioCardProps) {
  const ticker = count.allWaves[0]?.startPivot ? (count as unknown as { ticker?: string }).ticker ?? 'SPY' : 'SPY';
  const probability = count.posterior.posterior;
  const verdict     = getVerdict(count);
  const opacity     = rank === 0 ? 1.0 : SECONDARY_OPACITY;

  const degreeAbbrev  = DEGREE_ABBREV[count.degree] ?? count.degree;
  const degreeColor   = DEGREE_COLORS[count.degree] ?? '#8b949e';
  const waveName      = `Wave ${count.currentWave.label}`;

  const [t1, t2, t3] = count.targets;
  const ci            = count.posterior.confidence_interval;
  const mtfConflict   = count.posterior.mtf_conflict;
  const mtfColor      = mtfConflict ? DARK.bearish : DARK.bullish;
  const mtfLabel      = mtfConflict ? '✗ MTF' : '✓ MTF';

  return (
    <Pressable onPress={onPress} style={[styles.card, rank === 0 && styles.cardPrimary, { opacity }]}>
      {/* ── Row 1: header ── */}
      <View style={styles.row}>
        <View style={styles.waveNameWrap}>
          <Text style={styles.waveName} numberOfLines={1}>
            {waveName}
          </Text>
          <Text style={[styles.degreeTag, { color: degreeColor }]}>
            {degreeAbbrev}
          </Text>
        </View>

        <ProbabilityBar probability={probability} color={verdict.color} />

        <Text style={[styles.pct, { color: verdict.color }]}>
          {fmtPct(probability)}
        </Text>

        <View style={[styles.badge, { borderColor: verdict.color }]}>
          <Text style={[styles.badgeText, { color: verdict.color }]}>
            {verdict.label}
          </Text>
        </View>
        <RegimeBadge ticker={ticker} size="sm" />
      </View>

      {/* ── Row 2: targets (expanded only) ── */}
      {isExpanded && (
        <View style={styles.row}>
          <View style={styles.targetCell}>
            <Text style={styles.targetLabel}>T1</Text>
            <Text style={styles.targetPrice}>{fmt$(t1)}</Text>
          </View>
          <View style={styles.targetCell}>
            <Text style={styles.targetLabel}>T2</Text>
            <Text style={styles.targetPrice}>{fmt$(t2)}</Text>
          </View>
          <View style={styles.targetCell}>
            <Text style={styles.targetLabel}>T3</Text>
            <Text style={styles.targetPrice}>{fmt$(t3)}</Text>
          </View>
        </View>
      )}

      {/* ── Row 3: meta (expanded only) ── */}
      {isExpanded && (
        <View style={styles.row}>
          <Text style={styles.meta}>
            Stop {fmt$(count.stopPrice)}
          </Text>
          <Text style={styles.metaSep}>·</Text>
          <Text style={styles.meta}>
            R/R {count.rrRatio.toFixed(1)}x
          </Text>
          <Text style={styles.metaSep}>·</Text>
          <Text style={styles.meta}>
            CI {ciHalf(ci)}
          </Text>
          <Text style={styles.metaSep}>·</Text>
          <Text style={[styles.meta, { color: mtfColor }]}>
            {mtfLabel}
          </Text>
        </View>
      )}
    </Pressable>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  card: {
    backgroundColor: DARK.surface,
    borderWidth:     1,
    borderColor:     DARK.border,
    borderRadius:    6,
    paddingHorizontal: 10,
    paddingVertical:   6,
    marginBottom:    4,
    gap:             4,
  },
  cardPrimary: {
    borderColor: '#1d4ed8', // brighter blue border for primary count
  },

  // Row
  row: {
    flexDirection:  'row',
    alignItems:     'center',
    gap:            8,
  },

  // Wave name + degree
  waveNameWrap: {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           4,
    minWidth:      76,
  },
  waveName: {
    color:     DARK.textPrimary,
    fontSize:  12,
    fontWeight: '600',
  },
  degreeTag: {
    fontSize:  10,
    fontWeight: '500',
  },

  // Probability bar
  barTrack: {
    height:          6,
    backgroundColor: '#1e293b',
    borderRadius:    3,
    overflow:        'hidden',
  },
  barFill: {
    height:       6,
    borderRadius: 3,
  },

  // Probability percent
  pct: {
    fontSize:  12,
    fontWeight: '700',
    minWidth:  32,
    textAlign: 'right',
  },

  // Verdict badge
  badge: {
    borderWidth:   1,
    borderRadius:  4,
    paddingHorizontal: 5,
    paddingVertical:   1,
  },
  badgeText: {
    fontSize:  9,
    fontWeight: '700',
    letterSpacing: 0.3,
  },

  // Target cells (Row 2)
  targetCell: {
    flex:          1,
    flexDirection: 'row',
    alignItems:    'center',
    gap:           3,
  },
  targetLabel: {
    color:    DARK.textMuted,
    fontSize: 10,
    fontWeight: '600',
  },
  targetPrice: {
    color:    DARK.textPrimary,
    fontSize: 11,
    fontWeight: '500',
  },

  // Meta row (Row 3)
  meta: {
    color:    DARK.textSecondary,
    fontSize: 10,
  },
  metaSep: {
    color:    DARK.separator,
    fontSize: 10,
  },
});
