/**
 * services/proxy/wave-stream.ts
 *
 * WebSocket bridge — emits wave_update events to API consumers.
 *
 * Event payload:
 *   {
 *     type: 'probability_change' | 'count_flip' | 'invalidation_hit' | 'target_reached'
 *     ticker: string
 *     timeframe: string
 *     data: { ... }
 *     timestamp: number
 *   }
 *
 * Auth: first message must be { type: 'auth', api_key: '...' }
 * Rate limiting: applied per connection, inherits tier from API key auth.
 *
 * NOTE: Vercel Edge does not support native WebSocket long-lived connections.
 * This is designed for deployment on Fly.io using ws + http upgrade.
 * Run: node dist/wave-stream.js
 */

import http   from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { createClient }               from '@supabase/supabase-js';

const PORT      = parseInt(process.env.PORT ?? '8081', 10);
const supabase  = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const RATE_LIMITS: Record<string, number> = {
  free: 50, pro: 5000, elite: 50000,
};

// ── Client registry ───────────────────────────────────────────────────────────

interface ConnectedClient {
  ws:         WebSocket;
  userId:     string;
  tier:       string;
  watchlist:  Set<string>;
  msgCount:   number;
  authed:     boolean;
}

const clients = new Map<WebSocket, ConnectedClient>();

// ── Auth ──────────────────────────────────────────────────────────────────────

async function authClient(apiKey: string): Promise<{ ok: boolean; userId?: string; tier?: string; error?: string }> {
  const { data, error } = await supabase
    .from('api_keys')
    .select('user_id, tier, revoked')
    .eq('key', apiKey)
    .single();

  if (error || !data) return { ok: false, error: 'Invalid API key' };
  if (data.revoked)   return { ok: false, error: 'Revoked' };
  return { ok: true, userId: data.user_id, tier: data.tier };
}

// ── Broadcast helpers ─────────────────────────────────────────────────────────

export type WaveEventType = 'probability_change' | 'count_flip' | 'invalidation_hit' | 'target_reached';

export interface WaveEvent {
  type:      WaveEventType;
  ticker:    string;
  timeframe: string;
  data:      Record<string, unknown>;
  timestamp: number;
}

export function broadcastWaveEvent(event: WaveEvent): void {
  const payload = JSON.stringify(event);
  for (const [, client] of clients) {
    if (!client.authed) continue;
    if (!client.watchlist.has(event.ticker) && !client.watchlist.has('*')) continue;
    if (client.ws.readyState !== WebSocket.OPEN) continue;
    client.ws.send(payload);
  }
}

// ── Message handler ───────────────────────────────────────────────────────────

async function handleMessage(ws: WebSocket, raw: string): Promise<void> {
  let msg: Record<string, unknown>;
  try { msg = JSON.parse(raw) as Record<string, unknown>; }
  catch { ws.send(JSON.stringify({ error: 'Invalid JSON' })); return; }

  const client = clients.get(ws)!;

  if (!client.authed) {
    if (msg.type !== 'auth' || typeof msg.api_key !== 'string') {
      ws.send(JSON.stringify({ error: 'Send { type: "auth", api_key: "..." } first' }));
      return;
    }
    const result = await authClient(msg.api_key);
    if (!result.ok) {
      ws.send(JSON.stringify({ error: result.error }));
      ws.close(4001, result.error);
      return;
    }
    client.authed  = true;
    client.userId  = result.userId!;
    client.tier    = result.tier!;
    ws.send(JSON.stringify({ type: 'auth_ok', tier: result.tier, message: 'Authenticated' }));
    return;
  }

  // Subscribe to tickers
  if (msg.type === 'subscribe') {
    const tickers = Array.isArray(msg.tickers) ? msg.tickers as string[] : [];
    for (const t of tickers) client.watchlist.add(t.toUpperCase());
    ws.send(JSON.stringify({ type: 'subscribed', tickers: [...client.watchlist] }));
    return;
  }

  if (msg.type === 'unsubscribe') {
    const tickers = Array.isArray(msg.tickers) ? msg.tickers as string[] : [];
    for (const t of tickers) client.watchlist.delete(t.toUpperCase());
    return;
  }

  if (msg.type === 'ping') {
    ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
    return;
  }
}

// ── Supabase realtime → WebSocket bridge ──────────────────────────────────────

// Listen for wave_count changes in Supabase and broadcast to connected clients
supabase
  .channel('wave_events')
  .on('postgres_changes', {
    event:  '*',
    schema: 'public',
    table:  'wave_counts',
  }, (payload) => {
    const row = payload.new as Record<string, unknown>;
    const old = payload.old as Record<string, unknown> | undefined;
    const ticker    = String(row.ticker ?? '');
    const timeframe = String(row.timeframe ?? '');
    const posterior = (row.posterior as Record<string, number> | undefined)?.posterior ?? 0;
    const oldPosterior = (old?.posterior as Record<string, number> | undefined)?.posterior ?? 0;

    if (Math.abs(posterior - oldPosterior) > 0.05) {
      broadcastWaveEvent({
        type:      'probability_change',
        ticker,
        timeframe,
        data:      { posterior, delta: posterior - oldPosterior, count_id: row.id },
        timestamp: Date.now(),
      });
    }
  })
  .subscribe();

// ── HTTP + WebSocket server ───────────────────────────────────────────────────

const server = http.createServer((_req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ status: 'ok', clients: clients.size }));
});

const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
  clients.set(ws, {
    ws,
    userId:    '',
    tier:      'free',
    watchlist: new Set(),
    msgCount:  0,
    authed:    false,
  });

  ws.send(JSON.stringify({ type: 'connected', message: 'Send auth first.' }));

  ws.on('message', (data) => {
    const client = clients.get(ws);
    if (!client) return;
    client.msgCount++;
    void handleMessage(ws, data.toString());
  });

  ws.on('close', () => { clients.delete(ws); });
  ws.on('error', ()  => { clients.delete(ws); });
});

server.listen(PORT, () => {
  console.log(`[wave-stream] WebSocket server listening on :${PORT}`);
});
