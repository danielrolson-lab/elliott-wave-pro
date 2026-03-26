# Elliott Wave Pro — CLAUDE.md

Monorepo: `pnpm` workspaces.
Mobile app: `apps/mobile` (Expo SDK 51, React Native 0.74, TypeScript strict).
Engine: `packages/wave-engine` (pure TS, Vitest, no RN deps).

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

## Phase 2 Readiness

### Working with live data
- Polygon WebSocket hook (`usePolygonWebSocket`) — needs `EXPO_PUBLIC_POLYGON_API_KEY` activated
- Supabase auth — needs project created and env vars populated

### Mocked / TODO
| Feature | Status |
|---|---|
| SPY/QQQ/IWM prices on Home screen | Reads from `marketData` store — shows `—` until WS connected |
| VIX / 10Y yield / DXY | `// TODO: REPLACE WITH LIVE DATA` placeholder |
| Watchlist card prices | Shows `—` until Polygon WS delivers quotes |
| Watchlist sparklines | Empty until `marketData.candles` populated |
| Chart candles | Synthetic data in ChartScreen; real candles need REST backfill hook |
| Wave engine on live data | `useWaveEngine` wired but candles are synthetic |
| TickerDetail screen | Screen registered in ChartStack but not yet built |
| Flow tab | Placeholder screen |

### API keys to activate before Phase 2
1. **Polygon.io** — real-time WebSocket (Starter plan minimum for delayed; Business for real-time)
2. **Supabase** — create project, copy URL + anon key, enable Apple + Google OAuth providers
3. **Apple Developer** — enable Sign In with Apple capability in provisioning profile
4. **Google Cloud** — OAuth 2.0 client ID for iOS + Android, add to Supabase dashboard
