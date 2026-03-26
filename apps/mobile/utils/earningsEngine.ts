/**
 * utils/earningsEngine.ts
 *
 * Earnings volatility calculations:
 *   - Implied earnings move (from straddle price)
 *   - Historical earnings move distribution
 *   - IV crush estimator (post-earnings IV drop)
 *   - Options strategy suggestion based on IV rank + wave count
 */

export interface EarningsEvent {
  ticker:            string;
  report_date:       string;      // ISO date
  report_time:       'before_open' | 'after_close' | 'during_market';
  eps_estimate:      number | null;
  eps_actual:        number | null;
  revenue_estimate:  number | null;
  revenue_actual:    number | null;
  surprise_pct:      number | null;  // actual vs estimate %
}

export interface HistoricalEarningsMove {
  date:           string;
  price_before:   number;
  price_after:    number;
  move_pct:       number;         // abs % change next day
  direction:      'up' | 'down';
}

export interface EarningsAnalysis {
  ticker:              string;
  next_event:          EarningsEvent | null;
  days_to_earnings:    number | null;
  implied_move_pct:    number | null;    // from ATM straddle / spot
  historical_moves:    HistoricalEarningsMove[];
  avg_historical_move: number;
  implied_vs_hist_ratio: number | null; // >1 = IV expensive, <1 = IV cheap
  iv_rank:             number;           // 0–100
  iv_crush_estimate:   number | null;    // expected IV% drop post-earnings (absolute pts)
  suggested_strategy:  string;
  strategy_rationale:  string;
}

// ── Strategy selection ────────────────────────────────────────────────────────

export function selectStrategy(params: {
  iv_rank:              number;
  iv_vs_hist:           number | null;   // implied / historical ratio
  wave_label:           string | null;
  wave_structure:       string | null;
}): { strategy: string; rationale: string } {
  const { iv_rank, iv_vs_hist, wave_label, wave_structure } = params;

  // High IV rank → sell premium strategies
  if (iv_rank > 70) {
    if (iv_vs_hist !== null && iv_vs_hist > 1.3) {
      return {
        strategy: 'Iron Condor',
        rationale: `IV Rank ${iv_rank} — IV pricing ${Math.round((iv_vs_hist - 1) * 100)}% above historical. Sell the vol crush with an iron condor.`,
      };
    }
    return {
      strategy: 'Short Strangle',
      rationale: `IV Rank ${iv_rank} — elevated vol. Sell strangle outside 1-sigma expected move.`,
    };
  }

  // Low IV rank → buy premium
  if (iv_rank < 25) {
    const isTrending = wave_label === '3' || wave_label === '5' || wave_label === 'C';
    if (isTrending && wave_structure === 'impulse') {
      return {
        strategy: 'Long Call / Call Debit Spread',
        rationale: `IV Rank ${iv_rank} — cheap options. Wave ${wave_label} (impulse) suggests directional long bias.`,
      };
    }
    return {
      strategy: 'Long Straddle',
      rationale: `IV Rank ${iv_rank} — options are cheap. Straddle captures a large move in either direction.`,
    };
  }

  // Mid IV
  const isDirectional = ['3', '5', 'A', 'C'].includes(wave_label ?? '');
  if (isDirectional) {
    const direction = wave_label === 'A' || wave_label === 'C' ? 'bearish' : 'bullish';
    return {
      strategy: direction === 'bullish' ? 'Bull Call Spread' : 'Bear Put Spread',
      rationale: `IV Rank ${iv_rank} — neutral vol. Wave ${wave_label} (${wave_structure}) suggests ${direction} directional play.`,
    };
  }

  return {
    strategy: 'Calendar Spread',
    rationale: `IV Rank ${iv_rank} — flat vol. Calendar exploits term structure difference near earnings.`,
  };
}

// ── IV crush estimate ─────────────────────────────────────────────────────────

export function estimateIVCrush(params: {
  current_iv:    number;    // ATM IV as decimal (e.g. 0.45 = 45%)
  historical_iv: number[];  // post-earnings IVs from prior events
}): number | null {
  const { current_iv, historical_iv } = params;
  if (historical_iv.length === 0) return null;
  const avgPostIV = historical_iv.reduce((a, b) => a + b, 0) / historical_iv.length;
  const crush     = (current_iv - avgPostIV) * 100;  // percentage points
  return Math.round(crush * 10) / 10;
}

// ── Days to earnings ──────────────────────────────────────────────────────────

export function daysToEarnings(reportDate: string | null | undefined): number | null {
  if (!reportDate) return null;
  const diff = new Date(reportDate).getTime() - Date.now();
  if (diff < 0) return null;
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}
