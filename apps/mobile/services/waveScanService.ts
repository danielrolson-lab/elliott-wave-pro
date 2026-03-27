/**
 * services/waveScanService.ts
 *
 * Client for the Fly.io FastAPI wave-scan endpoint.
 */

const WAVE_SCAN_BASE = process.env['EXPO_PUBLIC_API_BASE_URL'] ?? 'https://elliott-wave-pro-proxy.vercel.app';

export interface WaveScanRequest {
  ticker:        string;
  timeframe:     string;
  lookback_days: number;
  wave_type:     string;
}

export async function fetchWaveScan(req: WaveScanRequest): Promise<unknown> {
  const resp = await fetch(`${WAVE_SCAN_BASE}/api/wave-compute`, {
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
