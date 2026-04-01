/**
 * MultiDegreeContextBanner.tsx
 *
 * Shown between the timeframe pills and chart canvas when Multi-Degree mode
 * is active. Explains what the current-TF wave structure fits into at the
 * higher timeframe — directly answers the swing-trader question
 * "what does this wave fit into?"
 *
 * Direction conflict (HTF bull vs current TF bear, or vice-versa) is flagged
 * in amber with a ⚠ prefix.
 */

import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import type { WaveCount } from '@elliott-wave-pro/wave-engine';

// ── Helpers ───────────────────────────────────────────────────────────────────

function getWaveDirection(count: WaveCount): 'bull' | 'bear' {
  const w1 = count.allWaves.find((w) => w.label === '1' || w.label === 'A');
  const start = w1?.startPivot?.price;
  const end   = w1?.endPivot?.price;
  if (start == null || end == null) return 'bull';
  return end > start ? 'bull' : 'bear';
}

function buildContextText(htfCount: WaveCount): string {
  const wave = htfCount.currentWave;
  if (!wave) return 'HTF wave context loading…';

  const label     = wave.label;
  const htfTF     = htfCount.timeframe;
  const isImpulse = wave.structure?.toLowerCase().includes('impulse') ?? true;
  const dir       = getWaveDirection(htfCount);
  const dirStr    = dir === 'bull' ? 'bullish' : 'bearish';
  const typeStr   = isImpulse ? 'impulse' : 'correction';

  if (isImpulse && label === '1') {
    return `${htfTF} Wave 1 emerging — trend is establishing, stay ${dirStr}`;
  }
  if (isImpulse && label === '2') {
    return `Pullback within ${htfTF} impulse — opportunity if Wave 2 support holds`;
  }
  if (isImpulse && label === '3') {
    return `${htfTF} Wave 3 of impulse — strongest trend phase, expect continuation`;
  }
  if (isImpulse && label === '4') {
    return `Correction within ${htfTF} impulse — consolidation before final wave`;
  }
  if (isImpulse && label === '5') {
    return `${htfTF} Wave 5 — final wave of ${typeStr}, watch for reversal on completion`;
  }
  if (!isImpulse && label === 'A') {
    return `${htfTF} Wave A of correction — initial leg down, may bounce at B`;
  }
  if (!isImpulse && label === 'B') {
    return `${htfTF} Wave B rally — corrective bounce, likely to fail at prior high`;
  }
  if (!isImpulse && label === 'C') {
    return `${htfTF} Wave C completing correction — ${dirStr} reversal likely near completion`;
  }
  return `Sub-wave of ${htfTF} Wave ${label} (${typeStr}, ${dirStr})`;
}

// ── Component ─────────────────────────────────────────────────────────────────

interface Props {
  htfWaveCounts: readonly WaveCount[];
  waveCounts:    readonly WaveCount[];
}

export function MultiDegreeContextBanner({ htfWaveCounts, waveCounts }: Props) {
  const result = useMemo(() => {
    if (!htfWaveCounts.length) return null;
    const htfCount     = htfWaveCounts[0];
    const currentCount = waveCounts[0];
    if (!htfCount?.currentWave) return null;

    const htfDir     = getWaveDirection(htfCount);
    const currentDir = currentCount ? getWaveDirection(currentCount) : htfDir;
    const conflict   = htfDir !== currentDir;

    const htfTF    = htfCount.timeframe;
    const htfLabel = htfCount.currentWave.label;
    const text     = buildContextText(htfCount);
    const prefix   = conflict ? '⚠ ' : '📊 ';
    const color    = conflict ? '#F59E0B' : '#B8A020';

    return { htfTF, htfLabel, text, prefix, color, conflict };
  }, [htfWaveCounts, waveCounts]);

  if (!result) return null;

  return (
    <View style={[styles.banner, result.conflict && styles.bannerConflict]}>
      <Text style={[styles.primary, { color: result.color }]}>
        {result.prefix}{result.htfTF} context: Wave {result.htfLabel}
      </Text>
      <Text style={[styles.secondary, { color: result.color }]} numberOfLines={2}>
        {result.text}
      </Text>
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  banner: {
    backgroundColor: 'rgba(184,160,32,0.08)',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(184,160,32,0.18)',
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  bannerConflict: {
    backgroundColor: 'rgba(245,158,11,0.08)',
    borderBottomColor: 'rgba(245,158,11,0.20)',
  },
  primary: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  secondary: {
    fontSize: 10,
    fontWeight: '400',
    marginTop: 1,
    opacity: 0.85,
  },
});
