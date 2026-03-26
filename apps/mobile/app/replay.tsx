/**
 * app/replay.tsx — ReplayScreen
 *
 * Replays a historical wave analog candle-by-candle, showing what the
 * wave engine would have said at each step.
 *
 * Controls:
 *   ◀◀ (step back)  ▶ / ‖ (play/pause)  ▶▶ (step forward)
 *   Speed selector: 0.5× / 1× / 2× / 4×
 *
 * Available on all paid tiers (gated by subscription store).
 */

import React, {
  useState, useEffect, useRef, useCallback, useMemo,
} from 'react';
import {
  View, Text, Pressable, StyleSheet, Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRoute, type RouteProp } from '@react-navigation/native';
import { Canvas, Path, Skia } from '@shopify/react-native-skia';
import type { OHLCV } from '@elliott-wave-pro/wave-engine';
import { detectPivots, generateWaveCounts, scoreWaveCounts }
  from '@elliott-wave-pro/wave-engine';
import { useWaveScanStore } from '../stores/waveScan';
import { useSubscriptionStore } from '../stores/subscription';
import { DARK }   from '../theme/colors';
import type { ScanStackParamList } from '../navigation/AppNavigator';

const { width: SCREEN_W } = Dimensions.get('window');
const CHART_H = 260;
const CHART_W = SCREEN_W - 24;

type ReplayRouteProp = RouteProp<ScanStackParamList, 'Replay'>;

const SPEEDS = [0.5, 1, 2, 4] as const;

// ── Mini wave engine call (client-side) ────────────────────────────────────

function barToOHLCV(b: { o: number; h: number; l: number; c: number; v: number; t: number }): OHLCV {
  return { timestamp: b.t, open: b.o, high: b.h, low: b.l, close: b.c, volume: b.v };
}

function runWaveEngineSlice(bars: Array<{ o: number; h: number; l: number; c: number; v: number; t: number }>) {
  if (bars.length < 10) return null;
  try {
    const ohlcv  = bars.map(barToOHLCV);
    const pivots = detectPivots(ohlcv, 0.5, '5m');
    if (pivots.length < 4) return null;
    const counts = generateWaveCounts(pivots, 'REPLAY', '5m');
    if (counts.length === 0) return null;
    const scored = scoreWaveCounts(counts, ohlcv, 50, 0);
    return scored[0] ?? null;
  } catch {
    return null;
  }
}

// ── Chart drawing ─────────────────────────────────────────────────────────

function MiniReplayChart({ bars, currentIdx }: {
  bars: Array<{ o: number; h: number; l: number; c: number; v: number; t: number }>;
  currentIdx: number;
}) {
  const visibleBars = bars.slice(0, currentIdx + 1);
  const paths = useMemo(() => {
    if (visibleBars.length === 0) return [];
    const highs = visibleBars.map((b) => b.h);
    const lows  = visibleBars.map((b) => b.l);
    const maxH  = Math.max(...highs);
    const minL  = Math.min(...lows);
    const range = maxH - minL || 1;
    const barW  = CHART_W / Math.max(visibleBars.length, 1);

    return visibleBars.map((bar, i) => {
      const yH   = CHART_H * (1 - (bar.h - minL) / range);
      const yL   = CHART_H * (1 - (bar.l - minL) / range);
      const yO   = CHART_H * (1 - (bar.o - minL) / range);
      const yC   = CHART_H * (1 - (bar.c - minL) / range);
      const bull = bar.c >= bar.o;
      const bodyTop    = Math.min(yO, yC);
      const bodyBottom = Math.max(yO, yC);
      const bodyH      = Math.max(bodyBottom - bodyTop, 1);

      const wickPath = Skia.Path.Make();
      wickPath.moveTo(i * barW + barW / 2, yH);
      wickPath.lineTo(i * barW + barW / 2, yL);

      const bodyPath = Skia.Path.Make();
      bodyPath.addRect({ x: i * barW + 0.5, y: bodyTop, width: Math.max(barW - 1, 1), height: bodyH });

      return { wickPath, bodyPath, bull };
    });
  }, [visibleBars]);

  return (
    <Canvas style={{ width: CHART_W, height: CHART_H }}>
      {paths.map(({ wickPath, bodyPath, bull }, i) => (
        <React.Fragment key={i}>
          <Path path={wickPath} color={bull ? DARK.bullish : DARK.bearish} style="stroke" strokeWidth={0.8} />
          <Path path={bodyPath} color={bull ? DARK.bullish : DARK.bearish} style="fill" />
        </React.Fragment>
      ))}
    </Canvas>
  );
}

// ── Screen ────────────────────────────────────────────────────────────────────

export function ReplayScreen() {
  const route   = useRoute<ReplayRouteProp>();
  const { instanceIdx, scanKey } = route.params;

  const tier = useSubscriptionStore((s) => s.tier);
  const isPaid = tier === 'pro' || tier === 'elite';

  const result   = useWaveScanStore((s) => s.results[scanKey]);
  const instance = result?.instances[instanceIdx];

  const bars = useMemo(() => instance?.mini_candles ?? [], [instance]);
  const [curIdx,  setCurIdx]  = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed,   setSpeed]   = useState<0.5 | 1 | 2 | 4>(1);

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopInterval = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  const startInterval = useCallback(() => {
    stopInterval();
    intervalRef.current = setInterval(() => {
      setCurIdx((prev) => {
        if (prev >= bars.length - 1) {
          setPlaying(false);
          return prev;
        }
        return prev + 1;
      });
    }, Math.round(600 / speed));
  }, [speed, bars.length, stopInterval]);

  useEffect(() => {
    if (playing) { startInterval(); }
    else { stopInterval(); }
    return stopInterval;
  }, [playing, startInterval, stopInterval]);

  const stepBack    = useCallback(() => { setPlaying(false); setCurIdx((p) => Math.max(0, p - 1)); }, []);
  const stepForward = useCallback(() => { setPlaying(false); setCurIdx((p) => Math.min(bars.length - 1, p + 1)); }, [bars.length]);
  const togglePlay  = useCallback(() => {
    if (curIdx >= bars.length - 1) { setCurIdx(0); }
    setPlaying((p) => !p);
  }, [curIdx, bars.length]);

  // Run wave engine on visible slice
  const waveResult = useMemo(() => {
    if (!isPaid) return null;
    return runWaveEngineSlice(bars.slice(0, curIdx + 1));
  }, [bars, curIdx, isPaid]);

  const currentBar  = bars[curIdx];
  const waveLabel   = waveResult?.currentWave?.label ?? null;
  const waveStruct  = waveResult?.currentWave?.structure ?? null;
  const waveProbRaw = waveResult?.posterior?.posterior ?? 0;
  const progress    = bars.length > 1 ? curIdx / (bars.length - 1) : 0;

  if (!instance) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.centered}>
          <Text style={styles.errorText}>Analog not found. Run a scan first.</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!isPaid) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.centered}>
          <Text style={styles.lockIcon}>🔒</Text>
          <Text style={styles.lockTitle}>Pro Feature</Text>
          <Text style={styles.lockSubtitle}>Replay Mode is available on Pro and Elite plans.</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>Replay — {instance.entry_date}</Text>
        <Text style={styles.subtitle}>
          Bar {curIdx + 1} / {bars.length} · W{instance.wave_label}
        </Text>
      </View>

      {/* Chart */}
      <View style={styles.chartBox}>
        <MiniReplayChart bars={bars} currentIdx={curIdx} />
        {/* Progress bar */}
        <View style={styles.progressBar}>
          <View style={[styles.progressFill, { width: `${progress * 100}%` }]} />
        </View>
      </View>

      {/* Current bar info */}
      {currentBar && (
        <View style={styles.barInfoRow}>
          <Text style={styles.barInfoItem}>O {currentBar.o.toFixed(2)}</Text>
          <Text style={styles.barInfoItem}>H {currentBar.h.toFixed(2)}</Text>
          <Text style={styles.barInfoItem}>L {currentBar.l.toFixed(2)}</Text>
          <Text style={[styles.barInfoItem, {
            color: currentBar.c >= currentBar.o ? DARK.bullish : DARK.bearish,
          }]}>C {currentBar.c.toFixed(2)}</Text>
          <Text style={styles.barInfoItem}>V {(currentBar.v / 1000).toFixed(0)}K</Text>
        </View>
      )}

      {/* Wave engine output */}
      <View style={styles.waveBox}>
        <Text style={styles.waveBoxLabel}>Wave Engine (at this point in time)</Text>
        {waveResult ? (
          <View style={styles.waveResult}>
            <Text style={styles.waveResultLabel}>
              {waveLabel ?? '?'} · {waveStruct ?? ''}
            </Text>
            <Text style={styles.waveResultProb}>
              Posterior: {Math.round(waveProbRaw * 100)}%
            </Text>
          </View>
        ) : (
          <Text style={styles.wavePlaceholder}>
            {curIdx < 5 ? 'Not enough bars yet…' : 'No valid count detected'}
          </Text>
        )}
      </View>

      {/* Controls */}
      <View style={styles.controls}>
        {/* Speed */}
        <View style={styles.speedRow}>
          {SPEEDS.map((s) => (
            <Pressable
              key={s}
              style={[styles.speedPill, speed === s && styles.speedPillActive]}
              onPress={() => setSpeed(s)}
            >
              <Text style={[styles.speedText, speed === s && styles.speedTextActive]}>
                {s}×
              </Text>
            </Pressable>
          ))}
        </View>

        {/* Playback */}
        <View style={styles.playbackRow}>
          <Pressable style={styles.ctrlBtn} onPress={stepBack}>
            <Text style={styles.ctrlIcon}>◀◀</Text>
          </Pressable>
          <Pressable style={[styles.ctrlBtn, styles.ctrlBtnPlay]} onPress={togglePlay}>
            <Text style={styles.ctrlIconPlay}>{playing ? '‖' : '▶'}</Text>
          </Pressable>
          <Pressable style={styles.ctrlBtn} onPress={stepForward}>
            <Text style={styles.ctrlIcon}>▶▶</Text>
          </Pressable>
        </View>
      </View>
    </SafeAreaView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe:     { flex: 1, backgroundColor: DARK.background },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  errorText:{ color: DARK.textMuted, fontSize: 14, textAlign: 'center' },
  lockIcon: { fontSize: 40, marginBottom: 12 },
  lockTitle:{ color: DARK.textPrimary, fontSize: 18, fontWeight: '700', marginBottom: 8 },
  lockSubtitle: { color: DARK.textMuted, fontSize: 13, textAlign: 'center' },

  header: {
    paddingHorizontal: 16,
    paddingTop:        12,
    paddingBottom:     8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: DARK.separator,
  },
  title:    { color: DARK.textPrimary, fontSize: 18, fontWeight: '700' },
  subtitle: { color: DARK.textMuted,   fontSize: 12, marginTop: 2 },

  chartBox: {
    margin:          12,
    backgroundColor: DARK.surface,
    borderRadius:    8,
    overflow:        'hidden',
    borderWidth:     1,
    borderColor:     DARK.border,
  },
  progressBar: {
    height:          2,
    backgroundColor: DARK.border,
  },
  progressFill: {
    height:          2,
    backgroundColor: '#1d6fe8',
  },

  barInfoRow: {
    flexDirection:     'row',
    justifyContent:    'space-around',
    paddingHorizontal: 12,
    paddingVertical:   6,
    backgroundColor:   DARK.surface,
    marginHorizontal:  12,
    borderRadius:      6,
    borderWidth:       1,
    borderColor:       DARK.border,
    marginBottom:      8,
  },
  barInfoItem: { color: DARK.textSecondary, fontSize: 11, fontWeight: '600' },

  waveBox: {
    marginHorizontal:  12,
    padding:           10,
    backgroundColor:   DARK.surface,
    borderRadius:      6,
    borderWidth:       1,
    borderColor:       DARK.border,
    marginBottom:      12,
  },
  waveBoxLabel:     { color: DARK.textMuted, fontSize: 10, marginBottom: 6 },
  waveResult:       { flexDirection: 'row', alignItems: 'center', gap: 12 },
  waveResultLabel:  { color: DARK.textPrimary, fontSize: 15, fontWeight: '700' },
  waveResultProb:   { color: '#60a5fa', fontSize: 13 },
  wavePlaceholder:  { color: DARK.textMuted, fontSize: 12, fontStyle: 'italic' },

  controls: { paddingHorizontal: 12, gap: 10 },

  speedRow: { flexDirection: 'row', gap: 8, justifyContent: 'center' },
  speedPill: {
    paddingHorizontal: 16,
    paddingVertical:    6,
    borderRadius:       4,
    borderWidth:        1,
    borderColor:        DARK.border,
  },
  speedPillActive: { backgroundColor: '#1d4ed8', borderColor: '#1d4ed8' },
  speedText:       { color: DARK.textMuted, fontSize: 13, fontWeight: '600' },
  speedTextActive: { color: '#fff' },

  playbackRow: { flexDirection: 'row', gap: 16, justifyContent: 'center', alignItems: 'center' },
  ctrlBtn: {
    paddingHorizontal: 20,
    paddingVertical:   10,
    borderRadius:      8,
    backgroundColor:   DARK.surface,
    borderWidth:       1,
    borderColor:       DARK.border,
  },
  ctrlBtnPlay: {
    backgroundColor: '#1d6fe8',
    borderColor:     '#1d6fe8',
    paddingHorizontal: 28,
  },
  ctrlIcon:     { color: DARK.textSecondary, fontSize: 14, fontWeight: '700' },
  ctrlIconPlay: { color: '#fff', fontSize: 18, fontWeight: '700' },
});
