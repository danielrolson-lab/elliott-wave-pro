/**
 * useWaveConfluence.ts
 *
 * Fetches candles for 5 timeframes (5m, 15m, 30m, 1h, 1D) in parallel,
 * runs the wave engine on each, and calculates a multi-timeframe
 * confluence score.
 *
 * Results are cached for 5 minutes per ticker.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { detectPivots, generateWaveCountsV3 } from '@elliott-wave-pro/wave-engine';
import type { OHLCV, PatternCandidate } from '@elliott-wave-pro/wave-engine';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface TFResult {
  timeframe: string;
  waveLabel:       string;
  direction:       'BULL' | 'BEAR';
  confidence:      number;   // 0–100
  waveType:        string;   // 'impulse' | 'corrective'
  isForming:       boolean;
  t1:              number;
  stopPrice:       number;
  rrRatio:         number;
  status:          'loading' | 'ready' | 'error';
  error?:          string;
}

export type ConfluenceLabel = 'Strong Confluence' | 'Moderate Confluence' | 'Mixed Signals' | 'No Confluence';

export interface ConfluenceScore {
  score:            number;   // 0–1
  label:            ConfluenceLabel;
  majorityDir:      'BULL' | 'BEAR';
  directionCount:   number;   // count of majority direction out of 5
  avgConfidence:    number;   // 0–100
  dominantPattern:  string;
  bestSetup:        TFResult | null;
}

export interface UseWaveConfluenceResult {
  results:   TFResult[];
  score:     ConfluenceScore | null;
  loading:   boolean;
  refresh:   () => void;
  /** Summary text for the button teaser */
  teaser:    string;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const CONFLUENCE_TFS = ['5m', '15m', '30m', '1h', '1D'] as const;
type ConfluenceTF = typeof CONFLUENCE_TFS[number];

interface TFSpec {
  multiplier:  number;
  timespan:    'minute' | 'hour' | 'day';
  lookbackDays: number;
}

const CONF_TF_MAP: Record<ConfluenceTF, TFSpec> = {
  '5m':  { multiplier: 5,  timespan: 'minute', lookbackDays: 5  },
  '15m': { multiplier: 15, timespan: 'minute', lookbackDays: 5  },
  '30m': { multiplier: 30, timespan: 'minute', lookbackDays: 10 },
  '1h':  { multiplier: 1,  timespan: 'hour',   lookbackDays: 30 },
  '1D':  { multiplier: 1,  timespan: 'day',    lookbackDays: 730},
};

const MIN_SWING_PCT: Record<ConfluenceTF, number> = {
  '5m':  0.00020,
  '15m': 0.00025,
  '30m': 0.00030,
  '1h':  0.00035,
  '1D':  0.00050,
};

const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// ── In-memory cache ───────────────────────────────────────────────────────────

interface CacheEntry {
  ticker:    string;
  ts:        number;
  results:   TFResult[];
  score:     ConfluenceScore;
}

const cache: Map<string, CacheEntry> = new Map();

function cacheKey(ticker: string): string {
  // Rounds to nearest 5-minute bucket
  return `confluence_${ticker}_${Date.now() - (Date.now() % CACHE_TTL)}`;
}

// ── Polygon fetch ─────────────────────────────────────────────────────────────

async function fetchPolygonCandles(
  ticker: string,
  spec: TFSpec,
  apiKey: string,
  signal: AbortSignal,
): Promise<OHLCV[]> {
  const now  = new Date();
  const from = new Date(now.getTime() - spec.lookbackDays * 86_400_000);

  const fmt = (d: Date) =>
    `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;

  const params = new URLSearchParams({
    adjusted: 'true',
    sort:     'asc',
    limit:    '5000',
    apiKey,
  });

  const url = [
    'https://api.polygon.io/v2/aggs/ticker',
    encodeURIComponent(ticker),
    'range',
    String(spec.multiplier),
    spec.timespan,
    fmt(from),
    fmt(now),
  ].join('/') + `?${params}`;

  const resp = await fetch(url, { signal });
  if (!resp.ok) throw new Error(`Polygon ${resp.status}`);

  const data = await resp.json() as { status: string; results?: Array<{ t: number; o: number; h: number; l: number; c: number; v: number }> };
  if (!data.results?.length) return [];

  return data.results.map((a) => ({
    timestamp: a.t,
    open:      a.o,
    high:      a.h,
    low:       a.l,
    close:     a.c,
    volume:    a.v,
  }));
}

// ── Wave analysis for a single TF ─────────────────────────────────────────────

function analyzeCandles(candles: OHLCV[], timeframe: ConfluenceTF): Omit<TFResult, 'status'> {
  const swingFloor = MIN_SWING_PCT[timeframe];
  const pivots = detectPivots(candles, 0.5, timeframe, swingFloor);

  if (pivots.length < 4) {
    return {
      timeframe,
      waveLabel:  '?',
      direction:  'BULL',
      confidence: 0,
      waveType:   'unknown',
      isForming:  false,
      t1:         0,
      stopPrice:  0,
      rrRatio:    0,
    };
  }

  const v3Pivots = pivots.map((p) => ({
    ts:     p.timestamp,
    price:  p.price,
    isHigh: p.type === 'HH' || p.type === 'LH',
    bar:    p.index,
  }));

  const candidates = generateWaveCountsV3({
    pivots:     v3Pivots,
    ticker:     'CONF',
    timeframe,
    assetClass: 'equity',
    state:      {},
    candles:    candles.map((c) => ({
      ts: c.timestamp, open: c.open, high: c.high,
      low: c.low, close: c.close, volume: c.volume,
    })),
  });

  if (!candidates.length) {
    return {
      timeframe,
      waveLabel:  '?',
      direction:  'BULL',
      confidence: 0,
      waveType:   'unknown',
      isForming:  false,
      t1:         0,
      stopPrice:  0,
      rrRatio:    0,
    };
  }

  const top: PatternCandidate = candidates[0];
  const isCorrective = top.type === 'zigzag' || top.type === 'regular_flat' || top.type === 'expanded_flat';
  const lastPivot = top.pivots[top.pivots.length - 1];
  const firstPivot = top.pivots[0];

  const waveLabels = isCorrective ? ['A', 'B', 'C'] : ['1', '2', '3', '4', '5'];
  const waveCount  = top.pivots.length - 1;
  const waveLabel  = waveLabels[Math.min(waveCount - 1, waveLabels.length - 1)] ?? waveLabels[waveLabels.length - 1];

  const direction: 'BULL' | 'BEAR' = top.isBullish ? 'BULL' : 'BEAR';
  const confidence = Math.round(top.confidence * 100);

  const tz = top.targetZone;
  let t1 = tz?.[0] ?? 0;
  if (t1 === 0 && lastPivot) {
    const waveLen = Math.abs(lastPivot.price - firstPivot.price);
    const dir = top.isBullish ? 1 : -1;
    t1 = lastPivot.price + dir * waveLen * 1.0;
  }

  const stopPrice = top.invalidation ?? 0;
  const lastPrice = lastPivot?.price ?? 0;
  const risk   = Math.abs(lastPrice - stopPrice);
  const reward = Math.abs(t1 - lastPrice);
  const rrRatio = risk > 0 ? Math.round((reward / risk) * 10) / 10 : 0;

  const isForming = top.stage !== 'complete';

  return {
    timeframe,
    waveLabel,
    direction,
    confidence,
    waveType: isCorrective ? 'Corrective' : 'Impulse',
    isForming,
    t1,
    stopPrice,
    rrRatio,
  };
}

// ── Confluence score ───────────────────────────────────────────────────────────

function computeConfluence(results: TFResult[]): ConfluenceScore {
  const ready = results.filter((r) => r.status === 'ready' && r.confidence > 0);
  if (!ready.length) {
    return { score: 0, label: 'No Confluence', majorityDir: 'BULL', directionCount: 0, avgConfidence: 0, dominantPattern: '—', bestSetup: null };
  }

  const bullCount = ready.filter((r) => r.direction === 'BULL').length;
  const bearCount = ready.length - bullCount;
  const majorityDir: 'BULL' | 'BEAR' = bullCount >= bearCount ? 'BULL' : 'BEAR';
  const directionCount = Math.max(bullCount, bearCount);

  const directionScore = directionCount / 5;

  // Position agreement: check how many share same wave label
  const positionCounts: Record<string, number> = {};
  for (const r of ready) positionCounts[r.waveLabel] = (positionCounts[r.waveLabel] ?? 0) + 1;
  const maxPositionCount = Math.max(...Object.values(positionCounts));
  const positionScore = maxPositionCount / 5;

  const avgConfidence = Math.round(ready.reduce((s, r) => s + r.confidence, 0) / ready.length);
  const avgConfidenceNorm = avgConfidence / 100;

  const score = directionScore * 0.5 + positionScore * 0.3 + avgConfidenceNorm * 0.2;

  let label: ConfluenceLabel;
  if (score >= 0.80) label = 'Strong Confluence';
  else if (score >= 0.60) label = 'Moderate Confluence';
  else if (score >= 0.40) label = 'Mixed Signals';
  else label = 'No Confluence';

  // Dominant pattern
  const impulseCount = ready.filter((r) => r.waveType === 'Impulse').length;
  const dominantPattern = impulseCount >= ready.length / 2 ? 'Impulse' : 'Corrective';

  // Best setup: highest confidence with majority direction
  const majorityResults = ready.filter((r) => r.direction === majorityDir);
  const bestSetup = majorityResults.sort((a, b) => b.confidence - a.confidence)[0] ?? ready[0];

  return { score, label, majorityDir, directionCount, avgConfidence, dominantPattern, bestSetup };
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useWaveConfluence(ticker: string): UseWaveConfluenceResult {
  const [results, setResults]   = useState<TFResult[]>(
    CONFLUENCE_TFS.map((tf) => ({ timeframe: tf, waveLabel: '?', direction: 'BULL', confidence: 0, waveType: 'unknown', isForming: false, t1: 0, stopPrice: 0, rrRatio: 0, status: 'loading' }))
  );
  const [score, setScore]       = useState<ConfluenceScore | null>(null);
  const [loading, setLoading]   = useState(false);
  const abortRef                = useRef<AbortController | null>(null);

  const fetchAll = useCallback(async (force = false) => {
    const key = cacheKey(ticker);
    if (!force) {
      const cached = cache.get(key);
      if (cached) {
        setResults(cached.results);
        setScore(cached.score);
        return;
      }
    }

    const apiKey = process.env.EXPO_PUBLIC_POLYGON_API_KEY;
    if (!apiKey) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    const initial = CONFLUENCE_TFS.map((tf) => ({
      timeframe: tf as string, waveLabel: '?', direction: 'BULL' as const,
      confidence: 0, waveType: 'unknown', isForming: false, t1: 0, stopPrice: 0, rrRatio: 0, status: 'loading' as const,
    }));
    setResults(initial);

    const updatedResults = [...initial] as TFResult[];

    // Fetch each TF — update progressively as each resolves
    const promises = CONFLUENCE_TFS.map(async (tf, idx) => {
      try {
        const spec = CONF_TF_MAP[tf];
        const candles = await fetchPolygonCandles(ticker, spec, apiKey, controller.signal);
        if (candles.length < 20) {
          updatedResults[idx] = { ...updatedResults[idx], status: 'error', error: 'Insufficient data' };
        } else {
          const analysis = analyzeCandles(candles, tf);
          updatedResults[idx] = { ...analysis, status: 'ready' };
        }
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') return;
        updatedResults[idx] = { ...updatedResults[idx], status: 'error', error: 'Unavailable' };
      }
      // Progressive update — show each row as it lands
      setResults([...updatedResults]);
    });

    await Promise.allSettled(promises);

    if (controller.signal.aborted) return;

    const finalScore = computeConfluence(updatedResults);
    setScore(finalScore);
    setLoading(false);

    // Cache result
    cache.set(key, { ticker, ts: Date.now(), results: updatedResults, score: finalScore });
  }, [ticker]);

  // On mount / ticker change: check cache first, else fetch
  useEffect(() => {
    const key = cacheKey(ticker);
    const cached = cache.get(key);
    if (cached) {
      setResults(cached.results);
      setScore(cached.score);
      return undefined;
    }
    // Low-priority background fetch after a short delay so main chart loads first
    const t = setTimeout(() => { fetchAll(false); }, 2000);
    return () => clearTimeout(t);
  }, [ticker, fetchAll]);

  // Cleanup on unmount
  useEffect(() => {
    return () => { abortRef.current?.abort(); };
  }, []);

  const teaser = score
    ? `${score.majorityDir === 'BULL' ? '▲' : '▼'} ${score.majorityDir} · ${score.label} · ${score.directionCount}/5 TFs`
    : 'Tap to analyze';

  return { results, score, loading, refresh: () => fetchAll(true), teaser };
}
