/**
 * useWaveAlerts.ts
 *
 * Fires local push notifications when the wave engine detects actionable
 * conditions on every new candle close:
 *
 *   - Possible wave 5 top:  price at 1.618 extension + RSI divergence
 *   - Possible wave 3 peak: price at 2.618 extension
 *   - Wave 2/4 bottom zone: price at 0.618 retrace + RSI turning up
 *   - Wave count invalidated: price crosses stop price
 *
 * Gated by `waveAlertsEnabled` in the notification store.
 * Only fires once per unique (ticker + condition + price-level) tuple.
 */

import { useEffect, useRef } from 'react';
import * as Notifications from 'expo-notifications';
import type { WaveCount, OHLCV } from '@elliott-wave-pro/wave-engine';
import { computeFibLevels } from '@elliott-wave-pro/wave-engine';
import { useNotificationStore } from '../stores/notifications';

// ── Notification setup ────────────────────────────────────────────────────────

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert:   true,
    shouldPlaySound:   false,
    shouldSetBadge:    false,
    shouldShowBanner:  true,
    shouldShowList:    true,
  }),
});

async function requestPermsIfNeeded(): Promise<boolean> {
  const { status } = await Notifications.getPermissionsAsync();
  if (status === 'granted') return true;
  const { status: newStatus } = await Notifications.requestPermissionsAsync();
  return newStatus === 'granted';
}

async function sendAlert(title: string, body: string): Promise<void> {
  const ok = await requestPermsIfNeeded();
  if (!ok) return;
  await Notifications.scheduleNotificationAsync({
    content: { title, body },
    trigger: null, // fire immediately
  });
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useWaveAlerts(
  ticker:     string,
  timeframe:  string,
  candles:    readonly OHLCV[],
  waveCounts: readonly WaveCount[],
): void {
  const enabled         = useNotificationStore((s) => s.waveAlertsEnabled);
  const prevCandleLen   = useRef(0);
  const lastAlertKey    = useRef('');

  useEffect(() => {
    if (!enabled) return;
    if (candles.length === prevCandleLen.current) return;
    prevCandleLen.current = candles.length;

    const primary = waveCounts[0];
    if (!primary) return;

    const lastCandle = candles[candles.length - 1];
    if (!lastCandle) return;
    const currentPrice = lastCandle.close;

    // ── Invalidation check ─────────────────────────────────────────────────
    if (currentPrice > 0 && primary.stopPrice > 0) {
      const isBull = (() => {
        const w1 = primary.allWaves.find((w) => w.label === '1');
        if (!w1?.endPivot) return true;
        return w1.startPivot.price < w1.endPivot.price;
      })();
      const crossed = isBull
        ? currentPrice <= primary.stopPrice
        : currentPrice >= primary.stopPrice;

      if (crossed) {
        const key = `${ticker}_invalidation_${Math.round(primary.stopPrice)}`;
        if (key !== lastAlertKey.current) {
          lastAlertKey.current = key;
          void sendAlert(
            `${ticker} — Wave Count Invalidated`,
            `Price $${currentPrice.toFixed(2)} crossed invalidation $${primary.stopPrice.toFixed(2)}`,
          );
          return;
        }
      }
    }

    // ── Fib-based condition checks ─────────────────────────────────────────
    const fibLevels = computeFibLevels(primary, currentPrice);
    if (!fibLevels.length) return;

    const rsiDivScore  = primary.posterior.likelihood_components.rsi_divergence;
    const waveLabel    = primary.currentWave.label;

    // Find nearest fib level
    let nearest = fibLevels[0];
    let minDist = Math.abs(fibLevels[0].price - currentPrice);
    for (const lv of fibLevels) {
      const d = Math.abs(lv.price - currentPrice);
      if (d < minDist) { minDist = d; nearest = lv; }
    }
    const nearPct = minDist / Math.abs(currentPrice);
    if (nearPct > 0.005) return; // must be within 0.5%

    const nearestIdx = fibLevels.indexOf(nearest);
    // fibLevels: [0..4] retracements (0.236,0.382,0.5,0.618,0.786), [5..9] extensions (1.0,1.272,1.618,2.0,2.618)
    const is0618Ret = nearestIdx === 3; // ratio 0.618 retracement
    const is1618Ext = nearestIdx === 7; // ratio 1.618 extension
    const is2618Ext = nearestIdx === 9; // ratio 2.618 extension

    let alertKey = '';
    let alertTitle = '';
    let alertBody  = '';

    if (waveLabel === '5' && is1618Ext && rsiDivScore > 0.5) {
      alertKey   = `${ticker}_w5top_${Math.round(currentPrice)}`;
      alertTitle = `${ticker} — Possible Wave 5 Top`;
      alertBody  = `$${currentPrice.toFixed(2)} at 1.618 ext | RSI divergence ⚠`;
    } else if (waveLabel === '3' && is2618Ext) {
      alertKey   = `${ticker}_w3peak_${Math.round(currentPrice)}`;
      alertTitle = `${ticker} — Wave 3 Peak Zone`;
      alertBody  = `$${currentPrice.toFixed(2)} at 2.618 ext | ${timeframe} chart`;
    } else if ((waveLabel === '2' || waveLabel === '4') && is0618Ret && rsiDivScore > 0.4) {
      alertKey   = `${ticker}_w${waveLabel}bottom_${Math.round(currentPrice)}`;
      alertTitle = `${ticker} — Wave ${waveLabel} Bottom Zone`;
      alertBody  = `$${currentPrice.toFixed(2)} at 0.618 retrace | Watch for reversal`;
    }

    if (!alertKey || alertKey === lastAlertKey.current) return;
    lastAlertKey.current = alertKey;
    void sendAlert(alertTitle, alertBody);
  }, [candles, waveCounts, enabled, ticker, timeframe]);
}
