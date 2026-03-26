/**
 * hooks/useSentiment.ts
 *
 * Polls StockTwits every 5 minutes for sentiment on the given ticker.
 * Computes divergence flag: price rising (last > prev) but bullish% falling.
 */

import { useEffect, useRef } from 'react';
import { fetchStockTwitsSentiment } from '../services/stocktwits';
import { useSentimentStore } from '../stores/sentiment';
import { useMarketDataStore } from '../stores/marketData';

const POLL_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

export function useSentiment(ticker: string) {
  const { setSentiment, setLoading, setError, setDivergence } = useSentimentStore();
  const prevBullishRef = useRef<number | null>(null);
  const prevPriceRef   = useRef<number | null>(null);
  const quote          = useMarketDataStore((s) => s.quotes[ticker]);

  const fetch = async () => {
    setLoading(ticker, true);
    try {
      const result = await fetchStockTwitsSentiment(ticker);
      setSentiment(ticker, result);

      // Divergence detection: price up but sentiment down
      const currentPrice = quote?.last ?? null;
      const prevBull     = prevBullishRef.current;
      const prevPrice    = prevPriceRef.current;

      if (
        prevBull !== null &&
        prevPrice !== null &&
        currentPrice !== null
      ) {
        const priceRising     = currentPrice > prevPrice;
        const sentimentFalling = result.bullishPct < prevBull - 0.05; // >5% drop
        setDivergence(ticker, priceRising && sentimentFalling);
      }

      prevBullishRef.current = result.bullishPct;
      prevPriceRef.current   = currentPrice;
    } catch (err) {
      setError(ticker, String(err));
    }
  };

  useEffect(() => {
    void fetch();
    const interval = setInterval(() => { void fetch(); }, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticker]);
}
