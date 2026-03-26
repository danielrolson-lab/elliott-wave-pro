/**
 * useL2WebSocket.ts
 *
 * Connects to Polygon's stocks WebSocket and subscribes to:
 *   LV2.{ticker}  — Level 2 order book updates
 *   T.{ticker}    — Trade prints (for time-and-sales tape)
 *   Q.{ticker}    — NBBO quote (for Lee-Ready aggressor classification)
 *
 * The hook maintains a single WebSocket connection for the active ticker.
 * On unmount or ticker change the previous connection is cleanly closed.
 *
 * Lee-Ready aggressor classification:
 *   price >= ask → BUY aggressor
 *   price <= bid → SELL aggressor
 *   else         → UNKNOWN (midpoint print)
 *
 * Block detection: print size > 5× rolling average size of last 20 prints.
 */

import { useEffect, useRef, useCallback } from 'react';
import { useL2Store }    from '../stores/l2';
import type { L2Book, TapePrint, DepthLevel } from '../stores/l2';

const POLYGON_API_KEY  = process.env.EXPO_PUBLIC_POLYGON_API_KEY ?? '';
const WS_URL           = `wss://socket.polygon.io/stocks`;
const RECONNECT_DELAY  = 3_000;

// ── Message shapes ────────────────────────────────────────────────────────────

interface PolyAuth     { ev: 'auth_ack' | 'auth_failed' }
interface PolyStatus   { ev: 'status'; status: string; message: string }

interface PolyLV2 {
  ev:  'LV2';
  sym: string;
  b:   Array<{ p: number; s: number; x?: number }>;
  a:   Array<{ p: number; s: number; x?: number }>;
  t:   number;
}

interface PolyTrade {
  ev: 'T';
  sym: string;
  p:  number;   // price
  s:  number;   // size
  t:  number;   // timestamp ms
  x?: number;   // exchange
}

interface PolyQuote {
  ev: 'Q';
  sym: string;
  bp: number;   // bid price
  ap: number;   // ask price
  bs: number;   // bid size
  as: number;   // ask size
  t:  number;
}

type PolyMsg = PolyAuth | PolyStatus | PolyLV2 | PolyTrade | PolyQuote | { ev: string };

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useL2WebSocket(ticker: string): void {
  const setBook      = useL2Store((s) => s.setBook);
  const pushPrint    = useL2Store((s) => s.pushPrint);
  const setConnected = useL2Store((s) => s.setConnected);

  // Rolling quote for Lee-Ready
  const lastQuoteRef = useRef<{ bid: number; ask: number }>({ bid: 0, ask: 0 });
  // Rolling sizes for block detection (last 20 prints)
  const sizesRef     = useRef<number[]>([]);
  const wsRef        = useRef<WebSocket | null>(null);
  const timerRef     = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeRef    = useRef(true);

  const connect = useCallback(() => {
    if (!POLYGON_API_KEY || !activeRef.current) return;

    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    ws.onopen = () => {
      ws.send(JSON.stringify({ action: 'auth', params: POLYGON_API_KEY }));
    };

    ws.onmessage = (event: MessageEvent) => {
      let messages: PolyMsg[];
      try { messages = JSON.parse(event.data as string) as PolyMsg[]; }
      catch { return; }

      for (const msg of messages) {
        if (msg.ev === 'auth_ack') {
          setConnected(true);
          ws.send(JSON.stringify({
            action: 'subscribe',
            params: `LV2.${ticker},T.${ticker},Q.${ticker}`,
          }));
        }

        if (msg.ev === 'LV2') {
          const m = msg as PolyLV2;
          const book: L2Book = {
            ticker: m.sym,
            bids:   m.b.map((l): DepthLevel => ({ price: l.p, size: l.s }))
                       .sort((a, b) => b.price - a.price),
            asks:   m.a.map((l): DepthLevel => ({ price: l.p, size: l.s }))
                       .sort((a, b) => a.price - b.price),
            timestamp: m.t,
          };
          setBook(book);
        }

        if (msg.ev === 'Q') {
          const m = msg as PolyQuote;
          lastQuoteRef.current = { bid: m.bp, ask: m.ap };
        }

        if (msg.ev === 'T') {
          const m    = msg as PolyTrade;
          const { bid, ask } = lastQuoteRef.current;
          const aggressor =
            m.p >= ask && ask > 0 ? 'buy' :
            m.p <= bid && bid > 0 ? 'sell' : 'unknown';

          // Rolling block detection
          sizesRef.current.push(m.s);
          if (sizesRef.current.length > 20) sizesRef.current.shift();
          const avgSize = sizesRef.current.reduce((a, b) => a + b, 0) / sizesRef.current.length;
          const isBlock = m.s > avgSize * 5;

          const print: TapePrint = {
            id:        `${m.sym}_${m.t}_${m.p}`,
            ticker:    m.sym,
            price:     m.p,
            size:      m.s,
            timestamp: m.t,
            aggressor,
            isBlock,
          };
          pushPrint(print);
        }
      }
    };

    ws.onclose = () => {
      setConnected(false);
      if (activeRef.current) {
        timerRef.current = setTimeout(connect, RECONNECT_DELAY);
      }
    };

    ws.onerror = () => { ws.close(); };
  }, [ticker, setBook, pushPrint, setConnected]);

  useEffect(() => {
    activeRef.current = true;
    connect();
    return () => {
      activeRef.current = false;
      if (timerRef.current) clearTimeout(timerRef.current);
      wsRef.current?.close();
      setConnected(false);
    };
  }, [connect, setConnected]);
}
