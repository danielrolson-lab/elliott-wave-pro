# Elliott Wave Pro — Architecture

## System Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         MOBILE CLIENT                                    │
│   (Expo SDK 51, React Native 0.74, TypeScript strict)                   │
│                                                                          │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │  Navigation (React Navigation v6)                                 │   │
│  │  Root Stack → MainTabs (Home/Watchlist/Chart/Flow/Settings)      │   │
│  │  + Phase 3 screens (WaveScan, Replay, Journal, Internals, ...)   │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                                                                          │
│  ┌─────────────────────┐  ┌──────────────────────────────────────┐     │
│  │   CHART SCREEN       │  │  STATE MANAGEMENT (Zustand + Immer)  │     │
│  │                      │  │                                       │     │
│  │  CandlestickChart    │  │  marketData  — OHLCV, quotes, regime │     │
│  │  ├ Grid layer        │  │  waveCount   — counts, posteriors    │     │
│  │  ├ Candles layer     │  │  watchlist   — items (MMKV)         │     │
│  │  ├ Volume layer      │  │  ui          — timeframe, overlays   │     │
│  │  ├ MA overlay        │  │  alerts      — price + wave alerts   │     │
│  │  ├ WaveOverlay       │  │  indicators  — RSI, MACD, Vol, CVD  │     │
│  │  ├ FibOverlay        │  │  gex         — GEX levels by ticker  │     │
│  │  ├ GEXOverlay        │  │  options     — chain, IV surface     │     │
│  │  └ Crosshair         │  │  flow        — options flow ring buf │     │
│  │                      │  │  l2          — L2 book, tape         │     │
│  │  IndicatorPanel      │  │  journal     — trades (MMKV)         │     │
│  │  ├ RSI              │  │  internals   — TICK, TRIN, A/D        │     │
│  │  ├ MACD             │  │  darkpool    — OTC print ring buffer  │     │
│  │  ├ Volume           │  │  waveScan    — historical analogs     │     │
│  │  └ CVD              │  │  earnings    — event analyses         │     │
│  │                      │  │  correlation — rolling Pearson matrix │     │
│  │  ScenarioPanel       │  │  subscription— RevenueCat tier       │     │
│  │  └ ScenarioCommentary│  │  sentiment   — StockTwits data       │     │
│  │                      │  │  commentary  — AI wave text          │     │
│  │  SentimentOverlay    │  │  alertDetail — post-trigger context  │     │
│  │  L2 side panel       │  └──────────────────────────────────────┘     │
│  │  EarningsPlaybook    │                                                │
│  │  VoiceCommandHandler │  ┌──────────────────────────────────────┐     │
│  │  ChartGrid (iPad)    │  │  HOOKS                                │     │
│  └─────────────────────┘  │  usePolygonWebSocket — WS real-time  │     │
│                             │  usePolygonCandles   — REST backfill │     │
│                             │  useWaveEngine       — pipeline     │     │
│                             │  useIndicators       — RSI/MACD/Vol │     │
│                             │  useGEXLevels        — options chain │     │
│                             │  useRegimeClassifier — 6 regimes    │     │
│                             │  useL2WebSocket      — Level 2 data  │     │
│                             │  useCVD              — CVD calc      │     │
│                             │  useAlertEngine      — polling loop  │     │
│                             │  useRevenueCat       — sub tier sync │     │
│                             │  useWaveScan         — scan trigger  │     │
│                             │  useFlowFeed         — options flow  │     │
│                             │  useDarkPoolFeed     — OTC prints    │     │
│                             │  useMarketInternals  — breadth data  │     │
│                             │  useEarnings         — event data    │     │
│                             │  useCorrelation      — daily closes  │     │
│                             │  useSentiment        — StockTwits    │     │
│                             │  useScenarioCommentary — AI trigger  │     │
│                             │  useVoiceCommand     — expo-av ASR   │     │
│                             └──────────────────────────────────────┘     │
└─────────────────────────────────────────────────────────────────────────┘
                     │                         │
          ┌──────────┼──────────────┐          │
          ▼                         ▼          ▼
┌─────────────────┐  ┌─────────────────────────────────────────────────┐
│  POLYGON.IO      │  │  BACKEND SERVICES                               │
│  WebSocket       │  │                                                  │
│  ├ Real-time     │  │  Supabase (PostgreSQL + Auth + Realtime)         │
│    OHLCV ticks   │  │  ├ profiles (subscription_tier, settings)       │
│  ├ L2 quotes/    │  │  ├ api_keys (Quant API auth + rate limits)       │
│    trades        │  │  ├ wave_counts (persisted for WebSocket push)    │
│  REST            │  │  ├ market_regimes                                │
│  ├ /v2/aggs      │  │  └ gex_levels                                   │
│  ├ /v3/options   │  │                                                  │
│  ├ /v3/trades    │  │  Vercel Edge Functions                           │
│  └ /vX/reference │  │  ├ /api/ai-commentary     (Anthropic API)       │
└─────────────────┘  │  ├ /api/alert-intelligence (Anthropic API)       │
                      │  ├ /api/wave-count         (Quant REST)          │
┌─────────────────┐  │  ├ /api/scenarios           (Quant REST)          │
│  WAVE ENGINE     │  │  ├ /api/regime              (Quant REST)          │
│  (pure TS pkg)   │  │  ├ /api/gex                 (Quant REST)          │
│  ├ detectPivots  │  │  └ /api/signals             (Quant REST)          │
│  ├ generateWave  │  │                                                  │
│    Counts        │  │  Fly.io Services                                 │
│  ├ scoreWave     │  │  ├ wave-scan FastAPI (Python, POST /wave-scan)   │
│    Counts        │  │  └ wave-stream WS   (Node ws, Supabase bridge)  │
│  └ computeFib    │  │                                                  │
│    Levels        │  │  RevenueCat (in-app purchases)                   │
└─────────────────┘  │  Upstash Redis (30s Quant API cache)             │
                      └─────────────────────────────────────────────────┘
```

## Key Architectural Decisions

### 1. Skia GPU rendering
All chart paths are built in `useDerivedValue` worklets on the **UI thread** via
`@shopify/react-native-skia`. No chart update ever blocks the JS thread.
Gesture state (pan offset, candle width) lives in Reanimated `SharedValue`.

### 2. Zustand + Immer store pattern
Components only *read* from stores. Hooks *compute* and *write*.
Never compute derived data inside a component — put it in a hook or selector.

### 3. Wave engine isolation
`packages/wave-engine` has zero React Native dependencies. It is a pure
TypeScript package that can be tested with Vitest in Node.js. The mobile app
imports it as a workspace package (`@elliott-wave-pro/wave-engine`).

### 4. API key security
- **Anthropic API key**: server-side only in Vercel env. Mobile only calls
  `/api/ai-commentary` (Edge Function proxy).
- **Polygon API key**: `EXPO_PUBLIC_POLYGON_API_KEY` (acceptable — read-only
  market data key; rate-limited per Polygon plan).
- **Supabase anon key**: safe to expose client-side by design (RLS enforced).

### 5. Offline-first persistence
- Watchlist items: MMKV (synchronous, no network needed).
- Trade journal: MMKV via Zustand `persist` middleware.
- Auth session: MMKV-backed Supabase storage adapter.
- Theme preference: MMKV.

### 6. Subscription gating
`useSubscriptionStore` holds the current tier (`free | pro | elite`).
`FEATURE_GATES` maps feature names to minimum required tier.
RevenueCat SDK validates receipts natively; tier is mirrored to Supabase
`profiles.subscription_tier` for server-side enforcement.
