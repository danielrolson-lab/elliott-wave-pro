/**
 * services/proxy/api/wave-compute.ts
 *
 * POST /api/wave-compute
 * Proxies wave-scan requests to Fly.io FastAPI.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';

const SCANNER_URL = 'https://elliott-wave-scanner.fly.dev/wave-scan';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const upstream = await fetch(SCANNER_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(req.body),
    });

    const data = await upstream.text();
    res.status(upstream.status)
      .setHeader('Content-Type', upstream.headers.get('Content-Type') ?? 'application/json')
      .send(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(503).json({ error: 'Scanner unavailable', detail: message });
  }
}
