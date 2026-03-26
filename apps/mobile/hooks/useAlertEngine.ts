/**
 * useAlertEngine.ts
 *
 * Evaluates all active compound alerts on every state change.
 * When ALL conditions in an alert are satisfied, the alert is marked triggered
 * and delivered via the configured channels.
 *
 * Condition evaluation is AND-gated across all conditions[].
 * Each AlertCondition may itself have additionalConditions[] for nested AND.
 *
 * Runs on a 5-second polling interval (not per-render) to avoid thrashing.
 */

import { useEffect, useRef } from 'react';
import { useAlertsStore, type AlertCondition } from '../stores/alerts';
import { useMarketDataStore }  from '../stores/marketData';
import { useWaveCountStore }   from '../stores/waveCount';
import { useIndicatorStore }   from '../stores/indicators';
import { useGEXStore }         from '../stores/gex';
import { useOptionsStore }     from '../stores/options';
import { deliverAlert }        from '../services/alertDelivery';
import { fetchAlertInterpretation } from '../services/alertIntelligenceService';
import { useAlertDetailStore } from '../stores/alertDetail';

const POLL_MS = 5_000;

// ── Condition evaluator ───────────────────────────────────────────────────────

function evalCondition(
  cond: AlertCondition,
  ctx:  EvalContext,
): boolean {
  const { quotes, regimes, counts, indicators, gex, options } = ctx;

  // Resolve current quote for ticker
  const quote   = quotes[cond.ticker];
  const price   = quote?.last ?? 0;
  const regime  = regimes[cond.ticker] ?? null;
  const rsiKey  = `${cond.ticker}_5m`;
  const rsiSeries = indicators.rsi[rsiKey];
  const rsi     = rsiSeries ? rsiSeries.values[rsiSeries.values.length - 1] ?? 50 : 50;
  const ivRank  = options.ivRank[cond.ticker] ?? 0;
  const gexLevel = gex.levels[cond.ticker];
  const primaryCount = counts[`${cond.ticker}_5m`]?.[0] ?? null;

  switch (cond.type) {
    case 'price_above':
      return price >= cond.value;

    case 'price_below':
      return price <= cond.value;

    case 'price_cross':
      // Crossing detected when price is within 0.1% of threshold
      return Math.abs(price - cond.value) / cond.value < 0.001;

    case 'wave_scenario_probability':
      return (primaryCount?.posterior.posterior ?? 0) >= cond.value;

    case 'wave_label_reached':
      return primaryCount?.currentWave.label === String(cond.value);

    case 'scenario_flip': {
      // Triggers when the primary wave label index changes (new scenario)
      const label = primaryCount?.currentWave.label;
      return label !== undefined && label !== cond.waveCountId;
    }

    case 'iv_rank_above':
      return ivRank >= cond.value;

    case 'iv_rank_below':
      return ivRank <= cond.value;

    case 'rsi_above':
      return rsi >= cond.value;

    case 'rsi_below':
      return rsi <= cond.value;

    case 'regime_change':
      return regime !== null && regime === cond.targetRegime;

    case 'gex_regime_change': {
      // Triggers when price is near (within 0.5%) of GEX Zero level (gamma flip)
      if (!gexLevel?.zeroGex || !price) return false;
      return Math.abs(price - gexLevel.zeroGex) / price < 0.005;
    }

    case 'volume_spike':
      // Not evaluated here — covered by TimeAndSales block detection
      return false;

    default:
      return false;
  }
}

interface EvalContext {
  quotes:     ReturnType<typeof useMarketDataStore.getState>['quotes'];
  regimes:    ReturnType<typeof useMarketDataStore.getState>['regimes'];
  counts:     ReturnType<typeof useWaveCountStore.getState>['counts'];
  indicators: ReturnType<typeof useIndicatorStore.getState>;
  gex:        ReturnType<typeof useGEXStore.getState>;
  options:    { ivRank: Record<string, number> };
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useAlertEngine(): void {
  const markTriggered = useAlertsStore((s) => s.markTriggered);
  const timerRef      = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    timerRef.current = setInterval(() => {
      const alertsState = useAlertsStore.getState();
      const active      = alertsState.alerts.filter((a) => a.status === 'active');
      if (active.length === 0) return;

      const marketState    = useMarketDataStore.getState();
      const waveState      = useWaveCountStore.getState();
      const indicatorState = useIndicatorStore.getState();
      const gexState       = useGEXStore.getState();
      const optState       = useOptionsStore.getState();

      const ctx: EvalContext = {
        quotes:     marketState.quotes,
        regimes:    marketState.regimes,
        counts:     waveState.counts,
        indicators: indicatorState,
        gex:        gexState,
        options: { ivRank: optState.ivRank },
      };

      for (const alert of active) {
        const allMet = alert.conditions.every((cond) => {
          const primaryMet = evalCondition(cond, ctx);
          if (!primaryMet) return false;
          if (!cond.additionalConditions?.length) return true;
          return cond.additionalConditions.every((sub) => evalCondition(sub, ctx));
        });

        if (allMet) {
          markTriggered(alert.id);
          const firstCond  = alert.conditions[0];
          const ticker     = firstCond?.ticker ?? '';
          const firstPrice = ctx.quotes[ticker]?.last ?? firstCond?.value ?? 0;
          const primaryCount = ctx.counts[`${ticker}_5m`]?.[0] ?? null;
          const regime     = ctx.regimes[ticker] ?? null;

          // Fetch AI interpretation (non-blocking)
          fetchAlertInterpretation({
            ticker,
            alertType:    firstCond?.type ?? 'price_cross',
            triggerPrice: firstCond?.value ?? firstPrice,
            currentPrice: firstPrice,
            waveLabel:    primaryCount?.currentWave?.label != null
              ? String(primaryCount.currentWave.label)
              : null,
            waveStructure: primaryCount?.currentWave?.structure ?? null,
            regime,
            gexLevel:     ctx.gex.levels[ticker]?.zeroGex
              ? `Zero GEX at $${ctx.gex.levels[ticker]!.zeroGex!.toFixed(2)}`
              : null,
            probability:  primaryCount?.posterior?.posterior ?? null,
            alertNote:    alert.label,
          }).then((interpretation) => {
            // Store context snapshot for alert-detail screen
            useAlertDetailStore.getState().addDetail({
              alertId:       alert.id,
              label:         alert.label,
              ticker,
              interpretation,
              triggeredAt:   Date.now(),
              triggerPrice:  firstPrice,
              waveLabel:     primaryCount?.currentWave?.label != null
                ? String(primaryCount.currentWave.label)
                : null,
              regime,
              probability:   primaryCount?.posterior?.posterior ?? null,
            });

            const message = interpretation;
            deliverAlert(alert, { ticker, message }).catch((e) =>
              console.warn('[useAlertEngine] delivery failed', e),
            );
          }).catch(() => {
            const message = buildMessage(alert.label, alert.conditions);
            deliverAlert(alert, { ticker, message }).catch((e) =>
              console.warn('[useAlertEngine] delivery failed', e),
            );
          });
        }
      }
    }, POLL_MS);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [markTriggered]);
}

// ── Message builder ───────────────────────────────────────────────────────────

function buildMessage(label: string, conditions: AlertCondition[]): string {
  const parts = conditions.map((c) => {
    switch (c.type) {
      case 'price_above':      return `${c.ticker} price ≥ $${c.value.toFixed(2)}`;
      case 'price_below':      return `${c.ticker} price ≤ $${c.value.toFixed(2)}`;
      case 'price_cross':      return `${c.ticker} crossed $${c.value.toFixed(2)}`;
      case 'rsi_above':        return `${c.ticker} RSI ≥ ${c.value}`;
      case 'rsi_below':        return `${c.ticker} RSI ≤ ${c.value}`;
      case 'iv_rank_above':    return `${c.ticker} IV Rank ≥ ${c.value}%`;
      case 'iv_rank_below':    return `${c.ticker} IV Rank ≤ ${c.value}%`;
      case 'regime_change':    return `${c.ticker} regime → ${c.targetRegime ?? ''}`;
      case 'gex_regime_change':return `${c.ticker} near GEX Zero`;
      case 'scenario_flip':    return `${c.ticker} wave scenario changed`;
      case 'wave_scenario_probability':
        return `${c.ticker} primary probability ≥ ${Math.round(c.value * 100)}%`;
      default:                 return c.type;
    }
  });
  return `${label}: ${parts.join(' AND ')}`;
}
