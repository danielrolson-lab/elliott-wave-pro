# Elliott Wave Pro — Quant API Reference

Base URL: `https://elliott-wave-pro.vercel.app/api`

All endpoints require an API key header:
```
Authorization: Bearer <api_key>
```

API keys are stored in the Supabase `api_keys` table.
Rate limits: **free** 50 req/day · **pro** 5,000 req/day · **elite** 50,000 req/day

---

## GET /wave-count

Returns the current primary wave count for a ticker.

**Query params:**
- `ticker` (required) — e.g. `SPY`
- `timeframe` (optional) — default `5m`

**Response:**
```json
{
  "ticker": "SPY",
  "timeframe": "5m",
  "wave_label": "3",
  "structure": "impulse",
  "posterior": 0.74,
  "target": 598.50,
  "stop": 572.10,
  "cached": true,
  "cache_age_seconds": 18
}
```

---

## GET /scenarios

Returns all 4 ranked wave count scenarios.

**Query params:**
- `ticker` (required)
- `timeframe` (optional)

**Response:**
```json
{
  "ticker": "SPY",
  "scenarios": [
    {
      "rank": 0,
      "wave_label": "3",
      "structure": "impulse",
      "posterior": 0.74,
      "targets": [598.50, 605.00, 615.00],
      "stop": 572.10,
      "mtf_conflict": false
    },
    { "rank": 1, "wave_label": "B", "structure": "corrective", "posterior": 0.18, ... }
  ]
}
```

---

## GET /regime

Returns the current market regime classification.

**Query params:**
- `ticker` (required)

**Regime values:**
`STRONG_TREND_UP` | `WEAK_TREND_UP` | `STRONG_TREND_DOWN` | `WEAK_TREND_DOWN` | `HIGH_VOL_CHOP` | `LOW_VOL_COMPRESSION`

**Response:**
```json
{
  "ticker": "SPY",
  "regime": "STRONG_TREND_UP",
  "ema_alignment": "bullish",
  "atr_expansion": 1.35,
  "atm_iv": 0.18
}
```

---

## GET /gex

Returns GEX levels for a ticker.

**Query params:**
- `ticker` (required)

**Response:**
```json
{
  "ticker": "SPY",
  "zero_gex": 580.00,
  "call_wall": 595.00,
  "put_wall": 565.00,
  "net_gex_billion": 2.4,
  "refreshed_at": "2026-03-25T14:30:00Z"
}
```

---

## GET /signals

Returns composite Elliott Wave signals combining wave count, regime, and GEX.

**Query params:**
- `ticker` (required)
- `timeframe` (optional)

**Response:**
```json
{
  "ticker": "SPY",
  "signal": "LONG_SETUP",
  "confidence": 0.82,
  "wave": "3",
  "regime": "STRONG_TREND_UP",
  "gex_alignment": "above_zero_gex",
  "notes": "Wave 3 impulse with GEX tailwind and strong trend regime."
}
```

---

## POST /api/ai-commentary

Returns AI-generated natural language interpretation of the primary wave count.

**Request body:**
```json
{
  "ticker": "SPY",
  "waveLabel": "3",
  "structure": "impulse",
  "probability": 0.74,
  "fibLevels": [
    { "label": "0.618 ret", "price": 575.20 }
  ],
  "regime": "STRONG_TREND_UP",
  "nextTarget": 598.50,
  "invalidation": 572.10,
  "price": 588.00,
  "gexLevel": "Zero GEX at $580.00"
}
```

**Response:**
```json
{
  "commentary": "SPY is in Wave 3 of an impulse structure with 74% posterior — the 0.618 retracement at $575 provided the Wave 2 low, and with Zero GEX now acting as support at $580, the path of least resistance remains higher toward the $598 target; a break below $572 invalidates the count."
}
```

---

## WebSocket — wave-stream

`wss://elliott-wave-stream.fly.dev`

**Auth (send as first message):**
```json
{ "type": "auth", "api_key": "<api_key>" }
```

**Subscribe to ticker:**
```json
{ "type": "subscribe", "ticker": "SPY" }
```

**Events emitted:**
```json
{ "type": "probability_change", "ticker": "SPY", "wave": "3", "old": 0.68, "new": 0.74, "ts": 1711375200000 }
{ "type": "count_flip",         "ticker": "SPY", "from_wave": "B", "to_wave": "3", "ts": 1711375200000 }
{ "type": "invalidation_hit",   "ticker": "SPY", "wave": "3", "stop": 572.10, "price": 571.80, "ts": 1711375200000 }
{ "type": "target_reached",     "ticker": "SPY", "wave": "3", "target": 598.50, "price": 598.60, "ts": 1711375200000 }
```
