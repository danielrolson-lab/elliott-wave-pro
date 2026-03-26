/**
 * ws-proxy.ts — Polygon.io WebSocket Bridge
 *
 * Architecture:
 *   Mobile App  ──WS──►  this proxy  ──WS──►  wss://socket.polygon.io/stocks
 *
 * Why a proxy?
 *   • POLYGON_API_KEY never leaves the server — not exposed in mobile bundle
 *   • Single place to add rate-limiting, auth token validation, logging
 *   • Swap data vendors without touching the mobile app
 *
 * Deployment:
 *   Vercel does not support truly persistent WebSocket servers in its
 *   serverless/edge runtimes (max 300s execution).  For production:
 *     • Deploy to Fly.io  (`fly launch`)  — co-located with FastAPI service
 *     • OR use Vercel custom server pattern (Next.js pages/api with `ws`)
 *   For local dev: `pnpm start` in this directory
 *
 * Client contract:
 *   • Connect to ws://localhost:3001 (dev) or wss://<host>/api/ws (prod)
 *   • Send only { action: "subscribe"|"unsubscribe", params: "A.SPY,Q.SPY" }
 *   • Never send auth — the proxy injects it transparently
 *   • Receive raw Polygon JSON arrays unchanged
 */

import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { config } from 'dotenv';
import { resolve } from 'path';

// Load .env from repo root (two levels up from services/proxy/)
config({ path: resolve(__dirname, '../../.env') });

// ─── Config ───────────────────────────────────────────────────────────────────

const PORT = parseInt(process.env.PORT ?? '3001', 10);
const POLYGON_WS_URL = 'wss://socket.polygon.io/stocks';
const POLYGON_API_KEY = process.env.POLYGON_API_KEY;

if (!POLYGON_API_KEY) {
  console.error('[ws-proxy] FATAL: POLYGON_API_KEY is not set');
  process.exit(1);
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface PolygonStatusMessage {
  ev: 'status';
  status: string;
  message: string;
}

interface ProxyAction {
  action: string;
  params?: string;
}

// ─── HTTP + WebSocket server ──────────────────────────────────────────────────

const httpServer = http.createServer((_req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ status: 'ok', service: 'elliott-wave-ws-proxy', ts: Date.now() }));
});

const wss = new WebSocketServer({ server: httpServer });

wss.on('connection', (clientWs, req) => {
  const clientId = `${req.socket.remoteAddress ?? 'unknown'}:${req.socket.remotePort ?? 0}`;
  console.log(`[ws-proxy] ▶ Client connected  ${clientId}`);

  // Messages the client sent before Polygon auth completed
  const pendingClientMessages: string[] = [];
  let polygonAuthenticated = false;

  // ── Open upstream connection to Polygon ──────────────────────────────────
  const polygonWs = new WebSocket(POLYGON_WS_URL, {
    headers: { 'User-Agent': 'elliott-wave-pro-proxy/1.0' },
  });

  polygonWs.on('open', () => {
    console.log(`[ws-proxy] ↑ Polygon upstream open — sending auth`);
    // Inject API key — client never sees it
    polygonWs.send(JSON.stringify({ action: 'auth', params: POLYGON_API_KEY }));
  });

  polygonWs.on('message', (rawData) => {
    const raw = rawData.toString();

    // Intercept auth_success to flush pending messages
    try {
      const msgs = JSON.parse(raw) as PolygonStatusMessage[];
      for (const msg of msgs) {
        if (msg.ev === 'status' && msg.status === 'auth_success') {
          polygonAuthenticated = true;
          console.log(`[ws-proxy] ✓ Polygon auth_success — flushing ${pendingClientMessages.length} pending messages`);
          for (const pending of pendingClientMessages) {
            if (polygonWs.readyState === WebSocket.OPEN) polygonWs.send(pending);
          }
          pendingClientMessages.length = 0;
        }
      }
    } catch {
      // Non-JSON upstream message — pass through
    }

    // Forward everything to the client unchanged
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.send(raw);
    }
  });

  polygonWs.on('error', (err) => {
    console.error(`[ws-proxy] ✗ Polygon upstream error: ${err.message}`);
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.close(1011, 'Upstream connection error');
    }
  });

  polygonWs.on('close', (code) => {
    console.log(`[ws-proxy] ↓ Polygon upstream closed (${code})`);
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.close(1001, 'Upstream closed');
    }
  });

  // ── Client → Polygon bridge ───────────────────────────────────────────────
  clientWs.on('message', (rawData) => {
    const raw = rawData.toString();

    let action: ProxyAction;
    try {
      action = JSON.parse(raw) as ProxyAction;
    } catch {
      console.warn(`[ws-proxy] ⚠ Malformed message from ${clientId}`);
      return;
    }

    // Security: never allow a client to override authentication
    if (action.action === 'auth') {
      console.warn(`[ws-proxy] ⛔ Blocked auth attempt from ${clientId}`);
      return;
    }

    // Only allow subscribe/unsubscribe
    if (action.action !== 'subscribe' && action.action !== 'unsubscribe') {
      console.warn(`[ws-proxy] ⚠ Unknown action "${action.action}" from ${clientId} — dropped`);
      return;
    }

    if (!polygonAuthenticated) {
      pendingClientMessages.push(raw);
    } else if (polygonWs.readyState === WebSocket.OPEN) {
      polygonWs.send(raw);
    }
  });

  clientWs.on('close', (code) => {
    console.log(`[ws-proxy] ◀ Client disconnected  ${clientId} (${code})`);
    if (polygonWs.readyState !== WebSocket.CLOSED) {
      polygonWs.close(1000, 'Client disconnected');
    }
  });

  clientWs.on('error', (err) => {
    console.error(`[ws-proxy] ✗ Client error (${clientId}): ${err.message}`);
    if (polygonWs.readyState !== WebSocket.CLOSED) {
      polygonWs.close();
    }
  });
});

// ─── Start ────────────────────────────────────────────────────────────────────

httpServer.listen(PORT, () => {
  console.log('');
  console.log('┌─────────────────────────────────────────────────┐');
  console.log('│  Elliott Wave Pro — Polygon.io WebSocket Proxy  │');
  console.log('├─────────────────────────────────────────────────┤');
  console.log(`│  Listening:  ws://localhost:${PORT}                │`);
  console.log(`│  Upstream:   ${POLYGON_WS_URL}  │`);
  console.log('│  API key:    *** (server-side only)              │');
  console.log('└─────────────────────────────────────────────────┘');
  console.log('');
});

export default httpServer;
