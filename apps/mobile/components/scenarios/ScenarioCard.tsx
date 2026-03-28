/**
 * ScenarioCard.tsx  (v2 — Elliott Wave Pro v1.1 enhancements)
 *
 * Displays one Elliott Wave count scenario with:
 *   Row 1: wave label (degree-formatted), prob bar, %, verdict, regime, confidence
 *   Row 1b (when near Fib): nearest Fib context line
 *   Row 2 (expanded): T1/T2/T3 with Fib annotations
 *   Row 3 (expanded): stop (Fib), R/R, CI, enhanced MTF badge
 *   Row 4 (expanded): alternation note, RSI divergence badge
 *
 * Enhancements applied:
 *   E1 – Fibonacci context in targets/stop labels + Fib context line
 *   E2 – Wave degree notation (Minute (v), Minor 5, etc.)
 *   E3 – Alternation note (W2 sharp → expect W4 flat, vice versa)
 *   E6 – RSI/momentum divergence badge (bearish ⚠ / bullish ✓)
 *   E7 – Confidence score: N/8 rules satisfied
 *   E8 – Enhanced MTF badge using mtf_alignment likelihood component
 */

import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import Animated, {
  useSharedValue,
  withSpring,
  useAnimatedStyle,
} from 'react-native-reanimated';
import type { WaveCount, FibLevel, WaveDegree, PatternCandidate, Recommendation, CountStage } from '@elliott-wave-pro/wave-engine';
import { DEGREE_COLORS, computeFibLevels } from '@elliott-wave-pro/wave-engine';
import { DARK } from '../../theme/colors';
import { RegimeBadge } from '../common/RegimeBadge';
import { useIndicatorStore } from '../../stores/indicators';

// ── Constants ─────────────────────────────────────────────────────────────────

const SECONDARY_OPACITY = 0.35;
const BAR_TRACK_W       = 80;
const SPRING_CONFIG     = { damping: 14, stiffness: 100 } as const;

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt$(n: number): string {
  return `$${n.toFixed(2)}`;
}

function fmtPct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

function ciHalf(ci: [number, number]): string {
  return `±${fmt$((ci[1] - ci[0]) / 2)}`;
}

// ── E2: Degree notation ───────────────────────────────────────────────────────

const DEGREE_FULL: Readonly<Record<WaveDegree, string>> = {
  grand_supercycle: 'Grand SC',
  supercycle:       'Supercycle',
  cycle:            'Cycle',
  primary:          'Primary',
  intermediate:     'Intermediate',
  minor:            'Minor',
  minute:           'Minute',
  minuette:         'Minuette',
};

/** Standard EW formatted wave label by degree. */
function formatDegreeLabel(degree: WaveDegree, label: string): string {
  const num = parseInt(label, 10);
  const romans = ['i', 'ii', 'iii', 'iv', 'v'];
  const roman  = !isNaN(num) && num >= 1 && num <= 5 ? romans[num - 1] : label.toLowerCase();
  switch (degree) {
    case 'grand_supercycle': return `[${label}]`;
    case 'supercycle':       return `(${label})`;
    case 'cycle':            return label;
    case 'primary':          return `[${label}]`;
    case 'intermediate':     return `(${label})`;
    case 'minor':            return label;
    case 'minute':           return `(${roman})`;
    case 'minuette':         return roman;
    default:                 return label;
  }
}

// ── E1: Fibonacci helpers ──────────────────────────────────────────────────────

/** Returns "Testing 0.618 retrace at $X" if near a Fib level (<2% away). */
function nearestFibContext(
  fibLevels: FibLevel[],
  currentPrice: number,
): string | null {
  if (!fibLevels.length || currentPrice <= 0) return null;
  let nearest = fibLevels[0];
  let minDist = Math.abs(fibLevels[0].price - currentPrice);
  for (const lv of fibLevels) {
    const d = Math.abs(lv.price - currentPrice);
    if (d < minDist) { minDist = d; nearest = lv; }
  }
  if (minDist / Math.abs(currentPrice) > 0.02) return null;
  const idx   = fibLevels.indexOf(nearest);
  const type  = idx < 5 ? 'retrace' : 'ext';
  return `Testing ${nearest.ratio.toFixed(3)} ${type} at ${fmt$(nearest.price)}`;
}

/** Annotates a price with the nearest Fib level if within 1%. */
function fibAnnotate(
  price: number,
  fibLevels: FibLevel[],
  maxPct = 0.015,
): string {
  if (!fibLevels.length || price <= 0) return fmt$(price);
  let nearest = fibLevels[0];
  let minDist = Math.abs(fibLevels[0].price - price);
  for (const lv of fibLevels) {
    const d = Math.abs(lv.price - price);
    if (d < minDist) { minDist = d; nearest = lv; }
  }
  if (minDist / Math.abs(price) > maxPct) return fmt$(price);
  const idx  = fibLevels.indexOf(nearest);
  const type = idx < 5 ? 'retrace' : 'ext';
  return `${fmt$(price)} = ${nearest.ratio.toFixed(3)} ${type}`;
}

// ── E3: Alternation ───────────────────────────────────────────────────────────

function getAlternationNote(count: WaveCount): string | null {
  const w1 = count.allWaves.find((w) => w.label === '1');
  const w2 = count.allWaves.find((w) => w.label === '2');
  if (!w1?.endPivot || !w2?.endPivot) return null;

  const w1Len    = Math.abs(w1.endPivot.price - w1.startPivot.price);
  const w2Retrace = Math.abs(w2.endPivot.price - w2.startPivot.price);
  if (w1Len < 1e-9) return null;

  const w2IsSharp = w2.structure === 'zigzag' || w2Retrace / w1Len > 0.618;
  return w2IsSharp
    ? 'W2 sharp zigzag → expect flat/triangle for W4'
    : 'W2 sideways flat → expect sharp zigzag for W4';
}

// ── E7: Confidence score ──────────────────────────────────────────────────────

interface ConfidenceResult {
  score: number;
  total: number;
  detail: string[];
}

function computeConfidenceScore(count: WaveCount): ConfidenceResult {
  const violations = count.violations;
  const comp       = count.posterior.likelihood_components;
  const w1 = count.allWaves.find((w) => w.label === '1');
  const w3 = count.allWaves.find((w) => w.label === '3');

  const detail: string[] = [];
  let score = 0;

  // 1. Wave 2 ≤ 100% retrace
  const r1 = !violations.some((v) => /retrace|wave 2/i.test(v));
  if (r1) { score++; detail.push('✓ W2 retrace ≤100%'); }
  else     { detail.push('✗ W2 over-retraces'); }

  // 2. Wave 3 not shortest
  const r2 = !violations.some((v) => /shortest/i.test(v));
  if (r2) { score++; detail.push('✓ W3 not shortest'); }
  else     { detail.push('✗ W3 is shortest'); }

  // 3. Wave 4 no W1 overlap
  const r3 = !violations.some((v) => /overlap/i.test(v));
  if (r3) { score++; detail.push('✓ W4 no W1 overlap'); }
  else     { detail.push('✗ W4 overlaps W1'); }

  // 4. Alternation (no violation)
  const r4 = !violations.some((v) => /altern/i.test(v));
  if (r4) { score++; detail.push('✓ W2/W4 alternate'); }
  else     { detail.push('✗ No alternation'); }

  // 5. Wave 3 extends beyond Wave 1 end
  let r5 = true;
  if (w1?.endPivot && w3?.endPivot) {
    const isBull = w1.startPivot.price < w1.endPivot.price;
    r5 = isBull
      ? w3.endPivot.price > w1.endPivot.price
      : w3.endPivot.price < w1.endPivot.price;
  }
  if (r5) { score++; detail.push('✓ W3 > W1 endpoint'); }
  else     { detail.push('✗ W3 < W1 endpoint'); }

  // 6. Volume confirms W3
  const r6 = comp.volume_profile > 0.5;
  if (r6) { score++; detail.push('✓ Volume at W3'); }
  else     { detail.push('○ Volume weak W3'); }

  // 7. RSI/MACD momentum alignment
  const r7 = comp.momentum_alignment > 0.45;
  if (r7) { score++; detail.push('✓ Momentum W3'); }
  else     { detail.push('○ Momentum weak'); }

  // 8. RSI divergence at W5
  const r8 = comp.rsi_divergence > 0.3 && count.currentWave.label === '5';
  if (r8) { score++; detail.push('✓ RSI div at W5'); }
  else     { detail.push('○ RSI div at W5'); }

  return { score, total: 8, detail };
}

// ── V3: recommendation badge ──────────────────────────────────────────────────

function v3RecommendationBadge(rec: Recommendation): { label: string; color: string } | null {
  switch (rec) {
    case 'high_confidence':      return { label: 'HIGH CONF', color: '#22c55e' };
    case 'tradable_but_caution': return { label: 'CAUTION',   color: '#f59e0b' };
    case 'low_confidence':       return { label: 'LOW CONF',  color: '#f97316' };
    case 'ambiguous':            return { label: 'AMBIGUOUS', color: '#6b7280' };
    default:                     return null;
  }
}

function v3StageLabel(stage: CountStage): string {
  const map: Record<CountStage, string> = {
    complete:    'Complete',
    forming_w3:  'Forming W3',
    forming_w4:  'Forming W4',
    forming_w5:  'Forming W5',
    forming_b:   'Forming B',
    forming_c:   'Forming C',
  };
  return map[stage] ?? stage;
}

// ── Verdict + verdict color ───────────────────────────────────────────────────

interface VerdictSpec { label: string; color: string }

function getVerdict(count: WaveCount): VerdictSpec {
  const w1structure = count.allWaves[0]?.structure;
  if (w1structure === 'ending_diagonal')  return { label: 'END DIAG',  color: DARK.neutral };
  if (w1structure === 'leading_diagonal') return { label: 'LEAD DIAG', color: DARK.neutral };
  const isBull = (() => {
    const w1 = count.allWaves.find((w) => w.label === '1');
    if (!w1?.endPivot) return true;
    return w1.startPivot.price < w1.endPivot.price;
  })();
  return isBull ? { label: 'BULL ▲', color: DARK.bullish } : { label: 'BEAR ▼', color: DARK.bearish };
}

// ── Probability bar ───────────────────────────────────────────────────────────

function ProbabilityBar({ probability, color }: { probability: number; color: string }) {
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

// WaveCount extended with optional v3 raw candidate (set by useWaveEngine v3)
type WaveCountWithV3 = WaveCount & { _v3?: PatternCandidate };

interface ScenarioCardProps {
  count:        WaveCountWithV3;
  rank:         number;
  isExpanded:   boolean;
  currentPrice: number;
  onPress:      () => void;
}

export function ScenarioCard({
  count,
  rank,
  isExpanded,
  currentPrice,
  onPress,
}: ScenarioCardProps) {
  const [showConfDetail, setShowConfDetail] = useState(false);

  // ── V3 badge data ────────────────────────────────────────────────────────────
  const v3 = count._v3;
  const v3RecBadge  = useMemo(() => v3 ? v3RecommendationBadge(v3.recommendation) : null, [v3]);
  const v3StageText = useMemo(() => v3 ? v3StageLabel(v3.stage) : null, [v3]);
  const v3TopNotes  = useMemo(() => v3 ? v3.score.notes.slice(0, 2) : [], [v3]);

  const probability  = count.posterior.posterior;
  const verdict      = getVerdict(count);
  const opacity      = rank === 0 ? 1.0 : SECONDARY_OPACITY;
  const degreeColor  = DEGREE_COLORS[count.degree] ?? '#8b949e';
  const degreeFull   = DEGREE_FULL[count.degree] ?? count.degree;
  const formattedLbl = formatDegreeLabel(count.degree, count.currentWave.label);
  const waveName     = `Wave ${formattedLbl}`;
  const ticker       = count.ticker;

  // ── E1: Fib levels ──────────────────────────────────────────────────────────
  const fibLevels = useMemo(
    () => (currentPrice > 0 ? computeFibLevels(count, currentPrice) : []),
    [count, currentPrice],
  );
  const fibContext = useMemo(
    () => nearestFibContext(fibLevels, currentPrice),
    [fibLevels, currentPrice],
  );

  const [t1, t2, t3] = count.targets;
  const t1Label = useMemo(() => fibAnnotate(t1, fibLevels), [t1, fibLevels]);
  const t2Label = useMemo(() => fibAnnotate(t2, fibLevels), [t2, fibLevels]);
  const t3Label = useMemo(() => fibAnnotate(t3, fibLevels), [t3, fibLevels]);
  const stopLabel = useMemo(
    () => fibAnnotate(count.stopPrice, fibLevels),
    [count.stopPrice, fibLevels],
  );

  // ── E3: Alternation ─────────────────────────────────────────────────────────
  const alternationNote = useMemo(() => getAlternationNote(count), [count]);

  // ── E7: Confidence ──────────────────────────────────────────────────────────
  const confidence = useMemo(() => computeConfidenceScore(count), [count]);

  // ── E6: RSI divergence ──────────────────────────────────────────────────────
  const rsiSeries   = useIndicatorStore((s) => s.rsi[`${ticker}_${count.timeframe}`]);
  const rsiDivBadge = useMemo((): { label: string; color: string } | null => {
    const divs = rsiSeries?.divergences ?? [];
    const n    = rsiSeries?.values.length ?? 0;
    const recent = divs.filter((d) => d.barIdx >= n - 15);
    const bearish = recent.some((d) => d.type === 'bearish');
    const bullish = recent.some((d) => d.type === 'bullish');

    const wl = count.currentWave.label;
    if (bearish && ['5', 'B'].includes(wl)) {
      return { label: '⚠ RSI Div', color: DARK.bearish };
    }
    if (bullish && ['2', '4', 'A', 'C'].includes(wl)) {
      return { label: '✓ RSI Div', color: DARK.bullish };
    }
    return null;
  }, [rsiSeries, count.currentWave.label, count.timeframe]);

  // ── E8: Enhanced MTF ────────────────────────────────────────────────────────
  const mtfScore = count.posterior.likelihood_components.mtf_alignment;
  const mtfLabel = mtfScore >= 0.7 ? '✓ MTF HIGH'
    : mtfScore <= 0.3 ? '✗ MTF CONFLICT'
    : '~ MTF NEUTRAL';
  const mtfColor = mtfScore >= 0.7 ? DARK.bullish
    : mtfScore <= 0.3 ? DARK.bearish
    : DARK.textMuted;

  const ci = count.posterior.confidence_interval;

  return (
    <Pressable onPress={onPress} style={[styles.card, rank === 0 && styles.cardPrimary, { opacity }]}>

      {/* ── Row 1: header ── */}
      <View style={styles.row}>
        <View style={styles.waveNameWrap}>
          <Text style={styles.waveName} numberOfLines={1}>{waveName}</Text>
          <Text style={[styles.degreeTag, { color: degreeColor }]}>{degreeFull}</Text>
        </View>

        <ProbabilityBar probability={probability} color={verdict.color} />

        <Text style={[styles.pct, { color: verdict.color }]}>{fmtPct(probability)}</Text>

        <View style={[styles.badge, { borderColor: verdict.color }]}>
          <Text style={[styles.badgeText, { color: verdict.color }]}>{verdict.label}</Text>
        </View>

        <RegimeBadge ticker={ticker} size="sm" />

        {/* E7: confidence pill */}
        <Pressable
          onPress={(e) => { e.stopPropagation(); setShowConfDetail((v) => !v); }}
          hitSlop={6}
        >
          <View style={[styles.confPill, { borderColor: confidence.score >= 6 ? DARK.bullish : DARK.textMuted }]}>
            <Text style={[styles.confText, { color: confidence.score >= 6 ? DARK.bullish : DARK.textMuted }]}>
              {confidence.score}/{confidence.total}✓
            </Text>
          </View>
        </Pressable>
      </View>

      {/* E7: confidence detail (expandable) */}
      {showConfDetail && (
        <View style={styles.confDetail}>
          {confidence.detail.map((line, i) => (
            <Text key={i} style={styles.confDetailLine}>{line}</Text>
          ))}
        </View>
      )}

      {/* ── V3: recommendation badge + stage label ── */}
      {v3 !== undefined && (v3RecBadge !== null || v3StageText !== null) && (
        <View style={[styles.row, { flexWrap: 'wrap', gap: 4 }]}>
          {v3RecBadge !== null && (
            <View style={[styles.v3RecBadge, { borderColor: v3RecBadge.color }]}>
              <Text style={[styles.v3RecBadgeText, { color: v3RecBadge.color }]}>{v3RecBadge.label}</Text>
            </View>
          )}
          {v3StageText !== null && (
            <Text style={styles.v3StageText}>{v3StageText}</Text>
          )}
        </View>
      )}

      {/* ── V3: top score notes ── */}
      {v3 !== undefined && v3TopNotes.length > 0 && isExpanded && (
        <View style={styles.v3Notes}>
          {v3TopNotes.map((note, i) => (
            <Text key={i} style={styles.v3NoteText} numberOfLines={1}>{note}</Text>
          ))}
        </View>
      )}

      {/* ── E1: Fib context line (always when near a level) ── */}
      {fibContext !== null && (
        <Text style={styles.fibContext}>{fibContext}</Text>
      )}

      {/* ── Row 2: targets with Fib annotations (expanded only) ── */}
      {isExpanded && (
        <View style={styles.row}>
          <View style={styles.targetCell}>
            <Text style={styles.targetLabel}>T1</Text>
            <Text style={styles.targetPrice} numberOfLines={2}>{t1Label}</Text>
          </View>
          <View style={styles.targetCell}>
            <Text style={styles.targetLabel}>T2</Text>
            <Text style={styles.targetPrice} numberOfLines={2}>{t2Label}</Text>
          </View>
          <View style={styles.targetCell}>
            <Text style={styles.targetLabel}>T3</Text>
            <Text style={styles.targetPrice} numberOfLines={2}>{t3Label}</Text>
          </View>
        </View>
      )}

      {/* ── Row 3: stop/meta (expanded only) ── */}
      {isExpanded && (
        <View style={styles.row}>
          <Text style={styles.meta} numberOfLines={2}>Stop {stopLabel}</Text>
          <Text style={styles.metaSep}>·</Text>
          <Text style={styles.meta}>R/R {count.rrRatio.toFixed(1)}x</Text>
          <Text style={styles.metaSep}>·</Text>
          <Text style={styles.meta}>CI {ciHalf(ci)}</Text>
          <Text style={styles.metaSep}>·</Text>
          <Text style={[styles.meta, { color: mtfColor }]}>{mtfLabel}</Text>
        </View>
      )}

      {/* ── Row 4: alternation + RSI div badge (expanded only) ── */}
      {isExpanded && (alternationNote !== null || rsiDivBadge !== null) && (
        <View style={[styles.row, { flexWrap: 'wrap', gap: 6 }]}>
          {alternationNote !== null && (
            <Text style={styles.alternation}>{alternationNote}</Text>
          )}
          {rsiDivBadge !== null && (
            <View style={[styles.divBadge, { borderColor: rsiDivBadge.color }]}>
              <Text style={[styles.divBadgeText, { color: rsiDivBadge.color }]}>
                {rsiDivBadge.label}
              </Text>
            </View>
          )}
        </View>
      )}
    </Pressable>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  card: {
    backgroundColor:   DARK.surface,
    borderWidth:       1,
    borderColor:       DARK.border,
    borderRadius:      6,
    paddingHorizontal: 10,
    paddingVertical:   6,
    marginBottom:      4,
    gap:               4,
  },
  cardPrimary: {
    borderColor: '#1d4ed8',
  },
  row: {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           6,
  },

  // Wave name + degree
  waveNameWrap: {
    flexDirection: 'column',
    minWidth:      62,
  },
  waveName: {
    color:      DARK.textPrimary,
    fontSize:   12,
    fontWeight: '700',
  },
  degreeTag: {
    fontSize:  9,
    fontWeight: '500',
  },

  // Probability bar
  barTrack: {
    height:          5,
    backgroundColor: '#1e293b',
    borderRadius:    3,
    overflow:        'hidden',
  },
  barFill: {
    height:       5,
    borderRadius: 3,
  },

  // Probability percent
  pct: {
    fontSize:  12,
    fontWeight: '700',
    minWidth:   28,
    textAlign:  'right',
  },

  // Verdict badge
  badge: {
    borderWidth:       1,
    borderRadius:      4,
    paddingHorizontal: 4,
    paddingVertical:   1,
  },
  badgeText: {
    fontSize:     9,
    fontWeight:   '700',
    letterSpacing: 0.3,
  },

  // Confidence pill (E7)
  confPill: {
    borderWidth:       1,
    borderRadius:      4,
    paddingHorizontal: 4,
    paddingVertical:   1,
  },
  confText: {
    fontSize:  9,
    fontWeight: '700',
  },
  confDetail: {
    backgroundColor: DARK.surfaceRaised,
    borderRadius:    4,
    padding:         6,
    gap:             2,
  },
  confDetailLine: {
    color:    DARK.textSecondary,
    fontSize: 9,
  },

  // Fib context line (E1)
  fibContext: {
    color:    '#fb923c',  // amber
    fontSize: 9,
    fontStyle: 'italic',
  },

  // Target cells (Row 2)
  targetCell: {
    flex:      1,
    gap:       2,
  },
  targetLabel: {
    color:    DARK.textMuted,
    fontSize: 9,
    fontWeight: '700',
  },
  targetPrice: {
    color:    DARK.textPrimary,
    fontSize: 9,
    fontWeight: '500',
  },

  // Meta row (Row 3)
  meta: {
    color:    DARK.textSecondary,
    fontSize: 9,
  },
  metaSep: {
    color:    DARK.separator,
    fontSize: 9,
  },

  // Alternation note (E3)
  alternation: {
    color:    DARK.textMuted,
    fontSize: 9,
    flex:     1,
    fontStyle: 'italic',
  },

  // V3 recommendation badge
  v3RecBadge: {
    borderWidth:       1,
    borderRadius:      4,
    paddingHorizontal: 4,
    paddingVertical:   1,
  },
  v3RecBadgeText: {
    fontSize:     8,
    fontWeight:   '700',
    letterSpacing: 0.3,
  },
  v3StageText: {
    color:    DARK.textMuted,
    fontSize: 9,
    fontStyle: 'italic',
  },
  v3Notes: {
    gap: 1,
    paddingTop: 1,
  },
  v3NoteText: {
    color:    DARK.textMuted,
    fontSize: 8,
  },

  // RSI divergence badge (E6)
  divBadge: {
    borderWidth:       1,
    borderRadius:      4,
    paddingHorizontal: 5,
    paddingVertical:   1,
  },
  divBadgeText: {
    fontSize:  9,
    fontWeight: '700',
  },
});
