/**
 * WaveConfluenceModal.tsx
 *
 * Bottom sheet modal showing multi-timeframe Elliott Wave confluence analysis.
 * Opens from the "Wave Confluence" button in the chart screen.
 */

import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Dimensions,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  ActivityIndicator,
} from 'react-native';
import type { TFResult, ConfluenceScore } from '../../hooks/useWaveConfluence';

// ── Constants ─────────────────────────────────────────────────────────────────

const { height: SCREEN_H } = Dimensions.get('window');
const SHEET_H = Math.round(SCREEN_H * 0.75);

const TF_COLORS: Record<string, string> = {
  '5m':  '#6366F1',  // indigo
  '15m': '#8B5CF6',  // purple
  '30m': '#EC4899',  // pink
  '1h':  '#F59E0B',  // amber
  '1D':  '#10B981',  // green
};

const LABEL_COLORS: Record<string, string> = {
  'Strong Confluence':   '#22C55E',
  'Moderate Confluence': '#EAB308',
  'Mixed Signals':       '#F97316',
  'No Confluence':       '#EF4444',
};

const API_BASE = process.env.EXPO_PUBLIC_API_BASE_URL ?? 'https://elliott-wave-pro-proxy.vercel.app';

// ── AI Insight ─────────────────────────────────────────────────────────────────

async function fetchConfluenceAI(
  ticker: string,
  results: TFResult[],
  confluenceLabel: string,
): Promise<string> {
  const ready = results.filter((r) => r.status === 'ready');
  const summary = ready
    .map((r) => `${r.timeframe}: Wave ${r.waveLabel} ${r.direction} ${r.confidence}%`)
    .join(', ');

  // Identify HTF and LTF for degree context
  const TF_RANK: Record<string, number> = { '1D': 5, '1h': 4, '30m': 3, '15m': 2, '5m': 1 };
  const sorted = [...ready].sort((a, b) => (TF_RANK[b.timeframe] ?? 0) - (TF_RANK[a.timeframe] ?? 0));
  const htfResult = sorted[0];
  const ltfResult = sorted[sorted.length - 1];
  const htfContext = htfResult
    ? `The largest timeframe (${htfResult.timeframe}) shows Wave ${htfResult.waveLabel} ${htfResult.direction}.`
    : '';
  const ltfContext = ltfResult && ltfResult.timeframe !== htfResult?.timeframe
    ? `The shortest timeframe (${ltfResult.timeframe}) shows Wave ${ltfResult.waveLabel} ${ltfResult.direction}.`
    : '';

  const avgConfidence = ready.length > 0
    ? ready.reduce((s, r) => s + r.confidence, 0) / ready.length / 100
    : 0;

  const resp = await fetch(`${API_BASE}/api/ai-commentary`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ticker,
      waveLabel:   `MTF: ${summary}`,
      structure:   'multi-timeframe',
      probability: avgConfidence,
      regime:      confluenceLabel,
      waveType:    `Multi-timeframe interpretation for a swing trader. ${htfContext} ${ltfContext} Overall: ${confluenceLabel}. All TFs: ${summary}. Answer in exactly 2 sentences: (1) what does the current short-term wave fit into at the larger degree — name the HTF wave and what structure it belongs to, (2) what this degree alignment means for the nearest actionable trade direction and price target. Be direct, name specific prices where known.`,
    }),
  });

  if (!resp.ok) throw new Error('AI commentary unavailable');
  const data = await resp.json() as { commentary?: string };
  return data.commentary ?? '';
}

// ── AI cache ──────────────────────────────────────────────────────────────────

const AI_TTL = 5 * 60 * 1000;
const aiCache: Map<string, { text: string; ts: number }> = new Map();

// ── Sub-components ─────────────────────────────────────────────────────────────

function ConfluenceBadge({ label }: { label: string }) {
  const color = LABEL_COLORS[label] ?? '#888';
  const isStrong = label === 'Strong Confluence';
  return (
    <View style={[styles.badge, { borderColor: color, backgroundColor: `${color}22` }]}>
      {isStrong && <Text style={[styles.badgeDot, { color }]}>●  </Text>}
      <Text style={[styles.badgeText, { color }]}>{label.toUpperCase()}</Text>
    </View>
  );
}

function SummaryCard({
  ticker,
  score,
}: {
  ticker: string;
  score: ConfluenceScore;
}) {
  return (
    <View style={styles.summaryCard}>
      <View style={styles.summaryHeader}>
        <Text style={styles.summaryTitle}>◈ WAVE CONFLUENCE</Text>
        <ConfluenceBadge label={score.label} />
      </View>
      <Text style={styles.summarySubtitle}>
        {ticker} · {score.directionCount} of 5 timeframes{' '}
        <Text style={{ color: score.majorityDir === 'BULL' ? '#22C55E' : '#EF4444' }}>
          {score.majorityDir}ISH
        </Text>
      </Text>
      <Text style={styles.summaryDetail}>
        Dominant pattern: {score.dominantPattern} · Avg confidence: {score.avgConfidence}%
      </Text>
      {score.bestSetup && (
        <Text style={styles.summaryBest}>
          Best setup: {score.bestSetup.timeframe} · Wave {score.bestSetup.waveLabel} · {score.bestSetup.confidence}%
          {score.bestSetup.t1 > 0 ? ` · T1 $${score.bestSetup.t1.toFixed(2)}` : ''}
        </Text>
      )}
    </View>
  );
}

function TFRow({
  result,
  majorityDir,
  onPress,
}: {
  result: TFResult;
  majorityDir: 'BULL' | 'BEAR';
  onPress: () => void;
}) {
  const tfColor  = TF_COLORS[result.timeframe] ?? '#888';
  const isMaj    = result.direction === majorityDir;
  const dirColor = result.direction === 'BULL' ? '#22C55E' : '#EF4444';
  const dirArrow = result.direction === 'BULL' ? '▲' : '▼';

  if (result.status === 'loading') {
    return (
      <View style={[styles.tfRow, { opacity: 0.5 }]}>
        <View style={[styles.tfPill, { backgroundColor: `${tfColor}33`, borderColor: tfColor }]}>
          <Text style={[styles.tfPillText, { color: tfColor }]}>{result.timeframe}</Text>
        </View>
        <ActivityIndicator size="small" color="#555" style={{ marginLeft: 12 }} />
        <Text style={styles.tfLoading}>Loading…</Text>
      </View>
    );
  }

  if (result.status === 'error') {
    return (
      <View style={[styles.tfRow, { opacity: 0.4 }]}>
        <View style={[styles.tfPill, { backgroundColor: `${tfColor}33`, borderColor: tfColor }]}>
          <Text style={[styles.tfPillText, { color: tfColor }]}>{result.timeframe}</Text>
        </View>
        <Text style={styles.tfUnavailable}>Unavailable</Text>
      </View>
    );
  }

  return (
    <Pressable
      style={[styles.tfRow, !isMaj && styles.tfRowDim]}
      onPress={onPress}
      hitSlop={4}
    >
      {/* Left: TF pill */}
      <View style={[styles.tfPill, { backgroundColor: `${tfColor}33`, borderColor: tfColor }]}>
        <Text style={[styles.tfPillText, { color: tfColor }]}>{result.timeframe}</Text>
      </View>

      {/* Center: wave info */}
      <View style={styles.tfCenter}>
        <View style={styles.tfRow1}>
          <Text style={[styles.tfWaveLabel, !isMaj && styles.tfWaveLabelDim]}>
            Wave {result.waveLabel}
          </Text>
          <View style={[styles.confBar, { width: `${result.confidence}%`, backgroundColor: dirColor }]} />
          <Text style={[styles.tfDir, { color: dirColor }]}>
            {dirArrow} {result.direction}
          </Text>
          {result.t1 > 0 && (
            <Text style={styles.tfTarget}>T1 ${result.t1.toFixed(2)}</Text>
          )}
        </View>
        <View style={styles.tfRow2}>
          <Text style={styles.tfMeta}>
            {result.waveType} · {result.isForming ? 'Forming' : 'Complete'}
          </Text>
          {result.stopPrice > 0 && (
            <Text style={styles.tfMeta}>  Stop ${result.stopPrice.toFixed(2)}  R/R {result.rrRatio}x</Text>
          )}
        </View>
      </View>
    </Pressable>
  );
}

// ── Main modal ────────────────────────────────────────────────────────────────

export interface WaveConfluenceModalProps {
  visible:     boolean;
  onClose:     () => void;
  ticker:      string;
  results:     TFResult[];
  score:       ConfluenceScore | null;
  onSelectTF?: (tf: string) => void;
}

export function WaveConfluenceModal({
  visible,
  onClose,
  ticker,
  results,
  score,
  onSelectTF,
}: WaveConfluenceModalProps) {
  const slideY  = useRef(new Animated.Value(SHEET_H)).current;
  const [aiText,    setAiText]    = useState<string>('');
  const [aiLoading, setAiLoading] = useState(false);

  // Slide in / out
  useEffect(() => {
    Animated.spring(slideY, {
      toValue:  visible ? 0 : SHEET_H,
      useNativeDriver: true,
      damping:  25,
      stiffness: 200,
    }).start();
  }, [visible, slideY]);

  // Load AI insight when modal opens and results are available
  useEffect(() => {
    if (!visible || !score || results.every((r) => r.status === 'loading')) return;

    const key = `ai_${ticker}_${Date.now() - (Date.now() % (AI_TTL))}`;
    const cached = aiCache.get(key);
    if (cached) { setAiText(cached.text); return; }

    setAiLoading(true);
    setAiText('');
    fetchConfluenceAI(ticker, results, score.label)
      .then((text) => {
        setAiText(text);
        aiCache.set(key, { text, ts: Date.now() });
      })
      .catch(() => setAiText('AI insight unavailable.'))
      .finally(() => setAiLoading(false));
  }, [visible, ticker, score, results]);

  const readyResults = [...results].filter((r) => r.status === 'ready');
  const sortedResults = [
    ...readyResults.sort((a, b) => b.confidence - a.confidence),
    ...results.filter((r) => r.status !== 'ready'),
  ];

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      onRequestClose={onClose}
    >
      {/* Backdrop */}
      <Pressable style={styles.backdrop} onPress={onClose} />

      {/* Sheet */}
      <Animated.View
        style={[styles.sheet, { transform: [{ translateY: slideY }] }]}
      >
        {/* Handle */}
        <View style={styles.handle} />

        {/* Header */}
        <View style={styles.headerRow}>
          <View>
            <Text style={styles.title}>Wave Confluence</Text>
            <Text style={styles.subtitle}>{ticker} · Multi-Timeframe Analysis</Text>
          </View>
          <Pressable onPress={onClose} hitSlop={12} style={styles.closeBtn}>
            <Text style={styles.closeBtnText}>✕</Text>
          </Pressable>
        </View>

        <ScrollView showsVerticalScrollIndicator={false} style={styles.scroll}>
          {/* Summary card */}
          {score ? (
            <SummaryCard ticker={ticker} score={score} />
          ) : (
            <View style={styles.summaryCard}>
              <Text style={styles.summaryTitle}>◈ WAVE CONFLUENCE</Text>
              <ActivityIndicator color="#FFD700" style={{ marginTop: 8 }} />
            </View>
          )}

          {/* AI Interpretation — top of modal, answers "what does this fit into" */}
          <Text style={styles.sectionLabel}>INTERPRETATION</Text>
          <View style={styles.aiCard}>
            {aiLoading ? (
              <View style={styles.aiLoading}>
                <ActivityIndicator size="small" color="#FFD700" />
                <Text style={styles.aiLoadingText}>Analyzing degree structure…</Text>
              </View>
            ) : (
              <Text style={styles.aiText}>{aiText || 'Loading interpretation…'}</Text>
            )}
          </View>

          {/* TF rows */}
          <Text style={styles.sectionLabel}>PER-TIMEFRAME BREAKDOWN</Text>
          {sortedResults.map((r) => (
            <TFRow
              key={r.timeframe}
              result={r}
              majorityDir={score?.majorityDir ?? 'BULL'}
              onPress={() => {
                onSelectTF?.(r.timeframe);
                onClose();
              }}
            />
          ))}

          {/* Tap-a-row hint */}
          <Text style={styles.hint}>Tap a row to switch to that timeframe</Text>
          <View style={{ height: 24 }} />
        </ScrollView>
      </Animated.View>
    </Modal>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  backdrop: {
    flex:            1,
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  sheet: {
    position:        'absolute',
    bottom:          0,
    left:            0,
    right:           0,
    height:          SHEET_H,
    backgroundColor: '#0d0d1a',
    borderTopLeftRadius:  16,
    borderTopRightRadius: 16,
    overflow:        'hidden',
  },
  handle: {
    width:           40,
    height:          4,
    borderRadius:    2,
    backgroundColor: '#333',
    alignSelf:       'center',
    marginTop:       8,
  },
  headerRow: {
    flexDirection:     'row',
    justifyContent:    'space-between',
    alignItems:        'flex-start',
    paddingHorizontal: 16,
    paddingTop:        12,
    paddingBottom:     8,
  },
  title: {
    color:      '#FFD700',
    fontSize:   18,
    fontWeight: '700',
  },
  subtitle: {
    color:    '#888',
    fontSize: 12,
    marginTop: 2,
  },
  closeBtn: {
    padding: 4,
  },
  closeBtnText: {
    color:    '#666',
    fontSize: 18,
  },
  scroll: {
    flex: 1,
    paddingHorizontal: 12,
  },

  // Summary card
  summaryCard: {
    backgroundColor: '#111826',
    borderRadius:    10,
    padding:         14,
    marginBottom:    12,
    borderWidth:     1,
    borderColor:     '#1e2a3a',
  },
  summaryHeader: {
    flexDirection:  'row',
    justifyContent: 'space-between',
    alignItems:     'center',
    marginBottom:   6,
  },
  summaryTitle: {
    color:      '#FFD700',
    fontSize:   12,
    fontWeight: '700',
    letterSpacing: 0.8,
  },
  badge: {
    flexDirection:     'row',
    alignItems:        'center',
    borderRadius:      12,
    borderWidth:       1,
    paddingHorizontal: 8,
    paddingVertical:   3,
  },
  badgeDot: { fontSize: 8 },
  badgeText: { fontSize: 9, fontWeight: '700', letterSpacing: 0.5 },
  summarySubtitle: {
    color:    '#C9D1D9',
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 4,
  },
  summaryDetail: {
    color:    '#6E7681',
    fontSize: 11,
    marginBottom: 3,
  },
  summaryBest: {
    color:    '#8B949E',
    fontSize: 11,
    marginTop: 2,
  },

  // Section labels
  sectionLabel: {
    color:         '#444',
    fontSize:      9,
    fontWeight:    '700',
    letterSpacing: 0.8,
    marginTop:     12,
    marginBottom:  6,
    marginLeft:    2,
  },

  // TF rows
  tfRow: {
    flexDirection:  'row',
    alignItems:     'center',
    backgroundColor: '#111826',
    borderRadius:    8,
    padding:         10,
    marginBottom:    6,
    borderWidth:     1,
    borderColor:     '#1e2a3a',
  },
  tfRowDim: { opacity: 0.5 },
  tfPill: {
    borderRadius:      6,
    borderWidth:       1,
    paddingHorizontal: 7,
    paddingVertical:   4,
    minWidth:          38,
    alignItems:        'center',
  },
  tfPillText: {
    fontSize:   10,
    fontWeight: '700',
  },
  tfCenter: {
    flex:       1,
    marginLeft: 10,
  },
  tfRow1: {
    flexDirection:  'row',
    alignItems:     'center',
    gap:            6,
    flexWrap:       'nowrap',
  },
  tfWaveLabel: {
    color:      '#C9D1D9',
    fontSize:   12,
    fontWeight: '600',
    minWidth:   60,
  },
  tfWaveLabelDim: {
    fontStyle: 'italic',
  },
  confBar: {
    height:       3,
    borderRadius: 1.5,
    maxWidth:     60,
  },
  tfDir: {
    fontSize:   11,
    fontWeight: '700',
    minWidth:   48,
  },
  tfTarget: {
    color:    '#8B949E',
    fontSize: 10,
    marginLeft: 4,
  },
  tfRow2: {
    flexDirection: 'row',
    marginTop:     3,
  },
  tfMeta: {
    color:    '#4a5568',
    fontSize: 10,
  },
  tfLoading: {
    color:    '#555',
    fontSize: 11,
    marginLeft: 8,
  },
  tfUnavailable: {
    color:    '#555',
    fontSize: 11,
    marginLeft: 12,
    fontStyle: 'italic',
  },

  // AI insight
  aiCard: {
    backgroundColor: '#111826',
    borderRadius:    8,
    padding:         12,
    marginBottom:    8,
    borderWidth:     1,
    borderColor:     '#1e2a3a',
    minHeight:       60,
  },
  aiLoading: {
    flexDirection:  'row',
    alignItems:     'center',
    gap:            8,
  },
  aiLoadingText: {
    color:    '#666',
    fontSize: 12,
    fontStyle: 'italic',
  },
  aiText: {
    color:      '#C9D1D9',
    fontSize:   12,
    lineHeight: 18,
  },
  hint: {
    color:    '#333',
    fontSize: 10,
    textAlign: 'center',
    marginTop: 8,
  },
});
