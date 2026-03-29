/**
 * services/proxy/api/alert-intelligence.ts — Vercel Serverless Function
 *
 * POST /api/alert-intelligence
 *
 * Generates a one-sentence AI interpretation of an alert trigger.
 * ANTHROPIC_API_KEY is server-side only.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';

interface AlertIntelligenceRequest {
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

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  const apiKey = process.env['ANTHROPIC_API_KEY'];
  if (!apiKey) {
    // Graceful fallback: return a plain description without AI
    const b = req.body as AlertIntelligenceRequest;
    return res.status(200).json({
      interpretation: `${b?.ticker ?? 'Alert'} triggered at $${b?.triggerPrice?.toFixed(2) ?? '—'}.`,
    });
  }

  const body = req.body as AlertIntelligenceRequest;
  if (!body || !body.ticker) {
    return res.status(400).json({ error: 'Invalid request body' });
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
      return res.status(200).json({
        interpretation: `${ticker} alert triggered at $${triggerPrice.toFixed(2)}.`,
      });
    }

    interface AnthropicContent { type: string; text: string }
    interface AnthropicResponse { content: AnthropicContent[] }
    const data           = await anthropicRes.json() as AnthropicResponse;
    const interpretation = data.content?.[0]?.text?.trim()
      ?? `${ticker} alert triggered at $${triggerPrice.toFixed(2)}.`;

    return res.status(200).json({ interpretation });
  } catch {
    return res.status(200).json({
      interpretation: `${ticker} alert triggered at $${triggerPrice.toFixed(2)}.`,
    });
  }
}
