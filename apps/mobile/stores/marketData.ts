import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import type { OHLCV, Instrument, MarketRegime } from '@elliott-wave-pro/wave-engine';

export type ConnectionStatus = 'connected' | 'connecting' | 'disconnected' | 'error';

export interface Quote {
  ticker: string;
  bid: number;
  ask: number;
  last: number;
  changePercent: number;
  volume: number;
  timestamp: number;
}

export interface Level2Entry {
  price: number;
  size: number;
  exchange: string;
}

export interface OrderBook {
  ticker: string;
  bids: Level2Entry[];
  asks: Level2Entry[];
  timestamp: number;
}

export interface MarketDataState {
  // Active instrument
  activeTicker: string | null;
  activeInstrument: Instrument | null;

  // OHLCV candles keyed by `${ticker}_${timeframe}`
  candles: Record<string, OHLCV[]>;

  // Real-time quotes keyed by ticker
  quotes: Record<string, Quote>;

  // Level 2 order book keyed by ticker
  orderBooks: Record<string, OrderBook>;

  // Regime per ticker
  regimes: Record<string, MarketRegime>;

  // WebSocket connection status per feed
  connectionStatus: Record<string, ConnectionStatus>;

  // Actions
  setActiveTicker: (ticker: string, instrument: Instrument) => void;
  upsertCandles: (key: string, candles: OHLCV[]) => void;
  updateQuote: (quote: Quote) => void;
  updateOrderBook: (orderBook: OrderBook) => void;
  setRegime: (ticker: string, regime: MarketRegime) => void;
  setConnectionStatus: (feed: string, status: ConnectionStatus) => void;
  // Merge a live streaming candle into the candles array for key `${ticker}_${timeframe}`.
  // Same-timestamp → update in place; new timestamp → append (capped at 500 bars).
  updateLiveAggregate: (ticker: string, timeframe: string, candle: OHLCV) => void;
  clearTicker: (ticker: string) => void;
}

export const useMarketDataStore = create<MarketDataState>()(
  immer((set) => ({
    activeTicker: null,
    activeInstrument: null,
    candles: {},
    quotes: {},
    orderBooks: {},
    regimes: {},
    connectionStatus: {},

    setActiveTicker: (ticker, instrument) =>
      set((state) => {
        state.activeTicker = ticker;
        state.activeInstrument = instrument;
      }),

    upsertCandles: (key, newCandles) =>
      set((state) => {
        state.candles[key] = newCandles;
      }),

    updateQuote: (quote) =>
      set((state) => {
        state.quotes[quote.ticker] = quote;
      }),

    updateOrderBook: (orderBook) =>
      set((state) => {
        state.orderBooks[orderBook.ticker] = orderBook;
      }),

    setRegime: (ticker, regime) =>
      set((state) => {
        state.regimes[ticker] = regime;
      }),

    setConnectionStatus: (feed, status) =>
      set((state) => {
        state.connectionStatus[feed] = status;
      }),

    updateLiveAggregate: (ticker, timeframe, candle) =>
      set((state) => {
        const key = `${ticker}_${timeframe}`;
        const arr = state.candles[key];
        if (!arr || arr.length === 0) {
          state.candles[key] = [candle];
          return;
        }
        const last = arr[arr.length - 1];
        if (last.timestamp === candle.timestamp) {
          arr[arr.length - 1] = candle;
        } else {
          arr.push(candle);
          if (arr.length > 500) arr.splice(0, arr.length - 500);
        }
      }),

    clearTicker: (ticker) =>
      set((state) => {
        delete state.quotes[ticker];
        delete state.orderBooks[ticker];
        delete state.regimes[ticker];
        // Remove all candle keys for this ticker
        const keys = Object.keys(state.candles).filter((k) => k.startsWith(`${ticker}_`));
        for (const key of keys) {
          delete state.candles[key];
        }
      }),
  })),
);
