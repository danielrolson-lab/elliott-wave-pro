import type { VercelRequest, VercelResponse } from '@vercel/node';

const BACKEND = 'https://elliott-wave-scanner.fly.dev';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    return res.status(200).end();
  }

  try {
    const upstream = await fetch(`${BACKEND}/milkyway/scan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body),
    });
    const data = await upstream.json();
    res.setHeader('Access-Control-Allow-Origin', '*');
    return res.status(upstream.status).json(data);
  } catch (e) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    return res.status(502).json({ error: 'Proxy error', detail: String(e) });
  }
}
