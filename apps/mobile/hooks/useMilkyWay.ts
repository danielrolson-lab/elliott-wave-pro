import { useCallback, useEffect, useRef } from 'react';
import { useMilkyWayStore } from '../stores/milkyway';

const API_BASE = process.env.EXPO_PUBLIC_API_BASE_URL ?? 'https://elliott-wave-pro-proxy.vercel.app';
const CACHE_TTL_MS = 15 * 60 * 1000; // 15 min

export function useMilkyWay(timeframe: string) {
  const { results, status, error, setResult, setStatus, setError } = useMilkyWayStore();
  const lastFetchRef = useRef<number>(0);

  const scan = useCallback(async (force = false) => {
    const now = Date.now();
    const cached = results[timeframe];
    const age = now - lastFetchRef.current;

    if (!force && cached && age < CACHE_TTL_MS) return;

    setStatus(timeframe, 'loading');

    const attempt = async (): Promise<void> => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 30_000);
      try {
        const res = await fetch(`${API_BASE}/api/milkyway`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ timeframe, limit: 10 }),
          signal: controller.signal,
        });
        clearTimeout(timer);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        setResult(timeframe, {
          timeframe:   data.timeframe,
          scanned:     data.scanned,
          generatedAt: data.generated_at,
          setups:      data.setups ?? [],
        });
        lastFetchRef.current = now;
      } catch (e) {
        clearTimeout(timer);
        throw e;
      }
    };

    try {
      await attempt();
    } catch (firstErr) {
      // Auto-retry once (wakes Fly.io cold-start)
      try {
        await attempt();
      } catch (e) {
        setError(timeframe, String(e));
      }
    }
  }, [timeframe, results, setResult, setStatus, setError]);

  useEffect(() => {
    scan();
  }, [scan]);

  return {
    result:  results[timeframe],
    status:  status[timeframe] ?? 'idle',
    error:   error[timeframe],
    refresh: () => scan(true),
  };
}
