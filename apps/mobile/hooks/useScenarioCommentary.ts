/**
 * hooks/useScenarioCommentary.ts
 *
 * Fetches AI commentary for the primary wave count scenario.
 * Re-fetches when the primary scenario probability changes by more than 5%.
 *
 * Commentary is routed through the Vercel Edge Function at /api/ai-commentary
 * so ANTHROPIC_API_KEY never touches the client bundle.
 */

import { useEffect, useRef } from 'react';
import type { WaveCount } from '@elliott-wave-pro/wave-engine';
import { useWaveCountStore } from '../stores/waveCount';
import { useMarketDataStore } from '../stores/marketData';
import { useGEXStore } from '../stores/gex';
import { useCommentaryStore } from '../stores/commentary';

const AI_COMMENTARY_URL =
  `${process.env['EXPO_PUBLIC_API_BASE_URL'] ?? 'https://elliott-wave-pro-proxy.vercel.app'}/api/ai-commentary`;

const PROB_DELTA_THRESHOLD = 0.05;
const DEBOUNCE_MS          = 2000;

export function useScenarioCommentary(
  ticker:        string,
  timeframe:     string,
  ewMode?:       string,
  htfWaveCounts?: readonly WaveCount[],
) {
  const counts   = useWaveCountStore((s) => s.counts[`${ticker}_${timeframe}`] ?? []);
  const quote    = useMarketDataStore((s) => s.quotes[ticker]);
  const gexStore = useGEXStore((s) => s.levels[ticker]);
  const regime   = useMarketDataStore((s) => s.regimes[ticker]);

  const { setCommentary, setLoading, setError } = useCommentaryStore();

  const prevProbRef    = useRef<number>(-1);
  const debounceRef    = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlightRef    = useRef<string | null>(null);

  const primaryCount = counts[0];

  useEffect(() => {
    if (!primaryCount) return;

    const currentProb = primaryCount.posterior?.posterior ?? 0;
    const probDelta   = Math.abs(currentProb - prevProbRef.current);

    // Skip if probability hasn't shifted enough
    if (prevProbRef.current >= 0 && probDelta < PROB_DELTA_THRESHOLD) return;
    // Skip if same count already in flight
    if (inFlightRef.current === primaryCount.id) return;

    prevProbRef.current = currentProb;

    // Debounce rapid candle closes
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      const countId = primaryCount.id;
      inFlightRef.current = countId;
      setLoading(countId, true);

      try {
        const fibLevels: { label: string; price: number }[] = [];

        const gexLevel = gexStore
          ? (gexStore.zeroGex ? `Zero GEX at $${gexStore.zeroGex.toFixed(2)}` : null)
          : null;

        const altCount = counts[1];
        const w1 = primaryCount.allWaves?.[0];
        const waveStart = w1?.startPivot?.price ?? null;

        const htfPrimary  = htfWaveCounts?.[0];
        const htfLabel    = htfPrimary?.currentWave?.label ?? null;
        const htfTF       = htfPrimary?.timeframe ?? null;
        const htfStructure = htfPrimary?.currentWave?.structure ?? null;

        const payload = {
          ticker,
          waveLabel:    String(primaryCount.currentWave?.label ?? '?'),
          structure:    primaryCount.currentWave?.structure ?? '',
          probability:  currentProb,
          fibLevels,
          regime:       regime ?? null,
          nextTarget:   primaryCount.targets?.[0] ?? null,
          t2:           primaryCount.targets?.[1] ?? null,
          t3:           primaryCount.targets?.[2] ?? null,
          invalidation: primaryCount.stopPrice ?? null,
          price:        quote?.last ?? null,
          gexLevel,
          altWaveLabel:  altCount ? String(altCount.currentWave?.label ?? '?') : null,
          altConfidence: altCount?.posterior?.posterior ?? null,
          waveType:      (primaryCount as unknown as { type?: string }).type ?? null,
          waveStart,
          ewMode:        ewMode ?? 'now',
          htfLabel,
          htfTF,
          htfStructure,
        };

        const fetchOnce = () => fetch(AI_COMMENTARY_URL, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify(payload),
        });

        let res = await fetchOnce();
        // Retry once on server error / network hiccup
        if (!res.ok && res.status >= 500) res = await fetchOnce();
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        interface CommentaryResponse { commentary: string }
        const data = await res.json() as CommentaryResponse;
        setCommentary(countId, data.commentary ?? '');
      } catch (err) {
        setError(primaryCount.id, String(err));
      } finally {
        inFlightRef.current = null;
      }
    }, DEBOUNCE_MS);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [primaryCount?.id, primaryCount?.posterior?.posterior]);

  return null;
}
