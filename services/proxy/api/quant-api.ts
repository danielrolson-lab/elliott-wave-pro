/**
 * services/proxy/quant-api.ts
 *
 * Vercel Edge Functions — Quant API layer
 *
 * REST endpoints:
 *   GET  /api/wave-count?ticker=SPY&timeframe=5m
 *   GET  /api/scenarios?ticker=SPY&timeframe=5m
 *   GET  /api/regime?ticker=SPY
 *   GET  /api/gex?ticker=SPY
 *   GET  /api/signals?watchlist=SPY,QQQ,AAPL
 *
 * WebSocket:
 *   WSS /api/stream  → emits wave_update events
 *   Event types: probability_change | count_flip | invalidation_hit | target_reached
 *
 * Auth: API key in Authorization header — validated against Supabase api_keys table
 * Rate limiting by tier: free=50/day, pro=5000/day, elite=50000/day
 *
 * Deploy: vercel deploy (uses vercel.json edge runtime config)
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

// ── Supabase client (server-side) ─────────────────────────────────────────────

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

// ── Rate limit tiers ──────────────────────────────────────────────────────────

const RATE_LIMITS: Record<string, number> = {
  free:  50,
  pro:   5_000,
  elite: 50_000,
};

// ── Auth middleware ───────────────────────────────────────────────────────────

interface AuthResult {
  ok:     boolean;
  userId?: string;
  tier?:  'free' | 'pro' | 'elite';
  error?: string;
}

async function authenticate(req: VercelRequest): Promise<AuthResult> {
  const authHeader = req.headers['authorization'];
  if (!authHeader?.startsWith('Bearer ')) {
    return { ok: false, error: 'Missing Authorization header' };
  }
  const apiKey = authHeader.slice(7).trim();

  // Lookup API key in Supabase
  const { data, error } = await supabase
    .from('api_keys')
    .select('user_id, tier, revoked, daily_count, count_reset_at')
    .eq('key', apiKey)
    .single();

  if (error || !data) return { ok: false, error: 'Invalid API key' };
  if (data.revoked)   return { ok: false, error: 'API key revoked' };

  // Check / reset daily rate limit
  const resetAt  = new Date(data.count_reset_at ?? 0);
  const now      = new Date();
  let dailyCount = data.daily_count ?? 0;

  if (now.getUTCDate() !== resetAt.getUTCDate() || now.getUTCMonth() !== resetAt.getUTCMonth()) {
    // New day — reset counter
    dailyCount = 0;
    await supabase
      .from('api_keys')
      .update({ daily_count: 0, count_reset_at: now.toISOString() })
      .eq('key', apiKey);
  }

  const limit = RATE_LIMITS[data.tier] ?? RATE_LIMITS.free;
  if (dailyCount >= limit) {
    return { ok: false, error: `Rate limit exceeded (${limit}/day for ${data.tier} tier)` };
  }

  // Increment counter (fire-and-forget)
  void supabase
    .from('api_keys')
    .update({ daily_count: dailyCount + 1 })
    .eq('key', apiKey);

  return { ok: true, userId: data.user_id, tier: data.tier };
}

// ── Response helpers ──────────────────────────────────────────────────────────

function json(res: VercelResponse, status: number, body: unknown): void {
  res.status(status).json(body);
}

function setCORSHeaders(res: VercelResponse): void {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
}

// ── Shared signal cache helpers (Upstash Redis) ───────────────────────────────

const UPSTASH_URL   = process.env.UPSTASH_REDIS_REST_URL!;
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN!;
const CACHE_TTL_S   = 30;  // wave counts cached 30 seconds

async function cacheGet(key: string): Promise<unknown | null> {
  if (!UPSTASH_URL) return null;
  try {
    const resp = await fetch(`${UPSTASH_URL}/get/${encodeURIComponent(key)}`, {
      headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` },
    });
    const data = await resp.json() as { result?: string | null };
    return data.result ? JSON.parse(data.result) : null;
  } catch { return null; }
}

async function cacheSet(key: string, value: unknown): Promise<void> {
  if (!UPSTASH_URL) return;
  try {
    await fetch(`${UPSTASH_URL}/set/${encodeURIComponent(key)}?ex=${CACHE_TTL_S}`, {
      method:  'POST',
      headers: { Authorization: `Bearer ${UPSTASH_TOKEN}`, 'Content-Type': 'application/json' },
      body:    JSON.stringify(JSON.stringify(value)),
    });
  } catch { /* non-fatal */ }
}

// ── Wave count proxy ──────────────────────────────────────────────────────────

async function getWaveCount(ticker: string, timeframe: string) {
  const cacheKey = `wave:${ticker}:${timeframe}`;
  const cached   = await cacheGet(cacheKey);
  if (cached) return { cached: true, data: cached };

  // Pull from Supabase persisted wave counts (written by mobile app)
  const { data } = await supabase
    .from('wave_counts')
    .select('*')
    .eq('ticker', ticker)
    .eq('timeframe', timeframe)
    .order('updated_at', { ascending: false })
    .limit(4);

  await cacheSet(cacheKey, data);
  return { cached: false, data };
}

// ── Route handler ─────────────────────────────────────────────────────────────

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  setCORSHeaders(res);

  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'GET')     { json(res, 405, { error: 'Method not allowed' }); return; }

  const auth = await authenticate(req);
  if (!auth.ok) { json(res, 401, { error: auth.error }); return; }

  const path    = (req.url ?? '').split('?')[0];
  const query   = req.query as Record<string, string>;

  try {
    // GET /api/wave-count
    if (path.endsWith('/wave-count')) {
      const { ticker = 'SPY', timeframe = '5m' } = query;
      const result = await getWaveCount(ticker.toUpperCase(), timeframe);
      json(res, 200, { ticker, timeframe, ...result });
      return;
    }

    // GET /api/scenarios
    if (path.endsWith('/scenarios')) {
      const { ticker = 'SPY', timeframe = '5m' } = query;
      const cacheKey = `scenarios:${ticker}:${timeframe}`;
      const cached   = await cacheGet(cacheKey);
      if (cached) { json(res, 200, { ticker, timeframe, cached: true, data: cached }); return; }

      const { data } = await supabase
        .from('wave_counts')
        .select('id, structure, waves, posterior, updated_at')
        .eq('ticker', ticker.toUpperCase())
        .eq('timeframe', timeframe)
        .order('posterior->posterior', { ascending: false })
        .limit(4);

      await cacheSet(cacheKey, data);
      json(res, 200, { ticker, timeframe, cached: false, data });
      return;
    }

    // GET /api/regime
    if (path.endsWith('/regime')) {
      const { ticker = 'SPY' } = query;
      const { data } = await supabase
        .from('market_regimes')
        .select('*')
        .eq('ticker', ticker.toUpperCase())
        .order('updated_at', { ascending: false })
        .limit(1)
        .single();

      json(res, 200, { ticker, regime: data?.regime ?? null, updated_at: data?.updated_at ?? null });
      return;
    }

    // GET /api/gex
    if (path.endsWith('/gex')) {
      const { ticker = 'SPY' } = query;
      const cacheKey = `gex:${ticker}`;
      const cached   = await cacheGet(cacheKey);
      if (cached) { json(res, 200, { ticker, cached: true, data: cached }); return; }

      const { data } = await supabase
        .from('gex_levels')
        .select('*')
        .eq('ticker', ticker.toUpperCase())
        .order('updated_at', { ascending: false })
        .limit(1)
        .single();

      await cacheSet(cacheKey, data);
      json(res, 200, { ticker, cached: false, data });
      return;
    }

    // GET /api/signals (multi-ticker)
    if (path.endsWith('/signals')) {
      const watchlist = (query.watchlist ?? 'SPY').split(',').slice(0, 25);
      const results: Record<string, unknown> = {};

      await Promise.all(watchlist.map(async (ticker) => {
        const t = ticker.trim().toUpperCase();
        const [waveRes, regimeRes] = await Promise.all([
          getWaveCount(t, '5m'),
          supabase
            .from('market_regimes')
            .select('regime')
            .eq('ticker', t)
            .order('updated_at', { ascending: false })
            .limit(1)
            .single(),
        ]);
        results[t] = {
          wave_count: waveRes.data,
          regime:     regimeRes.data?.regime ?? null,
        };
      }));

      json(res, 200, { watchlist, signals: results });
      return;
    }

    json(res, 404, { error: 'Unknown endpoint' });
  } catch (err) {
    console.error('[quant-api]', err);
    json(res, 500, { error: 'Internal server error' });
  }
}
