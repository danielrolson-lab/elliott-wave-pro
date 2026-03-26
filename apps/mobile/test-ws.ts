/**
 * test-ws.ts — Live Polygon WebSocket verification
 *
 * Starts the local ws-proxy, connects to it as a client, subscribes to SPY,
 * and demonstrates aggregates flowing into the Zustand store.
 *
 * Usage (from repo root):
 *   pnpm test:ws
 *
 * Requires POLYGON_API_KEY in .env at repo root.
 * Runs for 30 seconds then prints final store state and exits.
 */

// Node.js WebSocket client (not the RN global — this is a script)
import WebSocket from 'ws';
import { config } from 'dotenv';
import { resolve } from 'path';
import { spawn } from 'child_process';

config({ path: resolve(__dirname, '../../.env') });

// ─── Validate env ─────────────────────────────────────────────────────────────

if (!process.env.POLYGON_API_KEY) {
  console.error('\n  Error: POLYGON_API_KEY not found in .env\n');
  process.exit(1);
}

// ─── Import Zustand store directly (no React needed) ─────────────────────────

import { useMarketDataStore } from './stores/marketData';

// ─── Config ───────────────────────────────────────────────────────────────────

const PROXY_PORT = 3001;
const PROXY_URL = `ws://localhost:${PROXY_PORT}`;
const TARGET_TICKER = 'SPY';
const DURATION_MS = 30_000;
const PROXY_STARTUP_DELAY_MS = 1_500;

// ─── Message counters ─────────────────────────────────────────────────────────

let aggCount = 0;
let quoteCount = 0;
let tradeCount = 0;
let statusCount = 0;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(n: number | undefined, decimals = 2): string {
  if (n === undefined) return 'N/A';
  return `$${n.toFixed(decimals)}`;
}

function printDivider(char = '─', width = 62): void {
  console.log(char.repeat(width));
}

// ─── Start proxy server as a child process ────────────────────────────────────

console.log('');
printDivider('═');
console.log('  Elliott Wave Pro — Polygon WebSocket Live Test');
printDivider('═');
console.log(`  Target:   ${TARGET_TICKER}`);
console.log(`  Duration: ${DURATION_MS / 1_000}s`);
console.log(`  Proxy:    ${PROXY_URL}`);
printDivider();
console.log('');

const proxyProcess = spawn(
  'npx',
  ['tsx', resolve(__dirname, '../../services/proxy/ws-proxy.ts')],
  {
    env: { ...process.env },
    stdio: ['ignore', 'pipe', 'pipe'],
  },
);

proxyProcess.stdout.on('data', (d: Buffer) => process.stdout.write(`[proxy] ${d.toString()}`));
proxyProcess.stderr.on('data', (d: Buffer) => process.stderr.write(`[proxy] ${d.toString()}`));

// ─── Connect once proxy has had time to boot ─────────────────────────────────

setTimeout(() => {
  const client = new WebSocket(PROXY_URL);

  client.on('open', () => {
    console.log('[test]  ▶ Connected to proxy');
    console.log(`[test]  ↑ Subscribing to ${TARGET_TICKER}...\n`);
    client.send(JSON.stringify({
      action: 'subscribe',
      params: `A.${TARGET_TICKER},AM.${TARGET_TICKER},Q.${TARGET_TICKER},T.${TARGET_TICKER}`,
    }));
  });

  client.on('message', (rawData: WebSocket.RawData) => {
    const raw = rawData.toString();

    interface RawMsg { ev?: string; [key: string]: unknown }
    let messages: RawMsg[];
    try {
      messages = JSON.parse(raw) as RawMsg[];
    } catch {
      return;
    }

    for (const msg of messages) {
      const ev = msg.ev as string | undefined;
      if (!ev) continue;

      const store = useMarketDataStore.getState();
      const sym = (msg.sym as string | undefined) ?? TARGET_TICKER;

      if (ev === 'status') {
        statusCount++;
        const status = msg.status as string;
        const message = msg.message as string;
        console.log(`[status] ${status}: ${message}`);
        continue;
      }

      if (ev === 'A' || ev === 'AM') {
        aggCount++;
        const timeframe = ev === 'AM' ? '1m' : '1s';
        const candle = {
          timestamp: msg.s as number,
          open: msg.o as number,
          high: msg.h as number,
          low: msg.l as number,
          close: msg.c as number,
          volume: msg.v as number,
          vwap: msg.vw as number | undefined,
        };

        // ─ Write directly into Zustand store ─
        store.updateLiveAggregate(sym, timeframe, candle);
        const prev = store.quotes[sym];
        store.updateQuote({
          ticker: sym,
          bid: prev?.bid ?? candle.close,
          ask: prev?.ask ?? candle.close,
          last: candle.close,
          changePercent: prev?.changePercent ?? 0,
          volume: (msg.av as number | undefined) ?? candle.volume,
          timestamp: msg.e as number,
        });

        // ─ Log store state after write ─
        const afterState = useMarketDataStore.getState();
        const key = `${sym}_${timeframe}`;
        const barCount = afterState.candles[key]?.length ?? 0;

        console.log(
          `[${ev.padEnd(2)}] ${sym} | close: ${fmt(candle.close)} | vol: ${candle.volume.toLocaleString().padStart(10)} | store[${key}]: ${barCount} bars`,
        );

      } else if (ev === 'Q') {
        quoteCount++;
        const prev = store.quotes[sym];
        store.updateQuote({
          ticker: sym,
          bid: msg.bp as number,
          ask: msg.ap as number,
          last: prev?.last ?? (msg.bp as number),
          changePercent: prev?.changePercent ?? 0,
          volume: prev?.volume ?? 0,
          timestamp: msg.t as number,
        });
        // Log every 50th quote to avoid flooding
        if (quoteCount % 50 === 0) {
          const q = useMarketDataStore.getState().quotes[sym];
          console.log(`[Q ] ${sym} | bid: ${fmt(q?.bid)} | ask: ${fmt(q?.ask)} | (${quoteCount} quotes so far)`);
        }

      } else if (ev === 'T') {
        tradeCount++;
        const prev = store.quotes[sym];
        store.updateQuote({
          ticker: sym,
          bid: prev?.bid ?? (msg.p as number),
          ask: prev?.ask ?? (msg.p as number),
          last: msg.p as number,
          changePercent: prev?.changePercent ?? 0,
          volume: (prev?.volume ?? 0) + (msg.s as number),
          timestamp: msg.t as number,
        });
        // Log every 100th trade
        if (tradeCount % 100 === 0) {
          console.log(`[T ] ${sym} | last: ${fmt(msg.p as number)} | (${tradeCount} trades so far)`);
        }
      }
    }
  });

  client.on('error', (err: Error) => {
    console.error(`[test]  ✗ Client error: ${err.message}`);
  });

  client.on('close', (code: number) => {
    console.log(`\n[test]  ◀ Client disconnected (${code})`);
  });

  // ─── Print summary and exit ────────────────────────────────────────────────

  setTimeout(() => {
    client.close();

    const state = useMarketDataStore.getState();
    const quote = state.quotes[TARGET_TICKER];
    const candles1s = state.candles[`${TARGET_TICKER}_1s`] ?? [];
    const candles1m = state.candles[`${TARGET_TICKER}_1m`] ?? [];

    console.log('');
    printDivider('═');
    console.log('  FINAL ZUSTAND STORE STATE');
    printDivider('═');
    console.log(`\n  ${TARGET_TICKER} Quote:`);
    console.log(`    last:         ${fmt(quote?.last)}`);
    console.log(`    bid:          ${fmt(quote?.bid)}`);
    console.log(`    ask:          ${fmt(quote?.ask)}`);
    console.log(`    volume:       ${quote?.volume?.toLocaleString() ?? 'N/A'}`);
    console.log(`    changePercent:${quote?.changePercent?.toFixed(2) ?? 'N/A'}%`);
    console.log(`\n  Candles in store:`);
    console.log(`    ${TARGET_TICKER}_1s  ${candles1s.length} bars`);
    console.log(`    ${TARGET_TICKER}_1m  ${candles1m.length} bars`);
    if (candles1s.length > 0) {
      const last = candles1s[candles1s.length - 1];
      console.log(`    Last 1s bar: open=${fmt(last.open)} high=${fmt(last.high)} low=${fmt(last.low)} close=${fmt(last.close)}`);
    }
    console.log(`\n  Messages received:`);
    console.log(`    Aggregates (A/AM): ${aggCount}`);
    console.log(`    Quotes (Q):        ${quoteCount}`);
    console.log(`    Trades (T):        ${tradeCount}`);
    console.log(`    Status:            ${statusCount}`);
    printDivider('═');
    console.log('');

    proxyProcess.kill();
    process.exit(0);
  }, DURATION_MS);

}, PROXY_STARTUP_DELAY_MS);

proxyProcess.on('exit', (code) => {
  if (code !== null && code !== 0) {
    console.error(`[proxy] Process exited with code ${code}`);
    process.exit(1);
  }
});
