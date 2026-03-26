/**
 * services/waveScanService.ts
 *
 * Client for the Fly.io FastAPI wave-scan endpoint.
 */

const WAVE_SCAN_BASE = process.env.EXPO_PUBLIC_WAVE_SCAN_URL ?? 'https://elliott-wave-scanner.fly.dev';

export interface WaveScanRequest {
  ticker:        string;
  timeframe:     string;
  lookback_days: number;
  wave_type:     string;
}

export async function fetchWaveScan(req: WaveScanRequest): Promise<unknown> {
  const resp = await fetch(`${WAVE_SCAN_BASE}/wave-scan`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(req),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Wave scan failed (${resp.status}): ${text}`);
  }
  return resp.json();
}
