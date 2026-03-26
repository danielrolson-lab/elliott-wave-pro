# Changelog — Elliott Wave Pro

All notable changes to this project.
Format: [Version] — Date — Description

---

## [1.0.0] — 2026-03-25 — Phase 4 Complete

### Phase 4: AI, Voice, Social & App Store

**D1 — AI Scenario Commentary**
- `services/proxy/ai-commentary.ts` — Vercel Edge Function using claude-sonnet-4-20250514
- `stores/commentary.ts` — commentary text store per wave count ID
- `hooks/useScenarioCommentary.ts` — triggers on >5% probability shift, debounced 2s
- `components/scenarios/ScenarioCommentary.tsx` — collapsible AI commentary below ScenarioCard
- ANTHROPIC_API_KEY is server-side only; client calls `/api/ai-commentary` proxy

**D2 — Voice Navigation**
- `hooks/useVoiceCommand.ts` — keyword matching engine; expo-av recording
- `components/voice/VoiceCommandHandler.tsx` — mic button, pulsing indicator, transcript display
- Supported commands: show chart, wave count, show/hide labels/fibonacci, dark/light mode, options chain, put/call wall

**D3 — Social Sentiment Overlay**
- `services/stocktwits.ts` — StockTwits public API client
- `stores/sentiment.ts` — bullish/bearish/neutral % + volume
- `hooks/useSentiment.ts` — 5-minute polling, divergence detection
- `components/sentiment/SentimentOverlay.tsx` — sentiment bar, color-coded, divergence flag, Wave 5 contrarian warning

**D4 — Multi-chart iPad Layout**
- `components/chart/ChartGrid.tsx` — 2×2 grid for top-4 watchlist tickers
- iPad detection via `useWindowDimensions` (width > 768)
- Tap to expand any cell to full screen
- Compare mode: 2 price series normalized to 100 at shared start date (Skia)

**D5 — Earnings Playbook**
- `components/earnings/EarningsPlaybook.tsx` — bottom sheet modal, auto-shown when earnings ≤7 days
- `EarningsCountdownBadge` — chart header badge for upcoming earnings
- Sections: countdown, IV rank, implied move, 8-quarter bar chart (Skia), strategy, IV crush, Wave extension warning

**D6 — Alert Intelligence**
- `services/proxy/alert-intelligence.ts` — Vercel Edge Function; 1-sentence AI interpretation
- `services/alertIntelligenceService.ts` — mobile client
- `hooks/useAlertEngine.ts` — updated to fetch AI interpretation on trigger, include in notification body
- `stores/alertDetail.ts` — post-trigger context snapshot store (last 50)
- `app/alert-detail.tsx` — post-trigger screen: AI interpretation, context grid, sparkline around trigger

**D7 — App Store Preparation**
- `app.json` — Elliott Wave Pro, com.elliottwave.pro, iOS 16+, Android minSdk 26
- `eas.json` — development/preview/production build profiles
- `docs/appstore/metadata.txt` — name, subtitle, description, keywords, category
- `docs/appstore/privacy-policy.md` — data collection, no sale of user data
- `docs/appstore/icon-spec.md` — icon design specification

**D8 — Final QA Pass**
- tsc --noEmit clean across all packages
- Fixed `EarningsAnalysis.suggested_strategy` field name in EarningsPlaybook
- Fixed missing return path in VoiceCommandHandler useEffect
- Added expo-av and flash-list type stubs

**D9 — Performance Optimization**
- `FlashList` replaces `FlatList` in watchlist (Shopify, virtualized)
- `React.memo` wrappers on RSIIndicator, MACDIndicator, VolumeIndicator, CVDIndicator
- `useShallow` selector in ScenarioPanel to prevent array reference churn
- Wave engine already has candle-length guard preventing redundant recomputation

**D10 — Documentation & Handoff**
- `docs/ARCHITECTURE.md` — full system diagram, key decisions
- `docs/API.md` — all Quant API endpoints with request/response examples
- `docs/DEPLOYMENT.md` — Vercel, Fly.io, Supabase step-by-step
- `docs/CONTRIBUTING.md` — coding standards, store pattern, file naming
- `docs/CHANGELOG.md` — (this file)
- `README.md` — setup, features, architecture overview

---

## [0.3.0] — 2026-03-25 — Phase 3 Complete

### Phase 3: Pro Features, Quant API, Monetization

- Historical wave scanner (FastAPI on Fly.io, 2yr lookback, analog matching)
- Setup replay mode (bar-by-bar playback, wave engine at each step)
- Trade journal with R-multiple analytics, behavioral bias detection, equity curve
- Market internals dashboard (TICK, TRIN, A/D, McClellan, breadth)
- Dark pool feed (FINRA OTC via Polygon, wave context annotation)
- Multi-ticker wave summary grid (sortable by probability/wave/% to target)
- Quant API layer (Vercel Edge + WebSocket, API key auth, Redis cache)
- Earnings volatility tool (implied vs historical move, IV crush, strategy)
- Correlation matrix (rolling 20-day Pearson R, breakdown detection)
- Monetization: RevenueCat, 3 tiers, paywall screen, feature gates

---

## [0.2.0] — 2026-03-24 — Phase 2 Complete

### Phase 2: Live Data, Wave Engine v2, Options

- Polygon REST backfill hook for all 8 timeframes
- Wave engine v2: incremental Bayesian posterior, MTF alignment, degree hierarchy
- 4-scenario panel with animated reorder (Reanimated LinearTransition)
- GEX overlay (Zero GEX, Call Wall, Put Wall from Polygon options chain)
- Full options chain with Greeks (Delta, Gamma, Vanna, Charm, IV Rank)
- IV surface: term structure (contango/backwardation) + 25Δ skew (Skia)
- Options flow feed: sweeps/blocks/unusual with premium filter
- Market regime classifier: 6 regimes (EMA alignment, ATR, IV proxy)
- Level 2 depth ladder and Time & Sales (Lee-Ready aggressor, block detection)
- CVD (Cumulative Volume Delta) indicator with divergence detection
- Compound conditional alerts (3-condition AND-gate, push/webhook/Telegram)
- Leveraged ETF decay engine (20 ETFs, annual drag %, rollover cost)

---

## [0.1.0] — 2026-03-23 — Phase 1 Complete

### Phase 1: Foundation

- Monorepo (pnpm workspaces, packages/wave-engine, apps/mobile)
- Wave engine: detectPivots, generateWaveCounts, scoreWaveCounts, computeFibLevels
- Data stores: marketData, waveCount, watchlist, ui, alerts, indicators, auth, theme
- Polygon WebSocket hook (real-time OHLCV ticks)
- GPU-accelerated candlestick chart (Skia: grid, candles, volume, MA, crosshair)
- Pinch-to-zoom + pan gesture (Reanimated SharedValues, UI thread)
- Wave overlay (1–5/A–B–C labels at pivots, polyline)
- Fibonacci overlay (retracement + extension dashed lines, right-axis labels)
- Sub-indicator panel (RSI-14, MACD 12/26/9, Volume MA-20, swipeable pager)
- 5-tab navigation (Home/Watchlist/Chart/Flow/Settings)
- Watchlist (search, sparkline, wave label, probability bar, swipe-delete, reorder)
- Supabase auth (email/password, Apple Sign-In, Google OAuth PKCE)
- Theme system (DARK/LIGHT tokens, system preference, MMKV-persisted override)
