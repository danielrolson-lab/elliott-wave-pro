/**
 * usePolygonWebSocket
 *
 * Single multiplexed WebSocket connection to the Vercel ws-proxy, which
 * bridges to wss://socket.polygon.io/stocks.  One connection per app session
 * shared across all consumers — spec: "one WS per exchange feed, not per ticker".
 *
 * Usage:
 *   const { addTicker, removeTicker, connectionStatus } = usePolygonWebSocket();
 *   addTicker('SPY');   // subscribes A.SPY, Q.SPY, T.SPY
 *   removeTicker('SPY');
 *
 * State updates go directly to the Zustand marketData store — no local setState.
 * Reconnects with exponential backoff: 1 → 2 → 4 → 8 → 16 → 30 s (max).
 * Env var: EXPO_PUBLIC_WS_PROXY_URL must point to the deployed proxy.
 */

import { useCallback, useEffect } from 'react';
import { useMarketDataStore } from '../stores/marketData';
import type { ConnectionStatus } from '../stores/marketData';
import type { OHLCV } from '@elliott-wave-pro/wave-engine';

// ─── Constants ────────────────────────────────────────────────────────────────

const FEED_KEY = 'polygon-stocks';

// Backoff delays in ms: 1 s, 2 s, 4 s, 8 s, 16 s, 30 s (max)
const BACKOFF_DELAYS_MS: readonly number[] = [1_000, 2_000, 4_000, 8_000, 16_000, 30_000];

// Channels to subscribe for each ticker
const CHANNELS: readonly string[] = ['A', 'AM', 'Q', 'T'];

// ─── Polygon message types ────────────────────────────────────────────────────

interface PolygonAggregate {
  ev: 'A' | 'AM';
  sym: string;
  v: number;    // volume for this bar
  o: number;    // open
  c: number;    // close
  h: number;    // high
  l: number;    // low
  vw: number;   // VWAP
  s: number;    // bar start timestamp ms
  e: number;    // bar end timestamp ms
  av?: number;  // accumulated daily volume
}

interface PolygonQuote {
  ev: 'Q';
  sym: string;
  bp: number;   // bid price
  bs: number;   // bid size
  ap: number;   // ask price
  as: number;   // ask size
  t: number;    // timestamp ms
}

interface PolygonTrade {
  ev: 'T';
  sym: string;
  p: number;    // trade price
  s: number;    // trade size
  t: number;    // timestamp ms
}

interface PolygonStatus {
  ev: 'status';
  status: string;
  message: string;
}

type PolygonMessage = PolygonAggregate | PolygonQuote | PolygonTrade | PolygonStatus;

// ─── Module-level singleton ───────────────────────────────────────────────────
// One connection is shared across all hook instances in the process.

let _socket: WebSocket | null = null;
let _backoffIndex = 0;
let _reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let _intentionallyClosed = false;
const _subscribedTickers = new Set<string>();

// ─── Store dispatch ───────────────────────────────────────────────────────────

function dispatchMessages(messages: PolygonMessage[]): void {
  const store = useMarketDataStore.getState();

  for (const msg of messages) {
    switch (msg.ev) {
      case 'A':
      case 'AM': {
        const timeframe = msg.ev === 'AM' ? '1m' : '1s';
        const candle: OHLCV = {
          timestamp: msg.s,
          open: msg.o,
          high: msg.h,
          low: msg.l,
          close: msg.c,
          volume: msg.v,
          vwap: msg.vw,
        };

        store.updateLiveAggregate(msg.sym, timeframe, candle);

        // Keep quote.last in sync with the latest close
        const prev = store.quotes[msg.sym];
        store.updateQuote({
          ticker: msg.sym,
          bid: prev?.bid ?? msg.c,
          ask: prev?.ask ?? msg.c,
          last: msg.c,
          changePercent: prev?.changePercent ?? 0,
          volume: msg.av ?? msg.v,
          timestamp: msg.e,
        });
        break;
      }

      case 'Q': {
        const prev = store.quotes[msg.sym];
        store.updateQuote({
          ticker: msg.sym,
          bid: msg.bp,
          ask: msg.ap,
          last: prev?.last ?? msg.bp,
          changePercent: prev?.changePercent ?? 0,
          volume: prev?.volume ?? 0,
          timestamp: msg.t,
        });
        break;
      }

      case 'T': {
        const prev = store.quotes[msg.sym];
        store.updateQuote({
          ticker: msg.sym,
          bid: prev?.bid ?? msg.p,
          ask: prev?.ask ?? msg.p,
          last: msg.p,
          changePercent: prev?.changePercent ?? 0,
          volume: (prev?.volume ?? 0) + msg.s,
          timestamp: msg.t,
        });
        break;
      }

      case 'status':
        // Auth and subscription confirmations — log only in dev
        if (__DEV__) {
          console.log(`[usePolygonWebSocket] Polygon status: ${msg.status} — ${msg.message}`);
        }
        break;

      default:
        break;
    }
  }
}

// ─── Send helpers ─────────────────────────────────────────────────────────────

function sendRaw(payload: object): void {
  if (_socket?.readyState === WebSocket.OPEN) {
    _socket.send(JSON.stringify(payload));
  }
}

function buildParams(tickers: string[]): string {
  return CHANNELS.flatMap((ch) => tickers.map((t) => `${ch}.${t}`)).join(',');
}

function sendSubscribe(tickers: string[]): void {
  if (tickers.length > 0) sendRaw({ action: 'subscribe', params: buildParams(tickers) });
}

function sendUnsubscribe(tickers: string[]): void {
  if (tickers.length > 0) sendRaw({ action: 'unsubscribe', params: buildParams(tickers) });
}

// ─── Connection lifecycle ─────────────────────────────────────────────────────

function scheduleReconnect(): void {
  const delay = BACKOFF_DELAYS_MS[Math.min(_backoffIndex, BACKOFF_DELAYS_MS.length - 1)];
  _backoffIndex = Math.min(_backoffIndex + 1, BACKOFF_DELAYS_MS.length - 1);

  if (__DEV__) {
    console.log(`[usePolygonWebSocket] Reconnecting in ${delay / 1_000}s (attempt ${_backoffIndex})`);
  }

  _reconnectTimer = setTimeout(initConnection, delay);
}

function initConnection(): void {
  if (_intentionallyClosed) return;

  const proxyUrl = process.env.EXPO_PUBLIC_WS_PROXY_URL;
  if (!proxyUrl) {
    console.error('[usePolygonWebSocket] EXPO_PUBLIC_WS_PROXY_URL is not set');
    useMarketDataStore.getState().setConnectionStatus(FEED_KEY, 'error');
    return;
  }

  useMarketDataStore.getState().setConnectionStatus(FEED_KEY, 'connecting');

  const ws = new WebSocket(proxyUrl);
  _socket = ws;

  ws.onopen = () => {
    if (__DEV__) console.log('[usePolygonWebSocket] Connected to proxy');
    _backoffIndex = 0;
    useMarketDataStore.getState().setConnectionStatus(FEED_KEY, 'connected');

    // Re-subscribe to all tickers that were active before reconnect
    const tickers = Array.from(_subscribedTickers);
    if (tickers.length > 0) sendSubscribe(tickers);
  };

  ws.onmessage = (event) => {
    try {
      const messages = JSON.parse(event.data as string) as PolygonMessage[];
      dispatchMessages(messages);
    } catch {
      // Malformed message — ignore silently
    }
  };

  ws.onerror = () => {
    console.error('[usePolygonWebSocket] WebSocket error');
    useMarketDataStore.getState().setConnectionStatus(FEED_KEY, 'error');
  };

  ws.onclose = (event) => {
    _socket = null;
    if (__DEV__) console.warn(`[usePolygonWebSocket] Closed (${event.code}: ${event.reason})`);
    useMarketDataStore.getState().setConnectionStatus(FEED_KEY, 'disconnected');
    if (!_intentionallyClosed) scheduleReconnect();
  };
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export interface UsePolygonWebSocketReturn {
  /** Subscribe to A.*, Q.*, T.* channels for this symbol. Idempotent. */
  addTicker: (symbol: string) => void;
  /** Unsubscribe from all channels for this symbol. Idempotent. */
  removeTicker: (symbol: string) => void;
  /** Live connection status reflected from Zustand store. */
  connectionStatus: ConnectionStatus;
}

export function usePolygonWebSocket(): UsePolygonWebSocketReturn {
  useEffect(() => {
    _intentionallyClosed = false;
    // Boot connection once; subsequent hook instances share it
    if (_socket === null && _reconnectTimer === null) {
      initConnection();
    }

    // Do NOT close on unmount — connection is app-wide.
    // Call disconnectPolygon() explicitly on logout or app background.
  }, []);

  const addTicker = useCallback((symbol: string) => {
    if (!_subscribedTickers.has(symbol)) {
      _subscribedTickers.add(symbol);
      sendSubscribe([symbol]);
    }
  }, []);

  const removeTicker = useCallback((symbol: string) => {
    if (_subscribedTickers.has(symbol)) {
      _subscribedTickers.delete(symbol);
      sendUnsubscribe([symbol]);
    }
  }, []);

  const connectionStatus = useMarketDataStore(
    (state) => state.connectionStatus[FEED_KEY] ?? 'disconnected',
  );

  return { addTicker, removeTicker, connectionStatus };
}

// ─── Explicit teardown ────────────────────────────────────────────────────────

/** Call on app logout or when the feed is no longer needed. */
export function disconnectPolygon(): void {
  _intentionallyClosed = true;
  if (_reconnectTimer !== null) {
    clearTimeout(_reconnectTimer);
    _reconnectTimer = null;
  }
  _socket?.close(1000, 'Intentional disconnect');
  _socket = null;
  _subscribedTickers.clear();
  useMarketDataStore.getState().setConnectionStatus(FEED_KEY, 'disconnected');
}
