/**
 * useFlowFeed.ts
 *
 * Polls for unusual options flow every POLL_INTERVAL_MS.
 * On each poll, results are ingested into the flow store which handles
 * dedup, ring-buffer eviction, and REPEAT tagging.
 *
 * Tickers scanned: the user's watchlist + a default set of liquid underlyings.
 * The premium threshold comes live from the store's filter.minPremium.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchUnusualFlow } from '../services/flowFeed';
import { useFlowStore }     from '../stores/flow';

const POLYGON_API_KEY    = process.env.EXPO_PUBLIC_POLYGON_API_KEY ?? '';
const POLL_INTERVAL_MS   = 30_000;   // 30 seconds

/** Default liquid underlyings always included in the scan. */
const DEFAULT_TICKERS = ['SPY', 'QQQ', 'IWM', 'AAPL', 'TSLA', 'NVDA', 'AMZN', 'MSFT', 'META'];

export type FlowFeedStatus = 'idle' | 'loading' | 'live' | 'error';

export interface UseFlowFeedResult {
  status:  FlowFeedStatus;
  error:   string | null;
  refresh: () => void;
}

export function useFlowFeed(extraTickers: string[] = []): UseFlowFeedResult {
  const ingest      = useFlowStore((s) => s.ingest);
  const minPremium  = useFlowStore((s) => s.filter.minPremium);

  const [status, setStatus] = useState<FlowFeedStatus>('idle');
  const [error,  setError]  = useState<string | null>(null);
  const abortRef    = useRef<AbortController | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const tickers = Array.from(new Set([...DEFAULT_TICKERS, ...extraTickers]));

  const poll = useCallback(async () => {
    if (!POLYGON_API_KEY) {
      setStatus('error');
      setError('EXPO_PUBLIC_POLYGON_API_KEY not configured');
      return;
    }

    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    // Show 'loading' only on first poll; subsequent polls silently update
    setStatus((prev) => (prev === 'idle' ? 'loading' : prev));
    setError(null);

    try {
      const prints = await fetchUnusualFlow(tickers, POLYGON_API_KEY, minPremium, ctrl.signal);
      if (ctrl.signal.aborted) return;

      ingest(prints);
      setStatus('live');
    } catch (err: unknown) {
      if (ctrl.signal.aborted) return;
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      setStatus('error');
    }
  }, [tickers, minPremium, ingest]);

  // Start polling on mount; restart when minPremium changes
  useEffect(() => {
    void poll();

    intervalRef.current = setInterval(() => { void poll(); }, POLL_INTERVAL_MS);

    return () => {
      abortRef.current?.abort();
      if (intervalRef.current !== null) clearInterval(intervalRef.current);
    };
  }, [poll]);

  return { status, error, refresh: poll };
}
