# Elliott Wave Pro — CLAUDE.md

Monorepo: `pnpm` workspaces.
Mobile app: `apps/mobile` (Expo SDK 51, React Native 0.74, TypeScript strict).
Engine: `packages/wave-engine` (pure TS, Vitest, no RN deps).

**Current phase: Phase 5**

---

## Phase 1 Deliverables

### D1 — Monorepo & project scaffold
- [x] `pnpm-workspace.yaml` with `apps/*` + `packages/*`
- [x] `packages/wave-engine` — pure TypeScript, `@elliott-wave-pro/wave-engine` alias
- [x] `apps/mobile` — Expo SDK 51, strict TypeScript, path aliases
- [x] Vitest configured for wave-engine unit tests
- [x] `packages/wave-engine/fixtures/spy_5m.json` test fixture (215 candles)

### D2 — Wave engine algorithms
- [x] `detectPivots(candles, options)` — swing high/low detection with configurable lookback
- [x] `generateWaveCounts(pivots)` — Elliott Wave candidate generation (impulse + corrective)
- [x] `scoreWaveCounts(counts, context)` — Bayesian scorer (RSI, MACD, volume, Fibonacci)
- [x] `computeFibLevels(count, sliceOffset)` — 5 retracements + 5 extensions
- [x] `computeRSI14` + `computeMACDHistogram` exported for use by scorer
- [x] Unit test: fixture produces exactly 1 valid impulse count (passes)

### D3 — Data layer & WebSocket
- [x] `stores/marketData.ts` — OHLCV candles, quotes, order book, regime, connection status
- [x] `stores/waveCount.ts` — top-4 counts per key, posteriors, deep-scan status
- [x] `stores/watchlist.ts` — items, reorder, snapshot update, tab/sort state
- [x] `stores/ui.ts` — timeframe, chart type, overlay config, crosshair state
- [x] `stores/alerts.ts` — price + wave alerts with triggered/dismissed state
- [x] `stores/indicators.ts` — RSI, MACD, Volume series keyed by `${ticker}_${timeframe}`
- [x] `stores/auth.ts` — Supabase session state
- [x] `stores/theme.ts` — manual theme override, MMKV-persisted
- [x] `hooks/usePolygonWebSocket.ts` — WebSocket hook (Polygon real-time feed)

### D4 — Skia candlestick chart
- [x] `components/chart/CandlestickChart.tsx` — 5 rendering layers (Grid, Candles, Volume, MA overlay, Crosshair)
- [x] `components/chart/TimeframeSelector.tsx` — pill row with 150 ms crossfade
- [x] `components/chart/chartTypes.ts` — CHART_COLORS (OLED black), CHART_LAYOUT, TimeframeOption
- [x] Pinch-to-zoom on time axis (candleWidth 3–40 px)
- [x] Pan gesture to scroll horizontally through candle history
- [x] Tap to show/hide crosshair; long press to dismiss
- [x] All gesture state in Reanimated SharedValues (UI thread, no JS drops)
- [x] `externalTranslateX` / `externalCandleW` props for sharing with indicator panel

### D5 — Wave & Fibonacci overlays
- [x] `components/chart/WaveOverlayLayer.tsx` — wave labels (1–5 / A–B–C) at pivot points, polyline, bull=green / bear=red
- [x] `components/chart/FibonacciOverlayLayer.tsx` — dashed retracement + extension lines, price labels on right axis
- [x] `hooks/useWaveEngine.ts` — fires on new candle close, slices last 200 candles, writes top-2 to waveCount store
- [x] Primary count at full opacity; secondary at 35% opacity

### D6 — Sub-indicator panel
- [x] `components/indicators/RSIIndicator.tsx` — RSI-14, shaded zones, color-segmented line, divergence dots
- [x] `components/indicators/MACDIndicator.tsx` — histogram, MACD + signal lines, zero line, crossover dots
- [x] `components/indicators/VolumeIndicator.tsx` — bright/dim bars vs 20-bar MA, relative volume label
- [x] `components/chart/IndicatorPanel.tsx` — swipeable horizontal pager, dot indicators
- [x] `hooks/useIndicators.ts` — Wilder RSI-14, MACD 12/26/9, Volume MA-20 computed on candle close
- [x] All indicator math lives in the hook; components only read the store

### D7 — Navigation & screens
- [x] `navigation/AppNavigator.tsx` — React Navigation v6, auth-gated bottom tabs (5 tabs)
- [x] Bottom tabs: Home / Watchlist / Chart / Flow / Settings
- [x] `@react-navigation/native-stack` for Chart tab drill-down (ChartMain → TickerDetail)
- [x] `app/index.tsx` — HomeScreen: market status badge + countdown, SPY/QQQ/IWM strip, VIX/10Y/DXY (TODO: live data)
- [x] `app/watchlist.tsx` — search bar with 200 ms debounce → Polygon ticker API, WatchlistCard with sparkline + wave label + probability bar, swipe-to-delete, drag-to-reorder, MMKV persistence
- [x] `app/chart.tsx` — ChartScreen wrapping CandlestickChart + IndicatorPanel

### D8 — Supabase auth
- [x] `utils/supabase.ts` — createClient with MMKV storage adapter (sessions persist across restarts)
- [x] `app/auth.tsx` — email/password sign-in + sign-up, Apple Sign-In (iOS), Google OAuth (expo-web-browser PKCE)
- [x] Auth gating in AppNavigator: no session → AuthScreen; session → main tabs
- [x] Redirect to Watchlist tab after successful login (automatic via session state change)
- [x] `app.json`: `usesAppleSignIn: true`, `scheme: com.elliottwave.pro`, `userInterfaceStyle: automatic`

### D9 — Theme system
- [x] `theme/colors.ts` — DARK + LIGHT token sets (background, surface, separator, bullish, bearish, neutral, accent)
- [x] Dark background: `#000000` (true OLED black); Light background: `#FFFFFF`
- [x] `theme/ThemeContext.tsx` — ThemeProvider + useTheme() hook, resolves override vs system preference
- [x] `stores/theme.ts` — manual override ('light' | 'dark' | 'system'), MMKV-persisted
- [x] NativeWind v4 wired: `tailwind.config.js`, `metro.config.js`, `global.css`, babel preset
- [x] `app/settings.tsx` — theme override segmented control (System / Light / Dark), Sign Out button
- [x] Chart canvas stays dark-only in Phase 1 (trading charts universally dark-themed)

---

## Phase 2 Deliverables

### D0 — REST backfill hook
- [x] `hooks/usePolygonCandles.ts` — fetch real OHLCV from Polygon REST `/v2/aggs/ticker/{ticker}/range/{multiplier}/{timespan}/{from}/{to}`
- [x] Timeframe → multiplier/timespan mapping for all 8 timeframes (1m/5m/15m/30m/1h/4h/1D/1W)
- [x] Adaptive lookback: 2d for 1m, 5d for 5m–30m, 30d for 1h–4h, 730d for 1D–1W
- [x] Writes real candles to `marketData.upsertCandles` via `${ticker}_${timeframe}` key
- [x] `status: 'idle' | 'loading' | 'success' | 'error'` returned for UI feedback
- [x] `app/chart.tsx` updated — reads candles from store, no more synthetic data

### D1 — Wave engine v2
- [x] Incremental Bayesian posterior with decay weighting (half-life 5 candles)
- [x] Multi-timeframe alignment scoring (+20 when 1H and 4H agree, flag `mtf_conflict`)
- [x] Wave degree hierarchy: Grand Supercycle → Minuette color coding + `DEGREE_COLORS`
- [x] ZigZag pivot with adaptive ATR threshold (Phase 1)
- [x] Complete 8-rule engine including diagonal triangle detection (ending + leading)

### D2 — 4-scenario panel with confidence intervals
- [x] `components/scenarios/ScenarioPanel.tsx` — 4 cards with posterior probability bars, animated reorder
- [x] `components/scenarios/ScenarioCard.tsx` — label, probability %, CI, stop price, R/R, MTF status
- [x] Primary count at full opacity; secondary at 35%; tertiary/quaternary collapsed
- [x] Animated reorder on probability update (Reanimated `LinearTransition.springify()`)

### D3 — GEX overlay
- [x] `services/polygonOptions.ts` — fetch options chain snapshot from Polygon (paginated, max 750 contracts)
- [x] `utils/gexCalculator.ts` — compute dealer GEX per strike; find Zero GEX (linear interpolation), Call Wall, Put Wall
- [x] `stores/gex.ts` — Zustand store for GEX levels keyed by ticker
- [x] `hooks/useGEXLevels.ts` — fetches options chain on ticker change, writes to gex store
- [x] `components/chart/GEXOverlayLayer.tsx` — amber/green/red dashed horizontal lines with right-axis labels; Y position recomputed on UI thread via useDerivedValue
- [x] Wired into `CandlestickChart` via `gexLevels` prop; toggled by `overlays.gexLevels`
- [x] Refresh: automatic on ticker change; `refresh()` fn available for pull-to-refresh

### D4 — Options chain + IV surface
- [x] `stores/options.ts` — chain data keyed by `${ticker}_${expiry}`; filter config, term structure, skew, IV history, Max Pain, Max Gamma
- [x] `services/polygonOptions.ts` — extended with `fetchFullOptionsChain` (all Greeks, bid/ask, IV, expiry)
- [x] `utils/optionsGreeks.ts` — Vanna, Charm (BS formulas), moneyness classifier, Max Pain, ATM IV, IV Rank, 25Δ RR + butterfly
- [x] `hooks/useOptionsChain.ts` — fetch + enrich (Vanna/Charm/moneyness) + write term structure, skew, Max Pain, IV Rank to store
- [x] `components/options/OptionsChain.tsx` — strike ladder with bid/ask, Δ, Γ, IV, OI; calls/puts/both toggle; expiry picker; moneyness color-coding; Max Gamma ★ and Max Pain ⚡ badges; IV Rank badge
- [x] `components/options/IVSurface.tsx` — IV term structure (DTE vs ATM IV, contango=amber / backwardation=red) + IV skew (delta vs IV) charts; 25Δ RR + butterfly stats; built with Skia (no Victory Native XL dependency)
- [x] `app/options.tsx` — OptionsScreen wired into Flow tab; Chain / IV Surface tab toggle
- [x] IV Rank computed per ticker, displayed as badge (green <20, amber 20–80, red >80)

### D5 — Options flow feed
- [x] `services/flowFeed.ts` — polls Polygon options snapshot sorted by day.volume; filters premium ≥ threshold AND vol/OI ≥ 5%; sweep/block/side detection from VWAP vs bid/ask
- [x] `stores/flow.ts` — ring buffer (300 prints), dedup by ID, repeat tagging (3+ same strike in 10-min window), `applyFlowFilter` selector
- [x] `hooks/useFlowFeed.ts` — polls every 30s across 9 default liquid underlyings; status: idle/loading/live/error
- [x] `components/flow/FlowFilterBar.tsx` — min premium ($10K–$1M+), type (All/Sweeps/Blocks/Unusual), sentiment (All/Bullish/Bearish) pill selectors
- [x] `components/flow/FlowFeedList.tsx` — color-coded rows (call=green tint, put=red tint); SWEEP (orange) / BLOCK (purple) / REPEAT (red) badges; Δ, IV, V/OI meta row; pull-to-refresh
- [x] `app/flow.tsx` — Flow/Chain/IV Surface tab switcher; live status dot + print count + last-update timestamp; hosts FlowFeedList + OptionsChain + IVSurface inline

### D6 — Market regime classifier
- [x] `packages/wave-engine/src/types.ts` — `MarketRegime` extended to 6 regimes (STRONG_TREND_UP/DOWN, WEAK_TREND_UP/DOWN, HIGH_VOL_CHOP, LOW_VOL_COMPRESSION)
- [x] `utils/regimeClassifier.ts` — pure rules-based classifier (EMA 9/21/50/200 alignment, ATR expansion ratio, ATM IV as VIX proxy, bull/bear candle score); exports `classifyRegime` + `REGIME_META`
- [x] `hooks/useRegimeClassifier.ts` — runs classifier on every candle update; reads ATM IV from options store; writes `MarketRegime` to `marketData.regimes[ticker]`
- [x] `components/common/RegimeBadge.tsx` — colored bordered pill badge (sm/md sizes)
- [x] Regime badge wired into `ScenarioCard` (Row 1) and `app/index.tsx` (HomeScreen regime section)
- [x] `app/chart.tsx` — calls `useRegimeClassifier(ACTIVE_TICKER, timeframe, candles)`

### D7 — Level 2 depth ladder
- [x] `stores/l2.ts` — Zustand/Immer store: L2Book, TapePrint ring buffer (50), bidAskImbalance selector
- [x] `hooks/useL2WebSocket.ts` — Polygon `wss://socket.polygon.io/stocks`; LV2/T/Q subscription; Lee-Ready aggressor; block detection (>5× 20-print rolling avg); auto-reconnect 3s
- [x] `components/l2/DepthLadder.tsx` — top-10 bid/ask with proportional size bars, imbalance ratio header, spread separator; best-3 at full opacity, deeper at 50% alpha
- [x] `components/l2/TimeAndSales.tsx` — FlatList tape (50 prints); green/red/white by aggressor; orange BLOCK badge
- [x] Wired into `app/chart.tsx` — toggleable 160 px side panel (◀ Show L2 / ▶ Hide L2); DEPTH / TAPE tab switcher

### D8 — CVD and tape reading
- [x] `utils/cvdEngine.ts` — bar-level uptick-rule aggressor (close > prevClose = +vol, close < prevClose = -vol); detects bearish/bullish divergences over 5-bar windows
- [x] `stores/indicators.ts` — `CVDSeries` (cumulative, deltas, divergences) added; `setCVD` action
- [x] `hooks/useCVD.ts` — computes CVD on every candle close; writes to indicator store
- [x] `components/indicators/CVDIndicator.tsx` — Skia CVD line (green rising / red falling), zero dash line, divergence dots, current value label (K/M suffix); worklet path builder on UI thread
- [x] `components/chart/IndicatorPanel.tsx` — CVD added as page 3 (4-page pager: RSI / MACD / Volume / CVD)
- [x] Block print detector (>5× 20-print rolling avg) already implemented in `useL2WebSocket` and flagged in TimeAndSales tape

### D9 — Compound conditional alerts
- [x] `stores/alerts.ts` updated — `AlertConditionType` extended with `scenario_flip`, `gex_regime_change`, `rsi_above`, `rsi_below`; `AlertOutputChannel` extended with `telegram`; `AlertDelivery` carries `telegramBotToken` + `telegramChatId`
- [x] `services/alertDelivery.ts` — push notification (expo-notifications), webhook POST (JSON / template), Telegram Bot API `sendMessage`; `deliverAlert(alert, ctx)` fan-out
- [x] `hooks/useAlertEngine.ts` — 5-second polling loop; evaluates all active alerts; AND-gates all conditions[]; marks triggered + calls `deliverAlert`
- [x] `components/alerts/AlertBuilder.tsx` — 3-condition compound builder; all condition types; push/webhook/telegram channel toggles with token/URL inputs
- [x] `useAlertEngine` wired into `AppNavigator` (runs for app lifetime)

### D10 — Leveraged ETF decay engine
- [x] `utils/etfDecayEngine.ts` — `LEVERAGED_ETF_REGISTRY` (20 ETFs: 2×/3× bull/bear + VIX futures); `computeDecay(spec, candles)` → annual drag % via (lev² × σ²) / 2 × 252; rollover drag for futures-based ETFs; `decaySeverity` (0–1 scale); `decayColor` (green/amber/red)
- [x] `components/chart/DecayMeter.tsx` — warning banner showing leverage, annual drag %, gauge bar, FUTURES ROLL badge; renders only for known leveraged tickers
- [x] `app/chart.tsx` — `<DecayMeter ticker candles />` inserted between L2 toggle and IndicatorPanel
- [x] `app/watchlist.tsx` — `⚠ N× DECAY` badge on WatchlistCard left column for leveraged ETFs; color matches severity

---

## Environment Variables

Create `apps/mobile/.env` before running:

```
EXPO_PUBLIC_SUPABASE_URL=https://<project-id>.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=<your-anon-key>
EXPO_PUBLIC_POLYGON_API_KEY=<your-polygon-api-key>
```

## API Keys Required Before Phase 2

See **Phase 2 Readiness** section at the bottom of this file.

---

## Architecture Notes

- **Wave engine** — pure TS package, zero RN deps, fully unit-tested.
- **Skia rendering** — all chart paths built in `useDerivedValue` worklets on the UI thread. Never blocks JS.
- **Reanimated** — all gesture state in `SharedValue`. Pan/pinch never drops frames.
- **Store pattern** — Zustand + Immer. Components read; hooks compute and write.
- **MMKV** — used for auth session, watchlist persistence, theme override.
- **Auth** — Supabase PKCE flow. Apple Sign-In on iOS. Google OAuth via expo-web-browser.

---

## Phase 2 Remaining TODO
| Feature | Status |
|---|---|
| SPY/QQQ/IWM prices on Home screen | Reads from `marketData` store — shows `—` until WS connected |
| VIX / 10Y yield / DXY | `// TODO: REPLACE WITH LIVE DATA` placeholder |
| Watchlist card prices | Shows `—` until Polygon WS delivers quotes |
| Watchlist sparklines | Empty until `marketData.candles` populated |
| TickerDetail screen | Screen registered in ChartStack but not yet built |
| Flow tab | Replaced by live feed in D5 |

---

## Phase 3 Deliverables

### D1 — Historical wave scanner
- [x] `services/fastapi/wave-scan.py` — FastAPI endpoint (POST /wave-scan); accepts ticker, timeframe, lookback_days, wave_type
- [x] Fetches OHLCV from Polygon REST, runs Python wave detection across full history
- [x] Returns instances with forward returns at 1d/3d/5d/10d/20d and MAE
- [x] `stores/waveScan.ts` — Zustand store for scan results
- [x] `services/waveScanService.ts` — Fly.io API client
- [x] `hooks/useWaveScan.ts` — triggers scan, writes to store
- [x] `components/scan/AnalogCard.tsx` — mini Skia chart + returns + MAE per analog
- [x] `app/wave-scan.tsx` — WaveScanResults screen; horizontally scrollable analog cards, aggregate stats
- [x] `services/fastapi/requirements.txt`, `Dockerfile`, `fly.toml` for Fly.io deploy

### D2 — Setup replay mode
- [x] `app/replay.tsx` — ReplayScreen; play/pause/step-forward/step-back controls
- [x] Speed selector: 0.5×/1×/2×/4×; bar-by-bar candle playback with progress bar
- [x] Wave engine runs on visible slice at each step; shows what engine would have said
- [x] Gated: requires Pro or Elite subscription
- [x] `stores/subscription.ts` — subscription tier store (used by replay gate)

### D3 — Trade journal with intelligence layer
- [x] `stores/journal.ts` — MMKV-persisted journal; auto-populate from chart state; R-multiple P&L; `computeAnalytics()` function
- [x] `app/journal.tsx` — Log / History / Analytics tabs
- [x] Auto-fills ticker, wave, regime from active chart state
- [x] Analytics: win rate by wave, win rate by regime, avg R by instrument, cut-winners-early + hold-losers-long behavioral flags
- [x] Equity curve (Skia), monthly P&L bar chart

### D4 — Market internals dashboard
- [x] `stores/internals.ts` — NYSE TICK, TRIN, A/D, new highs/lows, up/down vol, McClellan Osc, % above MAs
- [x] `hooks/useMarketInternals.ts` — polls Polygon indices every 60s; divergence flag
- [x] `app/internals.tsx` — TICK sparkline (Skia), stat cards, gauge meters, divergence banner

### D5 — Dark pool feed
- [x] `stores/darkpool.ts` — ring buffer (200 prints), filter by notional/size/ticker
- [x] `hooks/useDarkPoolFeed.ts` — polls Polygon trades API filtering dark venue exchange codes; wave context annotation
- [x] `components/darkpool/DarkPoolList.tsx` — color rows, LARGE badge, accumulation signal flag
- [x] `app/darkpool.tsx` — DarkPoolScreen with filter bar

### D6 — Multi-ticker wave summary grid
- [x] `app/wave-grid.tsx` — WaveGridScreen; sortable table (probability/wave/% to target)
- [x] Columns: Ticker, Wave, Structure, Probability bar, Next Target, Invalidation, Regime badge
- [x] One tap → navigates to Chart tab

### D7 — Quant API layer
- [x] `services/proxy/quant-api.ts` — Vercel Edge Functions: GET wave-count, scenarios, regime, gex, signals
- [x] `services/proxy/wave-stream.ts` — Node.js WebSocket server (Fly.io); emits probability_change / count_flip / invalidation_hit / target_reached events
- [x] Supabase postgres_changes → WebSocket bridge for live wave events
- [x] API key auth via Supabase `api_keys` table; daily rate limiting by tier (free 50/pro 5000/elite 50000)
- [x] Upstash Redis 30s signal cache shared across users on same ticker

### D8 — Earnings volatility tool
- [x] `utils/earningsEngine.ts` — implied vs historical move, IV crush estimator, strategy selector
- [x] `stores/earnings.ts` — Zustand earnings store
- [x] `hooks/useEarnings.ts` — fetches Polygon financials, computes historical moves, enriches with wave context
- [x] `app/earnings.tsx` — EarningsScreen; countdown, implied/historical bar chart, IV crush estimate, strategy card, historical table

### D9 — Correlation matrix
- [x] `utils/correlationEngine.ts` — Pearson R, rolling log-return correlation matrix, breakdown detection
- [x] `stores/correlation.ts` — current + prior (40d) matrix store
- [x] `hooks/useCorrelation.ts` — fetches daily closes, builds 20d/40d matrices; refreshes once per day
- [x] `app/correlation.tsx` — CorrelationScreen; NxN heatmap cells (color-coded), breakdown alerts, top-pairs bar chart

### D10 — Monetization
- [x] `stores/subscription.ts` — RevenueCat-backed tier store; `FEATURE_GATES` map
- [x] `hooks/useRevenueCat.ts` — initializes Purchases SDK, syncs CustomerInfo, mirrors tier to Supabase profiles
- [x] `components/paywall/PaywallScreen.tsx` — monthly/annual billing toggle, Pro/Elite plan cards, feature lists, restore purchases
- [x] Products: pro_monthly $24.99 / pro_annual $199 / elite_monthly $59.99 / elite_annual $499
- [x] `types/react-native-purchases.d.ts` — type stubs (full types with npm install)

### Navigation & wiring
- [x] `navigation/AppNavigator.tsx` — RootStack wraps MainTabs + all Phase 3 screens
- [x] `app/settings.tsx` — Phase 3 feature links with tier gates; Upgrade button; subscription badge
- [x] `hooks/useRevenueCat` wired into AppNavigator bootstrap

---

## Pre-App-Store TODO (Phase 3 remaining work)
| Feature | Status |
|---|---|
| `pnpm install react-native-purchases` + native link | Run before iOS build |
| Fly.io deploy for wave-scan FastAPI | `fly deploy` from `services/fastapi/` |
| Fly.io deploy for wave-stream WebSocket | `fly deploy` from `services/proxy/` after build |
| RevenueCat products configured in App Store Connect | Create in-app purchases |
| Supabase tables: `api_keys`, `wave_counts`, `market_regimes`, `gex_levels` | Run migrations |
| TickerDetail screen | Stub registered in navigator — needs implementation |
| VIX / 10Y / DXY live data on Home screen | Replace `// TODO` placeholder |
| `% above 20/50/200 MA` internals | Polygon doesn't provide directly — needs S&P 500 members batch |

---

## Phase 4 Deliverables

### D1 — AI scenario commentary
- [x] `services/proxy/ai-commentary.ts` — Vercel Edge Function; calls Anthropic claude-sonnet-4-20250514; ANTHROPIC_API_KEY server-side only
- [x] `stores/commentary.ts` — commentary text per wave count ID, loading state
- [x] `hooks/useScenarioCommentary.ts` — triggers on primary scenario probability change >5%; debounced
- [x] `components/scenarios/ScenarioCommentary.tsx` — expandable text block below primary ScenarioCard

### D2 — Voice navigation
- [x] `components/voice/VoiceCommandHandler.tsx` — keyword matching engine, command dispatch
- [x] `hooks/useVoiceCommand.ts` — expo-speech + expo-av recording, transcription, command execution
- [x] Microphone button on chart header; pulsing indicator while listening
- [x] Recognized command text displayed before execution
- [x] Commands: show [timeframe] chart for [ticker], primary wave count, show/hide wave labels/fibonacci, switch dark/light mode, open options chain, put/call wall

### D3 — Social sentiment overlay
- [x] `services/stocktwits.ts` — StockTwits public API client; fetch symbol sentiment
- [x] `stores/sentiment.ts` — bullish%, bearish%, message volume per ticker; refresh timestamp
- [x] `hooks/useSentiment.ts` — polls every 5 min; computes divergence flag (price rising, sentiment falling)
- [x] `components/sentiment/SentimentOverlay.tsx` — bar + volume + divergence badge; color: green>60%, red<40%, amber else
- [x] Wave context warning: high bullish sentiment at Wave 5 top

### D4 — Multi-chart layout for iPad
- [x] `components/chart/ChartGrid.tsx` — 2×2 grid of CandlestickChart; top-4 watchlist tickers
- [x] iPad detection via `useWindowDimensions` (width > 768)
- [x] Tap any cell to expand full screen; tap again to collapse
- [x] Compare mode: 2 chart price series normalized to 100 at shared start date
- [x] Wired into `app/chart.tsx` when on iPad

### D5 — Earnings playbook
- [x] `components/earnings/EarningsPlaybook.tsx` — bottom sheet; appears when earnings ≤7 days away
- [x] Sections: countdown, IV rank badge, implied move (nearest weekly), 8-quarter historical bar chart (Skia), strategy card, IV crush estimate, extended wave warning
- [x] Pulls data from `earningsEngine` + `useEarnings` hook (already built in Phase 3)

### D6 — Alert intelligence
- [x] `services/proxy/alert-intelligence.ts` — Vercel Edge Function; Anthropic API; generates 1-sentence interpretation
- [x] `services/alertIntelligenceService.ts` — client; sends alert context (ticker, wave, regime, price, gex) to proxy
- [x] `hooks/useAlertEngine.ts` — updated to call AI interpretation on trigger; include in notification body
- [x] `app/alert-detail.tsx` — post-trigger screen: scenario context at moment fired, OHLCV around trigger
- [x] Wired into AppNavigator root stack

### D7 — App Store preparation
- [x] `app.json` — bundle ID com.elliottwave.pro, version 1.0.0, iOS 16.0+, Android minSdkVersion 26
- [x] `eas.json` — production build profile (autoIncrement, distribution: store)
- [ ] `assets/icon.png` — 1024×1024 (requires design tool; see docs/appstore/icon-spec.md)
- [ ] `assets/splash-icon.png` — 512×512 splash icon (requires design tool)
- [x] `docs/appstore/metadata.txt` — name, subtitle, description, keywords, category
- [x] `docs/appstore/privacy-policy.md` — data collection disclosure, no data sale, Supabase storage

### D8 — Final QA pass
- [x] tsc --noEmit clean
- [x] All screens reviewed: auth, home, watchlist, chart, flow, settings, all Phase 3 screens
- [x] Bottom tab icons visible in dark and light mode
- [x] Wave label overlap fix at default zoom
- [x] No unused imports or variables across modified files

### D9 — Performance optimization
- [x] `React.memo` on all chart layer components (CandlestickChart, WaveOverlayLayer, FibonacciOverlayLayer, GEXOverlayLayer, IndicatorPanel layers)
- [x] `useMemo` guards on wave engine inputs in `useWaveEngine.ts`
- [x] Zustand selectors use `shallow` equality where arrays/objects returned (ScenarioPanel)
- [x] `FlashList` (Shopify) replaces `FlatList` in watchlist
- [x] `components/indicators/*.tsx` wrapped in React.memo

### D10 — Documentation and handoff
- [x] `docs/ARCHITECTURE.md` — full system design, text diagram of all components and data flows
- [x] `docs/API.md` — all Quant API endpoints with request/response examples
- [x] `docs/DEPLOYMENT.md` — Vercel, Fly.io, Supabase step-by-step
- [x] `docs/CONTRIBUTING.md` — coding standards, CLAUDE.md rules in developer format
- [x] `docs/CHANGELOG.md` — all features across Phases 1–4 by version
- [x] `README.md` — setup instructions, feature list, screenshots placeholder

---

## Phase 5 Deliverables

### D1 — App icon and splash screen
- [x] `scripts/generate-icons.ts` — Node.js script using jimp; generates all icon sizes
- [x] `apps/mobile/assets/icon.png` — 1024×1024, black bg, Elliott Wave impulse in white, "EW" label
- [x] `apps/mobile/assets/splash-icon.png` — 512×512 centered on black
- [x] `apps/mobile/assets/android-icon-foreground.png` — adaptive icon foreground
- [x] `apps/mobile/assets/notification-icon.png` — white wave on transparent bg

### D2 — Supabase database migrations
- [x] `supabase/migrations/001_initial_schema.sql` — all tables: profiles, watchlists, wave_count_cache, alerts, alert_history, trade_journal, api_keys, subscription_tiers
- [x] RLS enabled on all tables; users can only read/write own rows
- [x] Indexes on ticker and user_id columns

### D3 — Vercel proxy verification and URL consolidation
- [x] `services/proxy/vercel.json` — explicit builds + routes for all edge functions (ai-commentary, alert-intelligence, wave-compute, quant-api)
- [x] `apps/mobile/hooks/useScenarioCommentary.ts` — uses `EXPO_PUBLIC_API_BASE_URL` (was wrong fallback URL)
- [x] `apps/mobile/services/alertIntelligenceService.ts` — uses `EXPO_PUBLIC_API_BASE_URL`
- [x] `/health` and `/api/ws` verified live on deployed proxy
- [x] Fly.io wave-scan endpoint verified live (returns 401 from Polygon — FastAPI is up)

### D4 — Wave compute proxy route
- [x] `services/proxy/wave-compute.ts` — Vercel Edge Function; proxies `/api/wave-compute` → `https://elliott-wave-scanner.fly.dev/wave-scan`
- [x] `apps/mobile/services/waveScanService.ts` — routes through `EXPO_PUBLIC_API_BASE_URL/api/wave-compute`

### D5 — EAS build configuration
- [x] `apps/mobile/eas.json` — updated development/preview/production profiles
- [x] `apps/mobile/app.json` — expo-local-authentication plugin added

### D8 — App Store listing content
- [x] `docs/appstore/metadata.md` — iOS App Store: name, subtitle, description, keywords, URLs, category, age rating
- [x] `docs/appstore/play-metadata.md` — Google Play: title, short/full description, category, tags

### D9 — Privacy policy and support pages
- [x] `docs/web/privacy.html` — self-contained HTML + inline CSS, dark theme, full privacy policy
- [x] `docs/web/support.html` — self-contained HTML + inline CSS, dark theme, FAQ + contact

### D6 — RevenueCat product configuration
- [x] `services/revenuecat/offerings.json` — full product/entitlement/offering structure for RevenueCat dashboard setup
- [x] Product IDs confirmed correct in `PaywallScreen.tsx` (com.elliottwave.pro.pro_monthly/annual, elite_monthly/annual)
- [x] `EXPO_PUBLIC_REVENUECAT_KEY` confirmed present in `.env`

### D7 — EAS build
- [x] `expo-build-properties`, `expo-local-authentication`, `expo-updates` installed
- [x] EAS project created: `@danzimal/elliott-wave-pro` (ID: dc50700b-8e77-4e1e-b6f9-9253ffdd8201)
- [x] `app.json` updated with real EAS projectId from `eas init --force`
- [x] Apple Team ID `2YSL5AXL3P` set in `eas.json`
- [x] iOS production build queued — build ID dc50700b / https://expo.dev/accounts/danzimal/projects/elliott-wave-pro/builds/65bc69d3-d0fb-4d3a-b888-4315d679b59b

### D10 — Launch checklist and handoff document
- [x] `docs/LAUNCH_CHECKLIST.md` — infrastructure, credentials, assets, testing, legal, submission sections
- [x] `docs/HANDOFF.md` — architecture decisions, known limitations, post-launch features, infrastructure cost estimates
