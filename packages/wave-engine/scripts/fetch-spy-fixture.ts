/**
 * fetch-spy-fixture.ts
 *
 * Fetches real SPY 5-minute OHLCV data from Polygon REST API and saves it to
 * tests/fixtures/SPY_5m.csv.
 *
 * Usage:
 *   pnpm fetch-fixture            (from packages/wave-engine)
 *   pnpm --filter wave-engine fetch-fixture  (from repo root)
 *
 * Requires POLYGON_API_KEY in .env at the repo root.
 */

import { writeFileSync, mkdirSync } from 'fs';
import { resolve, join, dirname } from 'path';
import { config } from 'dotenv';

// ── Env ───────────────────────────────────────────────────────────────────────

const envPath = resolve(dirname(__filename), '../../../.env');
config({ path: envPath });

const API_KEY = process.env.POLYGON_API_KEY;
if (!API_KEY) {
  console.error('Error: POLYGON_API_KEY not found in .env');
  console.error(`Looked in: ${envPath}`);
  process.exit(1);
}

// ── Config ────────────────────────────────────────────────────────────────────

const TICKER   = 'SPY';
const TIMESPAN = 'minute';
const MULTIPLIER = 5;
const LIMIT    = 500;

// Fetch the last 10 trading days
const to   = new Date().toISOString().slice(0, 10);
const from = (() => {
  const d = new Date();
  d.setDate(d.getDate() - 14); // 14 calendar days → ~10 trading days
  return d.toISOString().slice(0, 10);
})();

const OUT_PATH = join(dirname(__filename), '../tests/fixtures/SPY_5m.csv');

// ── Polygon REST response shape ───────────────────────────────────────────────

interface PolygonBar {
  t: number;  // timestamp ms
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
  vw?: number;
}

interface PolygonAggResponse {
  resultsCount?: number;
  results?: PolygonBar[];
  status: string;
  error?: string;
}

// ── Fetch ─────────────────────────────────────────────────────────────────────

async function fetchBars(): Promise<PolygonBar[]> {
  const url =
    `https://api.polygon.io/v2/aggs/ticker/${TICKER}/range/${MULTIPLIER}/${TIMESPAN}/${from}/${to}` +
    `?adjusted=true&sort=asc&limit=${LIMIT}&apiKey=${API_KEY}`;

  console.log(`Fetching ${TICKER} ${MULTIPLIER}m bars: ${from} → ${to}`);
  console.log(`URL: ${url.replace(API_KEY!, '***')}\n`);

  const res  = await fetch(url);
  const data = (await res.json()) as PolygonAggResponse;

  if (data.status !== 'OK' || !data.results) {
    throw new Error(`Polygon error: ${data.error ?? data.status}`);
  }

  console.log(`Received ${data.resultsCount ?? data.results.length} bars`);
  return data.results;
}

// ── Write CSV ─────────────────────────────────────────────────────────────────

function writeCsv(bars: PolygonBar[]): void {
  mkdirSync(dirname(OUT_PATH), { recursive: true });

  const header = 'timestamp,open,high,low,close,volume';
  const rows = bars.map(
    (b) => `${b.t},${b.o},${b.h},${b.l},${b.c},${b.v}`,
  );

  writeFileSync(OUT_PATH, [header, ...rows].join('\n') + '\n', 'utf8');
  console.log(`\nSaved ${bars.length} bars → ${OUT_PATH}`);
}

// ── Main ──────────────────────────────────────────────────────────────────────

(async () => {
  try {
    const bars = await fetchBars();
    writeCsv(bars);
    process.exit(0);
  } catch (err) {
    console.error('Fetch failed:', err instanceof Error ? err.message : err);
    process.exit(1);
  }
})();
