/**
 * services/proxy/wave-compute.ts — Vercel Edge Function
 *
 * POST /api/wave-compute
 *
 * Proxies historical wave-scan requests to the Fly.io FastAPI service at
 * https://elliott-wave-scanner.fly.dev/wave-scan.
 *
 * Routing through this proxy means:
 *   • The mobile client only needs EXPO_PUBLIC_API_BASE_URL — one env var
 *     for all backend calls.
 *   • The Fly.io URL is never hardcoded in the mobile bundle.
 *   • We can swap the scanner host without a mobile app update.
 *
 * Request body (forwarded unchanged):
 *   { ticker, timeframe, lookback_days, wave_type }
 *
 * Response (forwarded unchanged):
 *   FastAPI JSON response from /wave-scan
 */

export const config = { runtime: 'edge' };

const SCANNER_URL = 'https://elliott-wave-scanner.fly.dev/wave-scan';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json', ...CORS },
    });
  }

  let body: string;
  try {
    body = await req.text();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid request body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', ...CORS },
    });
  }

  try {
    const upstream = await fetch(SCANNER_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });

    const responseBody = await upstream.text();

    return new Response(responseBody, {
      status:  upstream.status,
      headers: {
        'Content-Type': upstream.headers.get('Content-Type') ?? 'application/json',
        ...CORS,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return new Response(JSON.stringify({ error: 'Scanner unavailable', detail: message }), {
      status: 503,
      headers: { 'Content-Type': 'application/json', ...CORS },
    });
  }
}
