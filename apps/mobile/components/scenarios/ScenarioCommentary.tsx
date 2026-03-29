/**
 * components/scenarios/ScenarioCommentary.tsx
 *
 * Displays AI-generated natural language commentary for the primary wave
 * scenario. Appears below the primary ScenarioCard; collapsed by default.
 *
 * Reads from commentaryStore — no prop drilling of text.
 * Loading state shows an animated ellipsis; error state shows a muted fallback.
 */

import React, { useCallback, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { useWaveCountStore } from '../../stores/waveCount';
import { useCommentaryStore } from '../../stores/commentary';
import { DARK } from '../../theme/colors';

interface Props {
  ticker:    string;
  timeframe: string;
}

export function ScenarioCommentary({ ticker, timeframe }: Props) {
  const [expanded, setExpanded] = useState(false);
  const clearError = useCommentaryStore((s) => s.setError);

  const primaryCount = useWaveCountStore(
    (s) => (s.counts[`${ticker}_${timeframe}`] ?? [])[0],
  );

  const commentary = useCommentaryStore(
    (s) => (primaryCount ? s.texts[primaryCount.id] : undefined),
  );
  const loading = useCommentaryStore(
    (s) => (primaryCount ? (s.loading[primaryCount.id] ?? false) : false),
  );
  const error = useCommentaryStore(
    (s) => (primaryCount ? s.errors[primaryCount.id] : null),
  );

  const handleRetry = useCallback(() => {
    if (primaryCount) clearError(primaryCount.id, null);
  }, [primaryCount, clearError]);

  if (!primaryCount) return null;
  if (!loading && !commentary && !error) return null;

  return (
    <View style={styles.container}>
      <Pressable style={styles.header} onPress={() => setExpanded((v) => !v)}>
        <View style={styles.aiTag}>
          <Text style={styles.aiTagText}>AI</Text>
        </View>
        <Text style={styles.headerLabel}>Wave Commentary</Text>
        <Text style={styles.chevron}>{expanded ? '▲' : '▼'}</Text>
      </Pressable>

      {expanded && (
        <View style={styles.body}>
          {loading ? (
            <View style={styles.loadingRow}>
              <ActivityIndicator size="small" color={DARK.accent} />
              <Text style={styles.loadingText}>Generating commentary…</Text>
            </View>
          ) : error ? (
            <Pressable onPress={handleRetry} style={styles.errorRow}>
              <Text style={styles.errorText}>Wave commentary unavailable — tap to retry</Text>
            </Pressable>
          ) : (
            <Text style={styles.commentaryText}>{commentary}</Text>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginTop:         4,
    borderRadius:      6,
    borderWidth:       1,
    borderColor:       DARK.border,
    backgroundColor:   DARK.surfaceRaised,
    overflow:          'hidden',
  },
  header: {
    flexDirection:     'row',
    alignItems:        'center',
    paddingHorizontal: 10,
    paddingVertical:   7,
    gap:               6,
  },
  aiTag: {
    backgroundColor:   '#7c3aed',
    borderRadius:      3,
    paddingHorizontal: 5,
    paddingVertical:   1,
  },
  aiTagText: {
    color:      '#fff',
    fontSize:   9,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  headerLabel: {
    color:      DARK.textSecondary,
    fontSize:   11,
    fontWeight: '600',
    flex:       1,
  },
  chevron: {
    color:    DARK.textMuted,
    fontSize: 10,
  },
  body: {
    paddingHorizontal: 10,
    paddingBottom:     10,
    paddingTop:        2,
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           8,
    paddingVertical: 4,
  },
  loadingText: {
    color:    DARK.textMuted,
    fontSize: 11,
    fontStyle: 'italic',
  },
  errorRow: {
    paddingVertical: 4,
  },
  errorText: {
    color:     '#ef4444',
    fontSize:  11,
    fontStyle: 'italic',
  },
  commentaryText: {
    color:      DARK.textSecondary,
    fontSize:   12,
    lineHeight: 18,
  },
});
