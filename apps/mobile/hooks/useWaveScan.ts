/**
 * hooks/useWaveScan.ts
 *
 * Triggers the remote historical wave scan and writes results to the store.
 */

import { useCallback } from 'react';
import { fetchWaveScan } from '../services/waveScanService';
import { useWaveScanStore, type WaveScanResult } from '../stores/waveScan';

export function useWaveScan() {
  const { setResult, setStatus, setError } = useWaveScanStore();

  const scan = useCallback(async (params: {
    ticker:        string;
    timeframe:     string;
    lookback_days: number;
    wave_type:     string;
  }) => {
    const key = `${params.ticker}_${params.timeframe}_${params.wave_type}`;
    setStatus(key, 'loading');
    try {
      const result = await fetchWaveScan(params) as WaveScanResult;
      result.fetchedAt = Date.now();
      setResult(key, result);
      setStatus(key, 'success');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      setError(key, msg);
      setStatus(key, 'error');
    }
  }, [setResult, setStatus, setError]);

  return { scan };
}
