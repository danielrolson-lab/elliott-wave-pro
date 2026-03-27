/**
 * services/alertIntelligenceService.ts
 *
 * Client for the /api/alert-intelligence Vercel Edge Function.
 * Sends alert context and returns a one-sentence AI interpretation.
 */

const ALERT_INTELLIGENCE_URL =
  `${process.env['EXPO_PUBLIC_API_BASE_URL'] ?? 'https://elliott-wave-pro-proxy.vercel.app'}/api/alert-intelligence`;

export interface AlertContext {
  ticker:         string;
  alertType:      string;
  triggerPrice:   number;
  currentPrice?:  number | null;
  waveLabel?:     string | null;
  waveStructure?: string | null;
  regime?:        string | null;
  gexLevel?:      string | null;
  probability?:   number | null;
  alertNote?:     string | null;
}

export async function fetchAlertInterpretation(ctx: AlertContext): Promise<string> {
  try {
    const res = await fetch(ALERT_INTELLIGENCE_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(ctx),
    });

    if (!res.ok) return `${ctx.ticker} alert triggered at $${ctx.triggerPrice.toFixed(2)}.`;

    interface AlertResponse { interpretation: string }
    const data = await res.json() as AlertResponse;
    return data.interpretation ?? `${ctx.ticker} alert triggered.`;
  } catch {
    return `${ctx.ticker} alert triggered at $${ctx.triggerPrice.toFixed(2)}.`;
  }
}
