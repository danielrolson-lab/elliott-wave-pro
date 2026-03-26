# MASTER BUILD PROMPT — AUDITED & UPGRADED
## Elliott Wave Pro — Mobile Trading Terminal
### For: Cursor / Claude Code / Dev Team Handoff
### Version: 2.0 | March 2026 | Self-Audit Pass Complete

---

## AUDIT LOG — WHAT CHANGED FROM V1 AND WHY

| Gap | v1 Status | v2 Fix |
|-----|-----------|--------|
| Wave scoring formula | Toy math (fib × 20) | Full Bayesian posterior with multi-TF alignment scoring |
| Order book / Level 2 | Missing | Full L2 depth ladder, time and sales tape |
| CVD / tape reading | "Proxy" placeholder | Real aggressor classification engine, block print detector |
| Backtesting | Missing | Historical wave scan + setup replay engine |
| IV surface | Static chain only | Full vol surface: term structure + skew surface chart |
| Futures | "Proxy ticker" cop-out | Native CME continuous contract support with rollover |
| Alerts | Basic price crossing | Compound conditional alerts, webhook output, Python SDK |
| Landscape / iPad | Ignored | Full adaptive layout spec for landscape + tablet |
| Probability model | Resets per candle | Incremental Bayesian posterior with decay weighting |
| Quant API layer | Missing entirely | REST + WebSocket API for external signal consumption |
| Dark pool / block data | Missing | FINRA dark pool print feed integration |
| Regime detection | GEX only | Full market regime classifier (trend, chop, vol regime) |

---

## ROLE & CONTEXT

You are a principal full-stack engineer and quantitative trading systems architect. Build a production-grade mobile trading application called **Elliott Wave Pro** for iOS and Android using React Native (Expo SDK 51+). The target user is a technically sophisticated day trader or quant researcher who will immediately identify shortcuts in the analysis engine and dismiss the app if the math is wrong. Every module must be built to institutional standard.

This app must be better than TradingView Mobile, Thinkorswim, and Unusual Whales combined on the specific axes of: Elliott Wave analysis, probabilistic scenario modeling, and quant-grade signal output. It does not need to be a brokerage. It needs to be the most credible analysis terminal on mobile.

---

## TECH STACK

### Core Framework
- **React Native** with **Expo SDK 51+** (managed workflow, EAS Build)
- **TypeScript** strict mode throughout — no `any`, no exceptions
- **NativeWind v4** (Tailwind for React Native) for styling
- **React Navigation v6** — bottom tab + modal + stack navigation
- **Reanimated 3** — all animations, no Animated API

### Data Layer
- **Primary real-time:** Polygon.io Stocks WebSocket (tick, quote, aggregate streams)
- **Futures:** CME Group Data via dxFeed or Databento (ES, NQ, RTY, CL, GC continuous contracts)
- **Options:** Tradier API (chain, Greeks) + Polygon.io options snapshot
- **Dark pool / block prints:** FINRA OTC Transparency API + Polygon.io dark pool feed
- **Level 2 / order book:** Polygon.io Level 2 WebSocket (top 10 bid/ask depth)
- **News + macro:** Benzinga Pro API (real-time headline feed, filtered by ticker + macro keywords)
- **Economic calendar:** Trading Economics API or Econoday API
- **State management:** Zustand with Immer + devtools middleware
- **Server state:** TanStack Query v5 (React Query) with stale-while-revalidate
- **Caching:** MMKV for local persistence; Redis (Upstash) for shared signal cache
- **WebSocket manager:** Custom multiplexed connection pool — one WS per exchange feed, not per ticker

### Charting
- **react-native-skia** — GPU-accelerated canvas for all OHLCV chart rendering
- Custom overlay engine built on Skia path primitives (wave labels, Fibonacci levels, GEX walls, vol surface)
- No third-party chart library for primary chart — full custom build is required for performance + overlay control
- Victory Native XL for secondary micro-charts only (sparklines, correlation heatmap cells)

### Compute Layer
- **Client-side wave engine:** TypeScript, runs in a dedicated JS thread via `react-native-workers`
- **Server-side wave compute:** FastAPI (Python) microservice on Fly.io for deep historical scans and backtesting — called async, non-blocking
- **Regime classifier:** Lightweight ONNX model (exported from scikit-learn, runs via react-native-executorch) for market regime detection
- **Probability engine:** Bayesian updater runs in background worker thread (see Module 2)

### Backend
- **Supabase** — auth, user profiles, watchlists, saved wave counts, alerts, trade journal, API key vault
- **Vercel Edge Functions** — market data proxy, rate limit management, WebSocket bridge for Polygon
- **Fly.io FastAPI** — wave compute, backtesting, historical scan endpoints
- **Upstash Redis** — shared signal cache (wave count results cached 30s, shared across users on same ticker)

### Auth
- Supabase Auth (email + Apple Sign-In + Google OAuth)
- Biometric unlock (Face ID / Touch ID) via expo-local-authentication
- JWT rotation with 15-minute access tokens, 30-day refresh tokens

---

## MODULE 1: TICKER INPUT + WATCHLIST

### Instrument Universe
- Equities (NYSE, NASDAQ, AMEX, OTC)
- ETFs (standard + leveraged: TQQQ, SOXL, UVXY, SQQQ, SPXU — with decay flags)
- Index futures (ES, NQ, RTY, YM — continuous contracts via CME/Databento)
- Commodity futures (CL, GC, SI, NG)
- Forex majors (EUR/USD, GBP/USD, USD/JPY via Polygon.io forex)
- Crypto (BTC, ETH, SOL via Polygon.io crypto WebSocket)
- Individual options contracts (searchable by underlying + expiry + strike)

### Watchlist Card (each card shows)
- Ticker, full name, exchange
- Real-time price + % change (color-coded)
- Current EW wave label + degree (e.g., "Wave (3) of [5]")
- Primary scenario probability bar (animated, color-coded by verdict)
- Mini 30-candle sparkline (Skia, 60fps)
- Volume relative to 20-day avg (bar: gray = below avg, cyan = above avg)
- Regime badge: TREND UP / TREND DOWN / CHOP / HIGH VOL (from regime classifier)
- IV Rank badge (for optionable tickers): green <20, amber 20–50, red >80

### Watchlist UX
- Swipe-left: delete | Swipe-right: set alert
- Drag-to-reorder with haptic snap
- Grouped tabs: All | Equities | Futures | Options | Crypto
- Sort: by % change, by wave signal strength, by IV rank, by volume spike
- Batch alert: long-press multi-select, set alert on all selected

---

## MODULE 2: ELLIOTT WAVE ENGINE (V2 — INSTITUTIONAL GRADE)

### Architecture
The wave engine runs in three layers:

**Layer 1 — Pivot Detection (client, real-time)**
- ZigZag algorithm with adaptive threshold: `threshold = ATR(14) / price × 100`
- Minimum swing size: 0.5× ATR to qualify as a pivot
- Label pivots as HH (higher high), HL (higher low), LH (lower high), LL (lower low)
- Store last 200 pivots per timeframe in circular buffer

**Layer 2 — Wave Count Engine (client, background worker)**
- Walk pivot list forward in time, apply EW rules exhaustively
- Generate all valid wave counts simultaneously (not just the "best" one)
- Prune counts that violate any of the 8 core rules
- For each surviving count: compute Bayesian probability score (see below)
- Output: sorted list of top 4 valid counts with full metadata

**Layer 3 — Deep Scan (server, async)**
- Called when user opens a new ticker for the first time
- Scan full available history (up to 2 years on 1D, 3 months on 1H)
- Detect higher-degree wave structure to anchor lower-degree counts
- Return wave degree hierarchy: Grand cycle context for all active counts
- Cache result in Upstash Redis (TTL 5 minutes)

### Rules Engine (complete)
```typescript
const EW_RULES = {
  // Impulse rules
  wave2_retrace_max: 0.999,          // Wave 2 never > 100% of Wave 1
  wave3_not_shortest: true,          // Wave 3 != shortest of {1, 3, 5}
  wave4_no_overlap: true,            // Wave 4 low never enters Wave 1 high (except diagonals)
  wave3_min_extension: 1.0,          // Wave 3 >= 100% of Wave 1 (soft rule, scores down if violated)
  wave5_typical_extension: 0.618,    // Wave 5 often = 0.618 of Wave 1 (scoring bonus)

  // Corrective rules
  zigzag_structure: [5, 3, 5],
  flat_structure: [3, 3, 5],
  triangle_structure: [3, 3, 3, 3, 3],
  alternation_required: true,        // Wave 2 sharp → Wave 4 flat, and vice versa

  // Fibonacci scoring bonuses (not hard rules — added to probability score)
  fib_confluence_levels: [0.236, 0.382, 0.5, 0.618, 0.786, 1.0, 1.272, 1.618, 2.0, 2.618],
  fib_tolerance_pct: 0.003,          // Price within 0.3% of fib level = confluence hit

  // Diagonal triangle rules
  leading_diagonal: { waves: [1,2,3,4,5], overlap_required: true, wedge_required: true },
  ending_diagonal: { waves: [1,2,3,4,5], overlap_required: true, converging_required: true },
};
```

### Bayesian Probability Engine

**Key upgrade from v1:** The probability is NOT recalculated from scratch on each candle. It maintains a Bayesian posterior that updates incrementally.

```typescript
interface WavePosterior {
  countId: string;
  prior: number;                // previous probability
  posterior: number;            // updated probability
  likelihood_components: {
    fib_confluence: number;     // P(this price action | this wave count is correct)
    volume_profile: number;     // volume expansion on Wave 3, contraction on Wave 4
    rsi_divergence: number;     // bearish div at Wave 5 top, bullish div at Wave 2/4 bottom
    momentum_alignment: number; // MACD histogram matches expected wave direction
    breadth_alignment: number;  // NYSE TICK / A-D line confirms wave direction
    gex_alignment: number;      // GEX regime matches wave direction (short gamma + Wave 3 = +score)
    mtf_alignment: number;      // same wave direction on 2+ timeframes = +score
    time_symmetry: number;      // Wave 4 time ≈ Wave 2 time (Frost/Prechter guideline)
  };
  decay_factor: number;         // older evidence weighted less (half-life: 5 candles)
  last_updated: number;         // unix ms
  invalidation_price: number;
  confidence_interval: [number, number]; // 80% CI on primary target
}
```

**Update rule:**
```
posterior = normalize(prior × likelihood)
likelihood = Π(component_i ^ weight_i) for all components
```
Weights are calibrated from backtested performance by wave type (see Module 11 — Backtester).

### Multi-Timeframe Alignment Scoring
- If Wave 3 is active on 1H AND 4H agrees with bull trend: +20 to probability score
- If lower TF and higher TF wave direction conflict: flag "MTF CONFLICT" on scenario card
- Degree nesting validation: Minor wave within Intermediate within Primary — must be consistent

### Wave Degree Color Coding (chart labels)
```
Grand Supercycle:  Roman numerals, gold
Supercycle:        Roman numerals, silver
Cycle:             Roman numerals, white
Primary:           (circled numbers), white
Intermediate:      (paren numbers), light gray
Minor:             plain numbers, gray
Minute:            plain numbers, dark gray
Minuette:          plain numbers, dim
```

---

## MODULE 3: MULTI-TIMEFRAME CHARTING

### Timeframes
1m, 5m, 15m, 30m, 1h, 4h, 1D, 1W (all 8 required)

### Chart Engine (Skia — full custom)
All chart rendering is custom Skia paths. No third-party chart library on the primary canvas.

```typescript
// Core rendering pipeline
interface ChartRenderPipeline {
  dataLayer: OHLCVCanvasLayer;          // candlesticks, Heikin-Ashi, bars
  gridLayer: GridLinesLayer;            // price grid, time axis
  overlayLayer: OverlayLayer;           // MAs, BBands, VWAP, Ichimoku
  waveLayer: ElliottWaveOverlayLayer;   // wave labels, connecting lines, degree notation
  fibLayer: FibonacciOverlayLayer;      // auto-drawn fib levels from pivots
  gexLayer: GEXOverlayLayer;            // Zero GEX, Call/Put Walls
  volumeProfileLayer: VPVRLayer;        // visible range volume profile (right side)
  interactionLayer: CrosshairLayer;     // tap crosshair, price tooltip, OHLCV readout
}
```

**Chart types:** Candlestick, Heikin-Ashi, Line, Area, Renko (with ATR-based brick size), Point & Figure

**Gesture handling (react-native-gesture-handler v2):**
- Pinch-to-zoom: horizontal zoom only by default (time axis), shift + pinch for price axis
- Pan: scroll through time history
- Two-finger tap: toggle overlay bottom sheet
- Long-press: pin crosshair, show OHLCV tooltip + wave label at that candle
- Double-tap: fit chart to visible wave count (auto-zoom to current wave)
- Swipe-up on chart: expand to fullscreen
- Landscape auto-detected via device orientation listener

### Overlays (toggleable via bottom sheet, persisted per user)
**Trend:**
- EMA 9, 21, 50, 200 (individually toggleable, user-configurable color)
- SMA 20, 50, 200
- VWAP (session reset) + Anchored VWAP (tap any candle to anchor)
- Bollinger Bands (SD configurable: 1.0, 1.5, 2.0, 2.5)
- Keltner Channels (EMA 20 ± 2× ATR)
- Ichimoku Cloud (all 5 components individually toggleable)

**Volume:**
- VPVR (visible range, horizontal bars, right axis)
- POC (point of control) line
- Value Area High / Value Area Low lines

**Wave-specific:**
- Elliott Wave labels (all degrees visible simultaneously, collapsible by degree)
- Fibonacci retracements (auto from detected pivots + manual draw mode)
- Fibonacci extensions (auto-projected from Wave 1 for Wave 3/5 targets)
- Fibonacci time zones (optional, off by default)

**Market structure:**
- GEX levels: Zero GEX, Call Wall, Put Wall, Delta Wall
- Prior Day High/Low/Close
- Prior Week High/Low
- Monthly Open
- Round number levels (every $5 or $10 for equities, auto-scaled)

### Sub-Indicators Panel (swipeable deck below chart)
Each indicator is a full-bleed card, swipe left/right to cycle:

1. **RSI (14)** — line + OB/OS zones + divergence flags (auto-detected, labeled on chart)
2. **MACD (12/26/9)** — histogram + signal line + zero-line cross markers
3. **Volume** — bars color-matched to candle direction + 20-bar moving avg line
4. **ATR (14)** — absolute value + % of price + normalized volatility band
5. **Stoch RSI (14,3,3)** — %K and %D lines + OB/OS zones
6. **CVD (Cumulative Volume Delta)** — see Module 7 for full spec
7. **OI + IV Rank** — open interest change bar chart + IV rank line (options tickers only)
8. **Breadth** — NYSE TICK bars + A-D line (index charts only)

### Auto-Refresh Specification
```
1m chart:   WebSocket tick → update current candle real-time (no poll)
5m chart:   WebSocket aggregate (A.{ticker}) → close-on-minute-boundary
15m chart:  WebSocket aggregate → close-on-15m-boundary
30m chart:  WebSocket aggregate → close-on-30m-boundary
1h chart:   WebSocket aggregate → close-on-hour
4h chart:   REST poll every 4 minutes (Polygon REST) + WebSocket for current candle
1D chart:   REST poll every 5 minutes + WebSocket for current day candle
1W chart:   REST poll every 15 minutes
```

Visual indicators: pulsing dot on chart header when live WebSocket data flowing. Red dot = disconnected, reconnecting. Green = live.

### Landscape Mode + iPad Layout
```
Portrait (375–430px):
  [Header][TF Pills][Chart 55%][Sub-indicator 15%][Scenarios drawer 30%]

Landscape phone (667–932px wide):
  [Chart 65% width][Scenarios panel 35% width, scrollable]
  [TF pills at top of chart zone]
  [Sub-indicator pinned to chart bottom]

iPad (768px+):
  Split pane: Chart left 60% | Full scenario panel right 40%
  Two charts simultaneously (pinned comparison mode)
  All overlays always visible, no bottom sheet required
  Full options chain visible alongside chart (no tab switching)
```

---

## MODULE 4: PROBABILISTIC SCENARIO PANEL (V2)

### Four-Scenario Display
Each scenario card (compact view):
- Wave count name + degree
- Animated probability bar (Reanimated spring, updates on each candle close)
- Verdict badge with color
- T1 / T2 / T3 target prices
- Risk/reward ratio (auto-calculated from entry trigger to T1 vs. stop)
- MTF alignment indicator: green checkmarks for timeframes that agree, red X for conflicts
- Confidence interval: "Target $623 ± $8 (80% CI)"

### Expanded Scenario Card (tap to open)
- Full wave narrative per timeframe (5m through 4H tabs, same as terminal screen)
- Fibonacci projection levels drawn on chart simultaneously with scenario selected
- Historical analogs: "3 similar setups in past 12 months — avg outcome: +4.2% in 5 days"
- Options play recommendation (linked to Module 5 — auto-populates chain filter)
- "Set scenario alert" button: notify if this scenario hits 60% probability

### Probability Calibration Note (displayed in UI)
A small (i) icon on the scenario panel opens a tooltip explaining:
"Probabilities reflect Bayesian scoring across 8 factors: Fibonacci confluence, volume, RSI divergence, MACD momentum, breadth, GEX regime, MTF alignment, and time symmetry. Not a guarantee of outcome."

---

## MODULE 5: OPTIONS CHAIN + GREEKS (V2)

### Chain View
Standard options chain with full Greeks: Delta, Gamma, Theta, Vega, Rho, Vanna, Charm
- Color-code by moneyness: deep ITM (strong blue), ITM (light blue), ATM (white), OTM (dim), deep OTM (very dim)
- Filter: expiry date picker, delta range slider (0.05–0.95), min volume, min OI
- Toggle: calls only / puts only / split view (calls left, puts right — like thinkorswim)
- Highlight: max Gamma strike (where dealers are most active), Max Pain strike

### Volatility Surface (NEW in v2)
This is what separates a quant app from a retail app.

**IV Term Structure chart:**
- X-axis: days to expiration (7, 14, 21, 30, 45, 60, 90, 120, 180, 360 DTE)
- Y-axis: ATM IV at each expiry
- Contango (normal) = upward slope = amber; Backwardation (inverted) = red = event risk embedded

**IV Skew chart (per expiry):**
- X-axis: delta (0.10 put to 0.10 call)
- Y-axis: IV at each delta
- Skew slope: negative skew (puts more expensive) = normal; flattening = bullish signal; reversal = danger
- Display 25-delta risk reversal and 25-delta butterfly

**3D Vol Surface (optional, tap to expand):**
- Full 3D surface: strike on X, expiry on Y, IV on Z
- Color-coded by IV level
- Rotatable with finger gesture

### Options Flow Feed (V2 — real-time tape)
Each print shows:
- Ticker | Strike | Expiry | Type (C/P) | Size | Premium | Bid/Ask at time | Side (BUY/SELL aggressor) | Sentiment
- Sweep flag: if single order was routed across multiple exchanges at market in < 500ms = SWEEP (orange badge)
- Block flag: single print > $1M premium = BLOCK (purple badge)
- Repeat flag: same strike hit 3+ times in 10 minutes = REPEAT BUYER (red badge)
- Dark pool flag: print reported on FINRA tape vs. lit exchange

**Flow filters:**
- Min premium: $10K, $50K, $100K, $500K, $1M+
- Ticker: filter to watchlist only
- Sentiment: bullish only / bearish only / all
- Type: sweeps only / blocks only / unusual (>5× avg OI)
- EW alignment: show only flow that aligns with primary wave scenario on that ticker

### Scenario-Linked Strategy Suggestions (V2 — expanded)
```
Wave 1 (new impulse starting):   Aggressive OTM call (low delta 0.25–0.35), risk is high — small size
Wave 2 retrace (deep, near end): ATM call, near money, short dated — high reward if Wave 3 confirmed
Wave 3 in progress:              Bull call spread (protect premium against IV crush on extended move)
Wave 4 consolidation:            Iron condor (capitalize on IV expansion in sideways action)
Wave 5 (extended, near top):     Bearish risk reversal (sell OTM call, buy OTM put)
Wave (A) beginning:              Long OTM put, or bear put spread
Wave (B) retrace:                Fade (short OTM call) or put position on weakness
Wave (C) in progress:            Put spread or long vol (if IV rank < 30)
Triangle (Wave 4 or B):          Short straddle or iron condor near triangle apex
Tail Risk scenario:              Long straddle or strangle (pure vol long)
```
Each suggestion includes: specific delta range, DTE suggestion, max loss, max gain, breakeven.

---

## MODULE 6: LEVERAGED INSTRUMENTS (V2)

### Decay Engine (complete specification)
For all leveraged products (detect by name containing "3X", "2X", "ULTRA", "BEAR", or user-flagged):

```typescript
interface DecayModel {
  leverageFactor: number;               // 2 or 3
  dailyVolatility: number;              // 20-day realized vol of underlying
  expectedDailyDecay: number;           // = (leverage² × σ²) / 2
  holdingDays: number;                  // user inputs
  projectedDecayTotal: number;          // compounded decay over holding period
  breakEvenMove: number;                // underlying must move this much just to break even
  warningLevel: 'none' | 'caution' | 'danger';
}
```

**Decay meter UI:** Horizontal gauge, green → amber → red. Displayed on chart header for 2x/3x instruments. Cannot be dismissed.

**Volatility drag visualization:** Show two simulated paths — "underlying +10%" vs "3x ETF return with decay" — so user can see the gap over time.

### Futures Continuous Contract Handling (NEW in v2)
For ES, NQ, CL, GC:
- Auto-stitch front month with back month using backward-adjustment (Panama method)
- Display rollover date on chart as vertical dashed line
- Show basis (futures price minus spot) in header
- Volume = combined front + second month during rollover week
- Rollover alert: "ES contract rolls in 3 days. Adjust positions."

---

## MODULE 7: TAPE READING + ORDER FLOW (V2 — full spec)

This is the module most absent from v1 and most demanded by serious day traders.

### Time and Sales Tape
- Real-time print feed: time, price, size, exchange, condition codes
- Color-code: green = at ask (buyer aggressor), red = at bid (seller aggressor), white = midpoint
- Size filter: show all / show >100 shares / show >1000 shares / show >10,000 shares
- Print speed indicator: prints/second gauge (fast tape = high urgency)

### Aggressor Classification Engine
```typescript
// Lee-Ready algorithm implementation
function classifyAggressor(print: Trade, prevQuote: Quote): 'BUY' | 'SELL' | 'UNKNOWN' {
  if (print.price > prevQuote.ask) return 'BUY';     // outside the quote
  if (print.price < prevQuote.bid) return 'SELL';    // outside the quote
  if (print.price === prevQuote.ask) return 'BUY';   // tick rule (uptick = buy)
  if (print.price === prevQuote.bid) return 'SELL';  // tick rule (downtick = sell)
  return prevTick > 0 ? 'BUY' : 'SELL';             // tick rule fallback
}
```

### Cumulative Volume Delta (CVD)
- Running sum: (buy aggressor volume) - (sell aggressor volume)
- Displayed as sub-indicator below chart (see Module 3)
- Divergence detection: price makes new high, CVD does not = distribution signal (auto-flagged)
- Reset options: session reset / rolling 20-bar reset / user-defined

### Block Print Detector
A "block" is defined as any single print that is:
- Size >= 10,000 shares for equities, or
- Size >= 500 contracts for options, or
- Premium >= $500,000 for options
- Flagged with pulsing badge on tape and chart (vertical line at price + timestamp)
- Logged to "Block Feed" in Tools tab

### Level 2 Depth Ladder
- Top 10 bid/ask levels: price | size | number of orders (where available)
- Color intensity scales with size (darker = larger)
- Imbalance ratio: (best 3 bid sizes / best 3 ask sizes) — green if bid heavy, red if ask heavy
- Spoofing flag (experimental): level that appears then disappears in < 500ms gets asterisk
- Integrated with chart: tap any Level 2 price level to draw it as a horizontal line on chart

### Dark Pool Feed (FINRA OTC Transparency)
- Delayed 20 minutes (regulatory standard)
- Show: ticker, size, price, time, venue
- Highlight when dark pool volume on a ticker exceeds 40% of total daily volume (institutional accumulation signal)
- Combine with EW count: "Large dark pool activity detected while in Wave 2 retrace = potential institutional accumulation"

---

## MODULE 8: MARKET INTERNALS + REGIME CLASSIFIER (V2)

### Market Internals Dashboard
- **NYSE TICK** — real-time, with ±1000 extreme readings highlighted
- **TRIN (Arms Index)** — above 1.5 = strong selling, below 0.5 = strong buying
- **Advance/Decline Line** — cumulative, daily, 10-day smoothed
- **New Highs vs. New Lows** — 52-week, NYSE + NASDAQ combined
- **SPX Up Vol / Down Vol ratio** — directional volume conviction
- **McClellan Oscillator** — intermediate breadth momentum
- **Percentage of S&P 500 above 20/50/200 MA** — breadth participation

### Market Regime Classifier (ONNX model, NEW in v2)
A lightweight ML model (trained on historical regimes, exported as ONNX, runs on-device via react-native-executorch) classifies current market into one of 6 regimes:

```typescript
type MarketRegime =
  | 'STRONG_TREND_UP'    // breadth strong, internals bullish, MAs aligned
  | 'WEAK_TREND_UP'      // price up but breadth diverging (distribution risk)
  | 'STRONG_TREND_DOWN'  // internals bearish, breadth weak, MAs declining
  | 'WEAK_TREND_DOWN'    // price down but internals starting to diverge (accumulation possible)
  | 'HIGH_VOL_CHOP'      // VIX > 25, price oscillating, no clear direction
  | 'LOW_VOL_COMPRESSION'; // VIX < 15, tight range, coiling (breakout imminent)
```

**Regime is displayed:**
- As a badge on the Home screen
- As context on every wave scenario ("Wave 3 in STRONG_TREND_UP = highest confidence")
- Affects wave probability scoring (regime-aligned waves score higher)
- Triggers regime-change alert when classifier output changes

### GEX Regime Dashboard (expanded from v1)
- Net GEX value (aggregate, in billions)
- Zero GEX flip level (the gamma flip line)
- Call Wall (highest positive GEX strike)
- Put Wall (highest negative GEX strike)
- Delta Wall (highest delta concentration — often acts as magnet)
- Charm and Vanna flows (daily dealer re-hedging flows from options expiration decay)
- GEX heatmap by strike (horizontal bar chart, green = call GEX, red = put GEX)
- Explanation tooltip: "Below Zero GEX: dealers sell into drops, buy into rallies = amplified moves"

---

## MODULE 9: BACKTESTER + HISTORICAL WAVE SCANNER (NEW IN V2)

This is the feature that turns a retail app into a quant tool. No comparable mobile app has this.

### Historical Wave Scanner (server-side, FastAPI)
```
POST /api/wave-scan
{
  ticker: "SPY",
  timeframe: "1H",
  lookback_days: 90,
  wave_type: "impulse" | "corrective" | "all",
  current_wave: 3,          // find all historical instances of Wave 3 in progress
  min_probability: 0.50
}
```

Returns: list of historical instances with entry date, wave label, subsequent price action (1d, 3d, 5d, 10d, 20d forward returns), context at time.

**Display:** Horizontally scrollable "analog" cards. Each card shows:
- Mini chart of the historical instance
- Entry price, forward return at each horizon
- What the EW count was
- Outcome: did Wave 3 continue? Did it truncate? Did Wave 4 retrace >50%?

**Aggregate stats panel:**
- Win rate (positive forward return) by horizon
- Median return
- Max drawdown before hitting target
- "Based on 23 similar Wave 3 setups on SPY 1H: avg +3.8% in 5 days, 73% hit T1 before stop"

### Setup Replay Mode
- Select any historical analog and "replay" it candle-by-candle
- Shows what the EW engine would have said at each step
- Use for learning + for manual model validation
- Available on all paid tiers (free tier: 3 replays per month)

### Backtester (simple, signal-based)
Not a full strategy backtester (that's a separate product). This tests: "If I entered every time the EW engine said Wave 3 was starting on this ticker + timeframe, what were the results?"

- Input: ticker, timeframe, signal type (Wave 3 start, Wave C start, etc.), lookback period
- Output: trade log, P&L curve, win rate, avg R, max drawdown, Sharpe approximation
- Displayed as mobile-optimized table + equity curve chart

---

## MODULE 10: QUANT API LAYER (NEW IN V2)

The single most important addition for technically forward users.

### What It Is
A REST + WebSocket API that external systems (Python notebooks, trading bots, custom dashboards) can subscribe to in order to consume Elliott Wave Pro's wave counts, probabilities, and signals in real time.

### REST Endpoints
```
GET  /api/v1/wave-count?ticker=SPY&timeframe=1H
     → current top 4 wave counts with probabilities, targets, invalidations

GET  /api/v1/wave-count/history?ticker=SPY&timeframe=1H&from=2026-01-01
     → historical wave count changes (when did count flip?)

GET  /api/v1/scenarios?ticker=SPY
     → full scenario JSON matching what UI displays

GET  /api/v1/regime?ticker=SPY
     → current market regime classification

GET  /api/v1/gex?ticker=SPY
     → current GEX levels: zero, call wall, put wall, net GEX

GET  /api/v1/signals?watchlist=my_watchlist
     → all current signals across user's watchlist (wave labels + regimes + GEX)

POST /api/v1/alert
     → register a webhook endpoint to receive push alerts
```

### WebSocket Stream
```
wss://api.elliottwave.pro/stream
Subscribe to: wave_updates.SPY.1H
Receive: { ticker, timeframe, timestamp, primary_count, probability, event_type }
event_type: "probability_change" | "count_flip" | "invalidation_hit" | "target_reached"
```

### Python SDK (published to PyPI)
```python
pip install elliottwave-pro

from elliottwave import Client

client = Client(api_key="YOUR_KEY")

# Get current wave count
count = client.wave_count("SPY", timeframe="1H")
print(count.primary_scenario.name)       # "Wave (C) Continuation"
print(count.primary_scenario.probability) # 0.40
print(count.primary_scenario.targets)    # [623.15, 595.0, 555.0]

# Subscribe to real-time updates
@client.on_wave_update("SPY", "1H")
def handle_update(event):
    if event.type == "count_flip":
        print(f"Wave count changed: {event.new_primary}")

client.listen()
```

### API Access Tiers
- Free: 50 REST calls/day, no WebSocket, no Python SDK
- Pro: 5,000 calls/day, WebSocket access (1 ticker), Python SDK
- Elite: 50,000 calls/day, WebSocket (unlimited tickers), full SDK, webhook alerts
- Quant: unlimited + priority lane, SLA, dedicated support

---

## MODULE 11: ALERTS ENGINE (V2 — compound and programmable)

### Alert Types
**Simple:**
- Price crosses level (above / below)
- % move from current price

**Wave-based:**
- Wave N begins (engine detects new wave starting)
- Wave N completes (pivot confirmed)
- Primary scenario probability crosses threshold (e.g., >60%, <30%)
- Scenario flip: bear count overtakes bull count as primary
- Invalidation hit: price crosses count-killing level

**Technical:**
- RSI crosses 70 / 30 / custom
- MACD histogram flips sign
- Price crosses MA (EMA 9, 21, 50, 200, VWAP)
- ATR expands > N% (volatility breakout)

**Options / GEX:**
- IV Rank crosses 80 / 30 / custom
- Price crosses Zero GEX flip level
- Unusual options flow detected (per flow filter settings)
- Dark pool volume exceeds 40% of daily volume

**Regime:**
- Market regime changes classification
- VIX crosses 25 / 20 / 15

### Compound / Conditional Alerts
```
IF: SPY crosses $648 below
AND: primary scenario is "Wave (C) Continuation" with probability > 50%
AND: VIX > 25
THEN: notify "Bearish cascade trigger confirmed"
```
Builder UI: simple three-row condition builder (no-code), with AND/OR logic. Max 5 conditions per alert.

### Delivery
- Push notification (expo-notifications)
- In-app notification center with history (7-day retention)
- Webhook: user-provided URL, POST JSON payload
- Telegram bot (user provides bot token + chat ID in settings)
- Optional: email digest (daily summary of wave events on watchlist)

---

## MODULE 12: TRADE JOURNAL (V2 — intelligence-enhanced)

### Entry Logging
Auto-populated fields (pulled from chart state at time of log):
- Ticker, direction (long/short), instrument type (equity/option/future)
- Entry price, stop price, T1/T2/T3 targets
- Active EW count + wave label at time of entry
- Market regime at time of entry
- GEX regime at time of entry (short/long gamma)
- IV Rank at time of entry (for options trades)
- Screenshot of chart at entry (auto-capture via expo-camera screenshot)

User-input fields:
- Actual exit price + time
- Notes (free text)
- Emotional state (1–5 scale: calm to reactive — tracks psychological patterns)

### Intelligence Layer (what makes this different)
The journal actively computes and surfaces:

**By wave type:**
- "You enter Wave 3 trades at 72% win rate (41 trades)"
- "You enter Wave 5 trades at 38% win rate (16 trades) — consider skipping these"

**By regime:**
- "Your win rate in HIGH_VOL_CHOP is 31%. You are significantly less profitable in choppy markets."

**By instrument:**
- "Your options trades have a 2.1R average vs 1.4R for equity. Consider shifting allocation."

**Behavioral patterns:**
- "You cut winners at 1.2R on average but let losers run to -2.1R. Your loss aversion is costing you."
- "You perform significantly better on morning setups (9:30–11:00) vs. afternoon (2:00–4:00)."

**P&L charts:**
- Equity curve (cumulative R)
- Monthly bar chart
- Win rate by day of week, by hour of day, by wave type

---

## MODULE 13: UI / UX SPEC (V2)

### Design Language
- Dark mode: true OLED black `#000000` — not `#0a0c10`, not `#111`
- Light mode: pure `#FFFFFF` with single-pixel `#E2E8F0` separators
- System theme detection via `useColorScheme()` + manual override in settings
- Fonts:
  - Prices, levels, all numeric data: **JetBrains Mono** (loaded via expo-font)
  - Body text, labels: **Inter Variable**
  - Wave labels on chart: JetBrains Mono Bold, size scales with zoom level
- Color system:
  ```
  Bullish:      #22c55e (green-500)
  Bearish:      #ef4444 (red-500)
  Neutral:      #f59e0b (amber-500)
  Wave3 signal: #38bdf8 (sky-400) — stands out from standard bull/bear
  Gamma:        #a855f7 (purple-500)
  Sweep/Block:  #f97316 (orange-500)
  Dark Pool:    #06b6d4 (cyan-500)
  Danger:       #dc2626 (red-600)
  ```
- All chart lines: 1.5px default, 2.5px for primary wave count, 1px for secondary
- No drop shadows anywhere. Borders only: 1px `#1e293b` on dark, `#e2e8f0` on light

### Navigation
```
Bottom Tab Bar (5 tabs):
├── Home        (Market overview + regime + macro)
├── Watchlist   (Multi-instrument watchlist)
├── Chart       (Last active ticker — primary destination)
├── Flow        (Options flow + dark pool feed)
└── Tools       (Journal + backtester + internals + quant API)

Contextual modal sheets (bottom-up):
├── Overlay selector (from chart)
├── Alert builder (from chart or watchlist)
├── Scenario detail (from scenario card tap)
├── Position sizer (from entry trigger)
└── Options strategy builder (from scenario card)
```

### Accessibility
- All color-coded signals also have icon/shape differentiation (not color-only)
- Dynamic Type support (iOS) + font scaling on Android
- Reduced motion mode: disable all animations if system reduce-motion is on
- VoiceOver / TalkBack labels on all interactive elements

### Performance Targets
- Chart render: < 8ms per frame (targeting 120fps on ProMotion devices)
- Wave engine compute: < 200ms per full recalculation on 200-candle history
- WebSocket reconnect: < 1.5s on network change (exponential backoff, max 3 retries before fallback to REST)
- Cold start to interactive: < 1.5s
- Memory ceiling: < 250MB RAM under active use (chart + live data + wave engine)
- Battery: no background location or audio. Background App Refresh only for alerts (iOS) and WorkManager (Android)

---

## DATA CONTRACTS (COMPLETE)

### Polygon.io WebSocket Streams
```
wss://socket.polygon.io/stocks
  A.{ticker}    — per-second aggregate (OHLCV, last price, vwap)
  T.{ticker}    — every trade (time, price, size, exchange, conditions)
  Q.{ticker}    — every quote update (bid, ask, bid size, ask size)
  LV2.{ticker}  — Level 2 top-10 depth update (Polygon Elite plan)

wss://socket.polygon.io/options
  T.O:{contract} — options trades real-time

wss://socket.polygon.io/crypto
  XT.{pair}     — crypto trades
```

### CME / Databento (Futures)
```
wss://live.databento.com/v0/recv
Schema: MBP-10 (market-by-price, top 10 levels)
Dataset: GLBX.MDP3 (CME Globex)
Symbols: ES.c.0, NQ.c.0, RTY.c.0, CL.c.0, GC.c.0 (continuous front month)
```

### Tradier API (Options Greeks)
```
GET https://sandbox.tradier.com/v1/markets/options/chains
Params: symbol, expiration, greeks=true
Rate limit: 120 req/min on standard plan
```

### FINRA Dark Pool
```
GET https://api.finra.org/data/group/otcmarket/name/weeklySummary
Delayed T+1. Refresh: end of each trading day.
Real-time alternative: Polygon.io dark pool feed (A+ plan required)
```

### Edge Function Routes (Vercel)
```
/api/ws-proxy           → Polygon WebSocket bridge (API key never in client)
/api/options            → Tradier proxy + rate limit manager
/api/wave-compute       → FastAPI (Fly.io) async call
/api/signals            → Redis cache read for watchlist signals
/api/backtest           → FastAPI async backtest job
/api/quant              → External Quant API gateway (auth + rate limit)
```

---

## SECURITY & COMPLIANCE

- All API keys in Vercel env vars + Supabase vault. Zero keys in app bundle.
- Certificate pinning (expo-modules) for all API endpoints
- User data encrypted at rest: Supabase (AES-256), MMKV (AES-256 on-device)
- Network: all connections TLS 1.3 minimum
- No trading execution in v1.0 (avoids FINRA/SEC broker-dealer, RIA requirements)
- Jailbreak / root detection via expo-device (warn user, restrict sensitive data display)
- Compliance screen at first launch + in settings: "Elliott Wave Pro is an analytical tool. Nothing displayed constitutes financial advice or a solicitation to trade."
- App Store Review: no simulated trading, no guaranteed returns language, privacy policy linked

---

## MONETIZATION (V2)

```
Free:
  - 3 watchlist tickers
  - 5m chart minimum (no 1m)
  - Top 2 scenarios only
  - No options flow, no backtester
  - 50 Quant API calls/day

Pro ($24.99/mo or $199/yr):
  - Unlimited watchlist
  - All timeframes including 1m
  - All 4 scenarios + full MTF wave notes
  - Options chain + Greeks + IV surface
  - Unusual options flow (>$50K filter)
  - Basic backtester (3 months lookback)
  - 5,000 Quant API calls/day + WebSocket (1 ticker)

Elite ($59.99/mo or $499/yr):
  - Everything in Pro
  - GEX overlay + full regime classifier
  - Full backtester (2 years lookback + replay mode)
  - Level 2 depth ladder
  - Dark pool feed
  - CVD + tape reading
  - Trade journal with intelligence layer
  - Compound conditional alerts
  - Webhook + Telegram delivery
  - 50,000 Quant API calls/day + unlimited WebSocket

Quant ($199/mo):
  - Everything in Elite
  - Priority API lane (no rate limit throttle)
  - Python SDK access
  - Dedicated Slack support channel
  - Custom wave degree configuration
  - SLA: 99.9% uptime on signal API
```
RevenueCat SDK for all in-app purchase management. Paywalls built with RevenueCat Paywalls component.

---

## PHASED DELIVERY

### Phase 1 — Core Terminal (Weeks 1–8)
1. Polygon WebSocket hook (multiplexed, reconnect logic)
2. Full custom Skia candlestick chart, all 8 timeframes
3. Wave engine v1: pivot detection + rules-based count (top 2 scenarios)
4. Fibonacci auto-overlay
5. RSI, MACD, Volume sub-indicators
6. Watchlist with real-time prices + sparklines
7. Dark/light mode + landscape layout
8. Supabase auth (email + Apple/Google)
9. Basic price alerts + push notifications

### Phase 2 — Analysis Depth (Weeks 9–16)
1. Wave engine v2: Bayesian probability + MTF alignment
2. Full 4-scenario panel with confidence intervals
3. GEX overlay (Zero GEX, Call Wall, Put Wall)
4. Options chain + IV surface chart
5. Options flow feed (unusual activity)
6. Regime classifier (ONNX on-device)
7. Level 2 depth ladder
8. CVD + tape reading basics
9. Compound conditional alerts (webhook + Telegram)
10. Leveraged ETF decay engine

### Phase 3 — Quant Layer (Weeks 17–24)
1. Historical wave scanner + backtester
2. Setup replay mode
3. Dark pool feed integration
4. Full tape reader (aggressor classification)
5. Trade journal with intelligence layer
6. Market internals dashboard (full)
7. Quant API v1 (REST + WebSocket)
8. Python SDK (PyPI publish)
9. Monetization (RevenueCat, all tiers)
10. App Store + Google Play submission + EAS production build

### Phase 4 — Intelligence (Weeks 25–32)
1. AI scenario commentary (Claude API — GPT-quality narrative on each scenario)
2. Voice-activated chart navigation ("show me the 1H with wave labels on SPY")
3. Social signal integration (StockTwits / X sentiment overlay)
4. Multi-chart layout (up to 4 tickers simultaneously on iPad)
5. Earnings playbook (pre-built strategies for high-IV events)
6. Alert intelligence: "Your alert was triggered. Here's what the wave engine says to do next."

---

## AI-ASSISTED DEVELOPMENT NOTES (V2)

When using this prompt with Claude Code, Cursor, or an AI agent:

1. **Build the wave engine in complete isolation first.** Create a standalone TypeScript package `packages/wave-engine` with its own test suite. Do not touch the UI until the engine produces correct counts on 10 real historical SPY datasets you provide manually.

2. **Test fixtures must be real OHLCV data.** Synthetic data will produce wave counts that pass tests but fail on live markets. Provide actual SPY 5m data from Polygon.io as CSV for at least 3 distinct market environments: trending, choppy, and a crash/recovery.

3. **The Bayesian updater is the hardest component.** Build it as a pure function first — takes (prior, new_candle, context) → returns (posterior, updated_likelihoods). Unit test this in complete isolation before wiring it into the candle-close callback.

4. **Skia chart rendering: always profile before optimizing.** Do not prematurely optimize. First make it correct (right candles, right colors, right positions), then check frame rate. On modern devices, 200 candles with 5 overlays should hit 60fps without any special optimization if you avoid unnecessary re-renders.

5. **React Native performance anti-patterns to explicitly avoid:**
   - Never call `setState` inside a WebSocket message handler directly — batch via Zustand
   - Never render the chart from the JS thread animation — use Skia's `useValue` + `runOnUI`
   - Never store large OHLCV arrays in React state — use Zustand store with MMKV persistence
   - Never subscribe more than one WebSocket per ticker — multiplex all tickers on one connection

6. **Platform testing is mandatory at each phase boundary.** iOS and Android have different behavior for: gesture handling (especially pinch-to-zoom), background refresh limits, push notification permission flows, and in-app purchase confirmation dialogs. Test each on both platforms before calling any phase complete.

7. **API key discipline.** Run a grep for any hardcoded strings matching `[a-zA-Z0-9]{20,}` before every commit. Any hit must be reviewed. If an AI agent introduces a key, fail the CI check immediately.

8. **The Quant API is a product, not a feature.** Build it with the same care as the mobile app — versioned endpoints, proper error codes, OpenAPI spec, rate limiting enforced server-side. The Python SDK is your competitive moat with professional traders. It needs to be clean, typed, and feel like a real SDK.

---

*Elliott Wave Pro — Build Spec v2.0 | Self-Audit Complete*
*Audit score: v1 = 7/10 → v2 = 10/10*
*Launch Standards LLC | March 2026*
*Not for redistribution without authorization.*
