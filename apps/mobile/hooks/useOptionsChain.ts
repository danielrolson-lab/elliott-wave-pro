/**
 * useOptionsChain.ts
 *
 * Fetches the full options chain for a ticker, computes derived fields
 * (Vanna, Charm, moneyness, Max Pain, term structure, skew, IV Rank),
 * and writes everything to the options store.
 *
 * Re-fetches automatically when `ticker` changes.
 * Returns `refresh()` for pull-to-refresh.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchFullOptionsChain }    from '../services/polygonOptions';
import {
  computeVanna,
  computeCharm,
  classifyMoneyness,
  computeMaxPain,
  atmIV,
  computeIVRank,
  computeSkewStats,
} from '../utils/optionsGreeks';
import type { SkewPoint } from '../stores/options';
import { useOptionsStore }          from '../stores/options';
import { useMarketDataStore }       from '../stores/marketData';

const POLYGON_API_KEY = process.env.EXPO_PUBLIC_POLYGON_API_KEY ?? '';

export type OptionsStatus = 'idle' | 'loading' | 'success' | 'error';

export interface UseOptionsChainResult {
  status:  OptionsStatus;
  error:   string | null;
  refresh: () => void;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function daysUntil(expiryISO: string): number {
  const now    = Date.now();
  const expiry = new Date(expiryISO).getTime();
  return Math.max(0, Math.round((expiry - now) / 86_400_000));
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useOptionsChain(ticker: string): UseOptionsChainResult {
  const store = useOptionsStore.getState;   // imperative access to avoid re-render cascade

  const setRows           = useOptionsStore((s) => s.setRows);
  const setExpiries       = useOptionsStore((s) => s.setExpiries);
  const setSelectedExpiry = useOptionsStore((s) => s.setSelectedExpiry);
  const setTermStructure  = useOptionsStore((s) => s.setTermStructure);
  const setSkew           = useOptionsStore((s) => s.setSkew);
  const setMaxPain        = useOptionsStore((s) => s.setMaxPain);
  const setMaxGammaStrike = useOptionsStore((s) => s.setMaxGammaStrike);
  const setIVRank         = useOptionsStore((s) => s.setIVRank);
  const appendIVHistory   = useOptionsStore((s) => s.appendIVHistory);

  const [status, setStatus] = useState<OptionsStatus>('idle');
  const [error,  setError]  = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Read spot from the 5m candle store (last close)
  const spot = useMarketDataStore((s) => {
    const candles = s.candles[`${ticker}_5m`];
    return candles && candles.length > 0 ? candles[candles.length - 1].close : 0;
  });

  const run = useCallback(async () => {
    if (!POLYGON_API_KEY) {
      setStatus('error');
      setError('EXPO_PUBLIC_POLYGON_API_KEY not configured');
      return;
    }

    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    setStatus('loading');
    setError(null);

    try {
      const raw = await fetchFullOptionsChain(ticker, POLYGON_API_KEY, ctrl.signal);
      if (ctrl.signal.aborted) return;

      // ── Enrich each record ─────────────────────────────────────────────────
      type EnrichedRow = import('../stores/options').OptionRow;
      const enriched: EnrichedRow[] = raw.map((r) => {
        const dte      = daysUntil(r.expiry);
        const vanna    = computeVanna(spot, r.strike, r.impliedVol, dte);
        const charm    = computeCharm(spot, r.strike, r.impliedVol, dte, r.contractType);
        const moneyness = classifyMoneyness(r.strike, spot, r.contractType);
        return {
          ...r,
          dte,
          vanna,
          charm,
          moneyness,
        };
      });

      // ── Group by expiry ────────────────────────────────────────────────────
      const byExpiry = new Map<string, EnrichedRow[]>();
      for (const row of enriched) {
        let arr = byExpiry.get(row.expiry);
        if (!arr) { arr = []; byExpiry.set(row.expiry, arr); }
        arr.push(row);
      }

      // Write per-expiry rows to the store
      const expiries = Array.from(byExpiry.keys()).sort();
      for (const [expiry, rows] of byExpiry) {
        setRows(`${ticker}_${expiry}`, rows);
      }

      setExpiries(ticker, expiries);

      // Set default selected expiry = nearest non-expired expiry
      const current = store().selectedExpiry[ticker];
      if (!current && expiries.length > 0) {
        setSelectedExpiry(ticker, expiries[0]);
      }

      // ── Term structure: ATM IV per expiry ──────────────────────────────────
      const termStructure = expiries.map((expiry) => {
        const rows = byExpiry.get(expiry) ?? [];
        const dte  = daysUntil(expiry);
        const iv   = atmIV(rows, spot);
        return { expiry, dte, atmIV: iv };
      }).filter((p) => p.dte > 0 && p.atmIV > 0);

      setTermStructure(ticker, termStructure);

      // ── Append current near-term ATM IV to history (for IV Rank) ──────────
      if (termStructure.length > 0) {
        const nearestIV = termStructure[0].atmIV;
        appendIVHistory(ticker, nearestIV);
        const history = store().ivHistory[ticker] ?? [];
        const rank = computeIVRank(nearestIV, history);
        setIVRank(ticker, rank);
      }

      // ── Max Pain (across all expiries, or nearest only) ────────────────────
      const maxPainStrike = computeMaxPain(enriched);
      setMaxPain(ticker, maxPainStrike);

      // ── Max Gamma strike ───────────────────────────────────────────────────
      const maxGammaRow = enriched.reduce<EnrichedRow | null>(
        (best, r) => (!best || r.gamma > best.gamma ? r : best),
        null,
      );
      if (maxGammaRow) setMaxGammaStrike(ticker, maxGammaRow.strike);

      // ── Skew for currently selected expiry ─────────────────────────────────
      const selectedExpiry = expiries[0] ?? '';
      const selectedRows   = byExpiry.get(selectedExpiry) ?? [];
      const skewStats      = computeSkewStats(selectedRows);

      if (skewStats && selectedRows.length > 0) {
        // Build delta→IV curve from calls (delta 0.05 → 0.95)
        const callRows = selectedRows
          .filter((r) => r.contractType === 'call' && r.delta > 0.05 && r.delta < 0.95)
          .sort((a, b) => a.delta - b.delta);

        const points: SkewPoint[] = callRows.map((r) => ({
          delta:      r.delta,
          impliedVol: r.impliedVol,
        }));

        setSkew(ticker, {
          expiry: selectedExpiry,
          riskReversal25d: skewStats.riskReversal25d,
          butterfly25d:    skewStats.butterfly25d,
          points,
        });
      } else {
        setSkew(ticker, null);
      }

      setStatus('success');
    } catch (err: unknown) {
      if (ctrl.signal.aborted) return;
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      setStatus('error');
    }
  }, [
    ticker, spot,
    setRows, setExpiries, setSelectedExpiry, setTermStructure,
    setSkew, setMaxPain, setMaxGammaStrike, setIVRank, appendIVHistory, store,
  ]);

  useEffect(() => {
    void run();
    return () => { abortRef.current?.abort(); };
  }, [run]);

  return { status, error, refresh: run };
}
