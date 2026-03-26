/**
 * stores/sentiment.ts
 *
 * Social sentiment data per ticker from StockTwits.
 */

import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import type { StockTwitsSentiment } from '../services/stocktwits';

export interface SentimentState {
  data:    Record<string, StockTwitsSentiment>;
  loading: Record<string, boolean>;
  errors:  Record<string, string | null>;
  /** true when price is rising but sentiment is falling = distribution warning */
  divergence: Record<string, boolean>;

  setSentiment:   (ticker: string, data: StockTwitsSentiment) => void;
  setLoading:     (ticker: string, loading: boolean) => void;
  setError:       (ticker: string, error: string | null) => void;
  setDivergence:  (ticker: string, flag: boolean) => void;
}

export const useSentimentStore = create<SentimentState>()(
  immer((set) => ({
    data:       {},
    loading:    {},
    errors:     {},
    divergence: {},

    setSentiment: (ticker, sentimentData) => set((s) => {
      s.data[ticker]    = sentimentData;
      s.loading[ticker] = false;
      s.errors[ticker]  = null;
    }),

    setLoading: (ticker, loading) => set((s) => {
      s.loading[ticker] = loading;
    }),

    setError: (ticker, error) => set((s) => {
      s.errors[ticker]  = error;
      s.loading[ticker] = false;
    }),

    setDivergence: (ticker, flag) => set((s) => {
      s.divergence[ticker] = flag;
    }),
  })),
);
