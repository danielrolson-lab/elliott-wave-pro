/**
 * stores/l2.ts
 *
 * Zustand store for Level 2 order book depth and time-and-sales tape.
 * Written by useL2WebSocket; read by DepthLadder and TimeAndSales.
 */

import { create }  from 'zustand';
import { immer }   from 'zustand/middleware/immer';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface DepthLevel {
  price:     number;
  size:      number;
  exchange?: string;
}

export type TapeAggressor = 'buy' | 'sell' | 'unknown';

export interface TapePrint {
  id:         string;    // `${ticker}_${timestamp}_${price}`
  ticker:     string;
  price:      number;
  size:       number;
  timestamp:  number;    // unix ms
  aggressor:  TapeAggressor;
  isBlock:    boolean;   // size > 5× avg size
  exchange?:  string;
}

export interface L2Book {
  ticker:    string;
  bids:      DepthLevel[];   // sorted desc by price
  asks:      DepthLevel[];   // sorted asc  by price
  timestamp: number;
}

// ── State ─────────────────────────────────────────────────────────────────────

const MAX_TAPE = 50;

interface L2State {
  books:      Record<string, L2Book>;
  tape:       TapePrint[];       // ring buffer, newest first
  connected:  boolean;

  setBook(book: L2Book): void;
  pushPrint(print: TapePrint): void;
  setConnected(v: boolean): void;
  clearTicker(ticker: string): void;
}

export const useL2Store = create<L2State>()(
  immer((set) => ({
    books:     {},
    tape:      [],
    connected: false,

    setBook(book) {
      set((s) => {
        // Keep top 10 each side
        s.books[book.ticker] = {
          ...book,
          bids: book.bids.slice(0, 10),
          asks: book.asks.slice(0, 10),
        };
      });
    },

    pushPrint(print) {
      set((s) => {
        s.tape.unshift(print);
        if (s.tape.length > MAX_TAPE) s.tape.length = MAX_TAPE;
      });
    },

    setConnected(v) {
      set((s) => { s.connected = v; });
    },

    clearTicker(ticker) {
      set((s) => { delete s.books[ticker]; });
    },
  })),
);

// ── Selector: imbalance ratio (best 3 bid size / best 3 ask size) ─────────────

export function bidAskImbalance(book: L2Book): number {
  const bidSize = book.bids.slice(0, 3).reduce((s, l) => s + l.size, 0);
  const askSize = book.asks.slice(0, 3).reduce((s, l) => s + l.size, 0);
  if (askSize === 0) return 2;
  return bidSize / askSize;
}
