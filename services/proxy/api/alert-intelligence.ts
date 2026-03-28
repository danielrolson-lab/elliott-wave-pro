/**
 * services/proxy/alert-intelligence.ts — Vercel Edge Function
 *
 * POST /api/alert-intelligence
 *
 * Generates a one-sentence AI interpretation of an alert trigger.
 * ANTHROPIC_API_KEY is server-side only.
 *
 * Request body:
 *   { ticker, alertType, triggerPrice, currentPrice, waveLabel,
 *     waveStructure, regime, gexLevel, probability, alertNote? }
 *
 * Response:
 *   { interpretation: string }
 */

export const config = { runtime: 'edge' };

interface AlertIntelligenceRequest {
  ticker:        string;
  alertType:     string;  // 'price_cross' | 'wave_flip' | 'gex_change' | etc.
  triggerPrice:  number;
  currentPrice?: number | null;
  waveLabel?:    string | null;
  waveStructure?: string | null;
  regime?:       string | null;
  gexLevel?:     string | null;
  probability?:  number | null;
  alertNote?:    string | null;
}

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  const apiKey = process.env['ANTHROPIC_API_KEY'];
  if (!apiKey) {
    return new Response(
      JSON.stringify({ interpretation: 'Alert triggered.' }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  }

  let body: AlertIntelligenceRequest;
  try {
    body = await req.json() as AlertIntelligenceRequest;
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400 });
  }

  const {
    ticker, alertType, triggerPrice, currentPrice,
    waveLabel, waveStructure, regime, gexLevel, probability, alertNote,
  } = body;

  const prompt = `You are an institutional Elliott Wave analyst. Write exactly ONE sentence (max 25 words) interpreting this alert trigger for a professional trader.

Alert details:
- Ticker: ${ticker}
- Alert type: ${alertType}
- Trigger price: $${triggerPrice.toFixed(2)}
- Current price: ${currentPrice ? `$${currentPrice.toFixed(2)}` : 'unknown'}
- Active wave: ${waveLabel ? `Wave ${waveLabel}${waveStructure ? ` (${waveStructure})` : ''}` : 'unknown'}
- Market regime: ${regime ?? 'unknown'}
- GEX level: ${gexLevel ?? 'neutral'}
- Wave probability: ${probability !== null && probability !== undefined ? `${Math.round(probability * 100)}%` : 'unknown'}
${alertNote ? `- Note: ${alertNote}` : ''}

Write one specific, actionable sentence explaining the significance of this alert. Reference the wave and regime. No disclaimers.`;

  try {
    const anthropicRes = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: {
        'x-api-key':         apiKey,
        'anthropic-version': '2023-06-01',
        'content-type':      'application/json',
      },
      body: JSON.stringify({
        model:      'claude-sonnet-4-20250514',
        max_tokens: 100,
        messages:   [{ role: 'user', content: prompt }],
      }),
    });

    if (!anthropicRes.ok) {
      return new Response(
        JSON.stringify({ interpretation: `${ticker} alert triggered at $${triggerPrice.toFixed(2)}.` }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }

    interface AnthropicContent { type: string; text: string }
    interface AnthropicResponse { content: AnthropicContent[] }
    const data       = await anthropicRes.json() as AnthropicResponse;
    const interpretation = data.content?.[0]?.text?.trim() ?? `Alert triggered at $${triggerPrice.toFixed(2)}.`;

    return new Response(JSON.stringify({ interpretation }), {
      status: 200,
      headers: {
        'Content-Type':                'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch {
    return new Response(
      JSON.stringify({ interpretation: `${ticker} alert triggered at $${triggerPrice.toFixed(2)}.` }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  }
}
