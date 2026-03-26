/**
 * polygonOptions.ts
 *
 * Fetches options chain snapshot from the Polygon.io REST API.
 *
 * Endpoint:
 *   GET /v3/snapshot/options/{underlyingAsset}
 *       ?limit=250&order=asc&sort=strike_price&apiKey=…
 *
 * We request up to 250 contracts per call and auto-paginate using the
 * `next_url` cursor returned by the API until all strikes are fetched
 * (max 3 pages = 750 contracts, sufficient for GEX calculation).
 *
 * Returns only the fields needed for GEX: strike, type, gamma, openInterest.
 */

const BASE_URL = 'https://api.polygon.io';
const MAX_PAGES = 3;

// ── Types ─────────────────────────────────────────────────────────────────────

/** Minimal record used for GEX calculation (D3). */
export interface OptionRecord {
  strike:       number;
  contractType: 'call' | 'put';
  gamma:        number;
  openInterest: number;
}

/** Full record returned by fetchFullOptionsChain (D4). */
export interface FullOptionRecord {
  // Identity
  strike:       number;
  expiry:       string;   // YYYY-MM-DD
  contractType: 'call' | 'put';
  // Bid/Ask
  bid:          number;
  ask:          number;
  mid:          number;
  // Volume + OI
  volume:       number;
  openInterest: number;
  // Greeks (from Polygon)
  delta:        number;
  gamma:        number;
  theta:        number;
  vega:         number;
  // IV
  impliedVol:   number;
}

interface PolygonOptionResult {
  details?: {
    strike_price?:    number;
    contract_type?:   string;
    expiration_date?: string;
  };
  greeks?: {
    delta?: number;
    gamma?: number;
    theta?: number;
    vega?:  number;
  };
  implied_volatility?: number;
  last_quote?: {
    bid?:     number;
    ask?:     number;
    midpoint?: number;
  };
  day?: {
    volume?: number;
  };
  open_interest?: number;
}

interface PolygonSnapshotResponse {
  results?:  PolygonOptionResult[];
  next_url?: string;
  status?:   string;
}

// ── Internal paginator ────────────────────────────────────────────────────────

async function paginateFetch(
  initialUrl: string,
  signal:     AbortSignal | undefined,
  onPage:     (results: PolygonOptionResult[]) => void,
): Promise<void> {
  let url = initialUrl;
  let page = 0;

  while (url && page < MAX_PAGES) {
    const res = await fetch(url, { signal });

    if (!res.ok) {
      throw new Error(`Polygon options API error ${res.status}: ${res.statusText}`);
    }

    const json = (await res.json()) as PolygonSnapshotResponse;

    if (json.status === 'ERROR') {
      throw new Error(`Polygon options API error: ${JSON.stringify(json)}`);
    }

    onPage(json.results ?? []);

    url = json.next_url ?? '';
    page++;
  }
}

// ── Fetch (GEX — minimal, D3) ─────────────────────────────────────────────────

/**
 * Fetches the near-term options chain and returns only the fields needed for
 * GEX calculation (strike, type, gamma, open interest).
 */
export async function fetchOptionsChain(
  ticker:  string,
  apiKey:  string,
  signal?: AbortSignal,
): Promise<OptionRecord[]> {
  const records: OptionRecord[] = [];

  const initialUrl =
    `${BASE_URL}/v3/snapshot/options/${encodeURIComponent(ticker)}` +
    `?limit=250&order=asc&sort=strike_price&apiKey=${apiKey}`;

  await paginateFetch(initialUrl, signal, (results) => {
    for (const item of results) {
      const strike       = item.details?.strike_price;
      const contractType = item.details?.contract_type;
      const gamma        = item.greeks?.gamma;
      const oi           = item.open_interest;

      if (
        strike == null ||
        (contractType !== 'call' && contractType !== 'put') ||
        gamma == null ||
        oi == null
      ) continue;

      records.push({
        strike,
        contractType: contractType as 'call' | 'put',
        gamma,
        openInterest: oi,
      });
    }
  });

  return records;
}

// ── Fetch (Full chain — D4) ───────────────────────────────────────────────────

/**
 * Fetches the full options chain with all Greeks, bid/ask, IV, and expiry.
 * Used for the options chain view and IV surface.
 */
export async function fetchFullOptionsChain(
  ticker:  string,
  apiKey:  string,
  signal?: AbortSignal,
): Promise<FullOptionRecord[]> {
  const records: FullOptionRecord[] = [];

  const initialUrl =
    `${BASE_URL}/v3/snapshot/options/${encodeURIComponent(ticker)}` +
    `?limit=250&order=asc&sort=strike_price&apiKey=${apiKey}`;

  await paginateFetch(initialUrl, signal, (results) => {
    for (const item of results) {
      const strike       = item.details?.strike_price;
      const contractType = item.details?.contract_type;
      const expiry       = item.details?.expiration_date;
      const gamma        = item.greeks?.gamma;
      const delta        = item.greeks?.delta;
      const theta        = item.greeks?.theta;
      const vega         = item.greeks?.vega;
      const iv           = item.implied_volatility;
      const oi           = item.open_interest;

      // All identity + greek fields required
      if (
        strike == null || expiry == null ||
        (contractType !== 'call' && contractType !== 'put') ||
        gamma == null || delta == null || theta == null ||
        vega == null || iv == null || oi == null
      ) continue;

      const bid = item.last_quote?.bid ?? 0;
      const ask = item.last_quote?.ask ?? 0;
      const mid = item.last_quote?.midpoint ?? (bid + ask) / 2;

      records.push({
        strike,
        expiry,
        contractType: contractType as 'call' | 'put',
        bid,
        ask,
        mid,
        volume:       item.day?.volume ?? 0,
        openInterest: oi,
        delta,
        gamma,
        theta,
        vega,
        impliedVol:   iv,
      });
    }
  });

  return records;
}
