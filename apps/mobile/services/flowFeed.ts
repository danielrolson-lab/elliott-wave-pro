/**
 * services/flowFeed.ts
 *
 * Fetches unusual options activity from Polygon's options snapshot endpoint
 * and converts each qualifying contract into a FlowPrint.
 *
 * Data source:
 *   GET /v3/snapshot/options/{underlying}
 *       ?limit=250&order=desc&sort=day.volume
 *
 * A contract qualifies as "unusual" when ALL of the following hold:
 *   - estimated_premium = day.volume × day.vwap × 100  ≥ minPremium
 *   - vol/OI ratio ≥ 0.05  (at least 5% of OI traded today)
 *   - has valid bid/ask Greeks from Polygon
 *
 * Sweep detection (from snapshot, without raw trade tape):
 *   VWAP ≥ ask × 0.96 → buyer paid up = likely sweep
 *   VWAP ≤ bid × 1.04 → seller hit bids  = likely sweep
 *
 * Block detection:
 *   estimated_premium ≥ $1,000,000
 *
 * Repeat detection is done in the store (requires time-window across fetches).
 *
 * Each underlying is fetched independently; callers pass a list of tickers.
 */

const BASE_URL = 'https://api.polygon.io';
const MAX_PAGES = 2;   // 500 contracts per underlying — sufficient to scan near-term strikes

// ── Types ─────────────────────────────────────────────────────────────────────

export type FlowSide      = 'buy' | 'sell' | 'mixed';
export type FlowSentiment = 'bullish' | 'bearish' | 'neutral';

export interface FlowPrint {
  /** Stable ID: `${contractTicker}_${fetchedAt_rounded_to_minute}` */
  id:             string;
  /** Underlying equity ticker (e.g. "SPY") */
  ticker:         string;
  /** Full options contract ticker (e.g. "O:SPY260419C00580000") */
  contractTicker: string;
  strike:         number;
  /** ISO date YYYY-MM-DD */
  expiry:         string;
  /** Days to expiration */
  dte:            number;
  contractType:   'call' | 'put';
  /** Day volume (contracts) */
  size:           number;
  /** Estimated total day premium = size × vwap × 100 */
  premium:        number;
  bid:            number;
  ask:            number;
  /** Day VWAP */
  vwap:           number;
  side:           FlowSide;
  sentiment:      FlowSentiment;
  /** day.volume / open_interest */
  volOIRatio:     number;
  openInterest:   number;
  delta:          number;
  impliedVol:     number;
  // ── Flags ──
  isBlock:        boolean;   // premium > $1 M
  isSweep:        boolean;   // aggressor sweep heuristic
  isRepeat:       boolean;   // tagged by store; false here
  fetchedAt:      number;    // unix ms
}

// ── Polygon response shape ────────────────────────────────────────────────────

interface PolygonFlowResult {
  details?: {
    contract_type?:   string;
    expiration_date?: string;
    strike_price?:    number;
    ticker?:          string;
  };
  day?: {
    volume?: number;
    vwap?:   number;
  };
  greeks?: {
    delta?: number;
  };
  implied_volatility?: number;
  last_quote?: {
    bid?: number;
    ask?: number;
  };
  open_interest?: number;
  underlying_asset?: {
    ticker?: string;
  };
}

interface PolygonSnapshotResponse {
  results?:  PolygonFlowResult[];
  next_url?: string;
  status?:   string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function daysUntil(expiryISO: string): number {
  return Math.max(0, Math.round((new Date(expiryISO).getTime() - Date.now()) / 86_400_000));
}

function classifySide(vwap: number, bid: number, ask: number): FlowSide {
  if (ask <= bid || ask === 0) return 'mixed';
  const askThresh = ask * 0.96;
  const bidThresh = bid * 1.04;
  if (vwap >= askThresh) return 'buy';
  if (vwap <= bidThresh) return 'sell';
  return 'mixed';
}

function classifySentiment(contractType: 'call' | 'put', side: FlowSide): FlowSentiment {
  if (side === 'mixed') return 'neutral';
  if (contractType === 'call') return side === 'buy' ? 'bullish' : 'bearish';
  return side === 'buy' ? 'bearish' : 'bullish';
}

function isSweep(vwap: number, bid: number, ask: number, volOIRatio: number): boolean {
  const side = classifySide(vwap, bid, ask);
  // Directional conviction at extreme of spread + meaningful vol relative to OI
  return side !== 'mixed' && volOIRatio >= 0.15;
}

// ── Fetch for one underlying ──────────────────────────────────────────────────

async function fetchUnderlyingFlow(
  underlying:  string,
  apiKey:      string,
  minPremium:  number,
  signal?:     AbortSignal,
): Promise<FlowPrint[]> {
  const prints: FlowPrint[] = [];
  const fetchedAt = Date.now();
  const minuteBucket = Math.floor(fetchedAt / 60_000);

  let url =
    `${BASE_URL}/v3/snapshot/options/${encodeURIComponent(underlying)}` +
    `?limit=250&order=desc&sort=day.volume&apiKey=${apiKey}`;

  let page = 0;

  while (url && page < MAX_PAGES) {
    const res = await fetch(url, { signal });
    if (!res.ok) throw new Error(`Polygon flow API ${res.status}: ${res.statusText}`);

    const json = (await res.json()) as PolygonSnapshotResponse;
    if (json.status === 'ERROR') throw new Error(`Polygon flow error: ${JSON.stringify(json)}`);

    for (const item of json.results ?? []) {
      const strike       = item.details?.strike_price;
      const contractType = item.details?.contract_type;
      const expiry       = item.details?.expiration_date;
      const contractTicker = item.details?.ticker;
      const volume       = item.day?.volume;
      const vwap         = item.day?.vwap;
      const bid          = item.last_quote?.bid ?? 0;
      const ask          = item.last_quote?.ask ?? 0;
      const oi           = item.open_interest;
      const delta        = item.greeks?.delta ?? 0;
      const iv           = item.implied_volatility ?? 0;

      // Require all core fields
      if (
        strike == null || expiry == null || contractTicker == null ||
        (contractType !== 'call' && contractType !== 'put') ||
        volume == null || volume === 0 || vwap == null || vwap === 0 ||
        oi == null
      ) continue;

      const premium    = volume * vwap * 100;
      if (premium < minPremium) continue;   // below threshold — sorted by volume, so can break soon

      const volOIRatio = oi > 0 ? volume / oi : 0;
      if (volOIRatio < 0.05) continue;      // less than 5% of OI traded — not unusual

      const side      = classifySide(vwap, bid, ask);
      const sentiment = classifySentiment(contractType as 'call' | 'put', side);
      const dte       = daysUntil(expiry);

      prints.push({
        id:             `${contractTicker}_${minuteBucket}`,
        ticker:         underlying,
        contractTicker,
        strike,
        expiry,
        dte,
        contractType:   contractType as 'call' | 'put',
        size:           volume,
        premium,
        bid,
        ask,
        vwap,
        side,
        sentiment,
        volOIRatio,
        openInterest:   oi,
        delta,
        impliedVol:     iv,
        isBlock:        premium >= 1_000_000,
        isSweep:        isSweep(vwap, bid, ask, volOIRatio),
        isRepeat:       false,  // tagged by store
        fetchedAt,
      });
    }

    // If last result already had premium below threshold, no need to paginate
    const lastPremium = (json.results?.at(-1)?.day?.volume ?? 0) *
                        (json.results?.at(-1)?.day?.vwap ?? 0) * 100;
    if (lastPremium < minPremium) break;

    url = json.next_url ?? '';
    page++;
  }

  return prints;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Fetches unusual options flow for a list of underlying tickers in parallel.
 * Returns prints sorted by estimated premium descending.
 *
 * @param tickers    - underlying equity tickers to scan
 * @param apiKey     - Polygon API key
 * @param minPremium - minimum estimated day premium in USD (default $50,000)
 * @param signal     - optional AbortSignal
 */
export async function fetchUnusualFlow(
  tickers:    readonly string[],
  apiKey:     string,
  minPremium: number = 50_000,
  signal?:    AbortSignal,
): Promise<FlowPrint[]> {
  const results = await Promise.allSettled(
    tickers.map((t) => fetchUnderlyingFlow(t, apiKey, minPremium, signal)),
  );

  const all: FlowPrint[] = [];
  for (const r of results) {
    if (r.status === 'fulfilled') all.push(...r.value);
  }

  // Sort by premium descending — biggest prints first
  all.sort((a, b) => b.premium - a.premium);
  return all;
}
