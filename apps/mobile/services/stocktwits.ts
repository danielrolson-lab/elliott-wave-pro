/**
 * services/stocktwits.ts
 *
 * StockTwits public API client.
 * Endpoint: GET https://api.stocktwits.com/api/2/streams/symbol/{ticker}.json
 *
 * No auth required for public symbol stream (rate limited to ~200 req/hr per IP).
 *
 * Returns: bullish%, bearish%, message volume.
 */

export interface StockTwitsSentiment {
  ticker:       string;
  bullishPct:   number; // 0–1
  bearishPct:   number; // 0–1
  neutralPct:   number; // 0–1
  messageCount: number; // messages in response window
  fetchedAt:    number; // unix ms
}

interface RawMessage {
  entities?: {
    sentiment?: { basic: 'Bullish' | 'Bearish' } | null;
  };
}

interface StockTwitsResponse {
  messages: RawMessage[];
}

export async function fetchStockTwitsSentiment(
  ticker: string,
): Promise<StockTwitsSentiment> {
  const url = `https://api.stocktwits.com/api/2/streams/symbol/${ticker}.json`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });

  if (!res.ok) {
    throw new Error(`StockTwits error ${res.status} for ${ticker}`);
  }

  const data = await res.json() as StockTwitsResponse;
  const messages = data.messages ?? [];

  let bull = 0;
  let bear = 0;
  let neutral = 0;

  for (const msg of messages) {
    const sentiment = msg.entities?.sentiment;
    if (!sentiment) { neutral++; continue; }
    if (sentiment.basic === 'Bullish') bull++;
    else if (sentiment.basic === 'Bearish') bear++;
    else neutral++;
  }

  const total = bull + bear + neutral || 1;

  return {
    ticker,
    bullishPct:   bull / total,
    bearishPct:   bear / total,
    neutralPct:   neutral / total,
    messageCount: messages.length,
    fetchedAt:    Date.now(),
  };
}
