# Elliott Wave Pro — Engineering Handoff

This document covers the architectural decisions behind the codebase, known limitations, recommended post-launch features, and estimated infrastructure costs at scale.

---

## Architecture Decisions

### 1. Monorepo (pnpm workspaces)

**Decision:** `apps/mobile` + `packages/wave-engine` in a single pnpm workspace.

**Rationale:** The wave engine is pure TypeScript with zero React Native dependencies and needs to be Vitest-tested in Node.js. Separating it as a workspace package enforces that boundary. When a web dashboard is added later, it can import `@elliott-wave-pro/wave-engine` directly.

**Trade-off:** pnpm workspace resolution occasionally requires explicit `workspace:*` version pins. If adding a backend Node.js service, add it as `apps/api` under the same workspace.

---

### 2. Bayesian Wave Engine (pure TypeScript)

**Decision:** All wave detection and scoring is implemented in `packages/wave-engine/src/` as pure TypeScript functions with no side effects.

**Rationale:** Testability, portability, and predictability. The engine runs identically in Vitest, the React Native JS thread, and a future server-side worker. No global state means concurrent computation across multiple tickers is safe.

**Key algorithms:**
- `detectPivots` — adaptive ATR-based ZigZag (lookback configurable)
- `generateWaveCounts` — exhaustive candidate generation (impulse + corrective)
- `scoreWaveCounts` — Bayesian posterior with Fibonacci, RSI, MACD, volume, MTF alignment, decay weighting (half-life 5 candles)
- `computeFibLevels` — 5 retracement levels + 5 extension levels per wave count

**Limitation:** The engine currently evaluates only the last 200 candles. For weekly timeframes, this covers ~4 years of data. For 1-minute timeframes, this is only ~3.3 hours. A future improvement is adaptive lookback based on timeframe (see post-launch roadmap).

---

### 3. Skia GPU Rendering

**Decision:** All chart paths are computed in `useDerivedValue` worklets on the Reanimated UI thread and drawn by `@shopify/react-native-skia`.

**Rationale:** JS-thread chart libraries (Victory Native, react-native-chart-kit) drop frames during pan/pinch. Skia runs on the UI thread at native frame rate regardless of JS thread load.

**Rules enforced:**
- Never call `.getState()` inside a worklet — pass values as `SharedValue`
- Never use `useState` for pan/pinch state — all gesture state is `SharedValue`
- Path computation lives in `useDerivedValue`; the canvas only consumes paths

**Trade-off:** Debugging Skia worklet issues is harder than debugging regular React renders. Reanimated's `console.log` does not work in worklets — use `runOnJS` to log during development.

---

### 4. Zustand + Immer Store Pattern

**Decision:** Components only read from stores. Hooks compute and write.

**Rationale:** Prevents render-phase side effects and keeps components pure. Makes the data flow unidirectional and testable without rendering.

**Pattern:**
```
Store (state shape + actions)
  ↑ write
Hook (useEffect, fetch, compute)
  ↑ read
Component (render only)
```

**Common mistake to avoid:** Calling a store write action directly in component JSX or during render. Always call writes inside `useEffect`, event handlers, or other hooks.

---

### 5. ANTHROPIC_API_KEY on Server Only

**Decision:** The Anthropic API key lives exclusively in Vercel environment variables. The mobile client calls `/api/ai-commentary` and `/api/alert-intelligence` proxy endpoints.

**Rationale:** Any `EXPO_PUBLIC_` variable is compiled into the app bundle and is trivially extractable from the binary. A compromised API key would incur unbounded costs.

**Implementation:** `services/proxy/ai-commentary.ts` and `services/proxy/alert-intelligence.ts` are Vercel Edge Functions that read `process.env['ANTHROPIC_API_KEY']`. The client sets `EXPO_PUBLIC_AI_COMMENTARY_URL` and `EXPO_PUBLIC_ALERT_INTELLIGENCE_URL` to the proxy URLs.

---

### 6. MMKV for Client Persistence

**Decision:** Watchlist, theme, auth session, and trade journal use `react-native-mmkv` for on-device persistence.

**Rationale:** MMKV is 10× faster than AsyncStorage for synchronous reads. The auth session read on app launch is on the critical path — a slow read here delays the first render.

**Supabase sync:** The watchlist and trade journal are synced to Supabase in the background. Local MMKV is the source of truth for immediate UI; Supabase sync happens asynchronously and on reconnect.

---

### 7. RevenueCat for Subscriptions

**Decision:** Use RevenueCat as the subscription abstraction layer rather than calling StoreKit/Billing directly.

**Rationale:** RevenueCat handles receipt validation, entitlement checking, and cross-platform subscription state. Building equivalent server-side receipt validation takes 2–3 weeks and requires ongoing maintenance as Apple/Google change their APIs.

**Feature gates:** `FEATURE_GATES` in `stores/subscription.ts` maps each feature to the minimum required tier. Add new gated features by adding an entry here — no other changes needed.

---

### 8. Polygon.io for Market Data

**Decision:** Polygon REST + WebSocket for all price data, options chain, and FINRA dark pool prints.

**Rationale:** Polygon offers a single API for stocks, options, indices, and forex. The WebSocket protocol (`wss://socket.polygon.io/stocks`) streams ticks at sub-100ms latency. The options chain snapshot endpoint (`/v3/snapshot/options/{ticker}`) returns all contracts with Greeks in a single paginated request.

**Limitation:** Polygon does not provide `% of S&P 500 stocks above 20/50/200 MA` directly. This requires fetching all S&P 500 member prices and computing locally — marked as a TODO on the home screen.

---

## Known Limitations

| Area | Limitation | Severity | Workaround |
|------|-----------|----------|------------|
| Wave engine | Evaluates only last 200 candles | Medium | Increase in v1.1 — configure per timeframe |
| Voice commands | Uses mock ASR transcript | High | Replace `mockTranscript` in `useVoiceCommand.ts` with real speech-to-text (Google Cloud Speech, OpenAI Whisper, or Expo Speech Recognition when available) |
| TickerDetail screen | Not implemented | Medium | Screen stub registered; shows blank — exclude from TestFlight notes |
| VIX / 10Y / DXY | Hard-coded "—" on Home screen | Low | Polygon provides VIX via `/v2/aggs/ticker/I:VIX/...`; wire in v1.1 |
| % above MA internals | Not implemented | Low | Requires S&P 500 member list + batch price fetch; planned for v1.2 |
| Dark pool feed | Requires Polygon Business plan | Medium | Document in App Store "Data requirements" section |
| expo-av / flash-list | Type stubs only — not native-linked | High | Run `pnpm add expo-av @shopify/flash-list` + `expo prebuild` before first native build |
| Wave Scanner performance | Full 2-year backfill is slow on Fly.io free tier | Medium | Upgrade Fly.io to shared-cpu-2x; results are cached in Supabase |
| MTF alignment | Only 1H and 4H contribute to score | Low | Extend to include daily alignment in v1.1 |

---

## Recommended Post-Launch Features

### v1.1 (Month 1–2)
1. **Real ASR** — Replace mock voice transcript with device speech recognition (Safari SpeechRecognition on iOS, Google Speech on Android via `expo-speech`)
2. **TickerDetail screen** — Company overview, news feed, wave summary card, quick journal entry button
3. **VIX / 10Y / DXY live data** — Wire Polygon index ticks to Home screen (endpoints already in Polygon client)
4. **Adaptive lookback** — Wave engine: 1m → 60 candles, 5m → 100, 1h+ → 200; improves short-term accuracy
5. **Widget** — iOS Home Screen widget (WidgetKit via `expo-widgets`) showing top wave count for first watchlist ticker

### v1.2 (Month 3–4)
6. **% above MA internals** — Fetch S&P 500 member list, batch daily close, compute breadth metrics
7. **Options scanner** — Screen all liquid underlyings for high-probability setups combining wave + IV rank + GEX
8. **Paper trading mode** — Simulate trades without real capital; compare paper vs live journal performance
9. **Backtester** — Run alert conditions against 1-year historical data; show hit rate, avg return per alert type
10. **Watchlist groups** — Separate "Core" / "Watchlist" / "Pending" groups; colour-coded cards

### v1.3 (Month 5–6)
11. **Web dashboard** — Browser-based chart using the same wave engine (import `@elliott-wave-pro/wave-engine`); share chart URLs
12. **Discord/Slack alerts** — Add Discord webhook and Slack webhook as alert delivery channels
13. **Community wave counts** — Allow Pro/Elite users to publish their wave count annotation and see others' counts (anonymized)
14. **Earnings calendar integration** — Pull full earnings calendar from Polygon, surface upcoming events across watchlist
15. **Multi-leg options strategies** — Display P&L diagrams for common structures (iron condor, vertical spread) given current IV levels

---

## Infrastructure Cost Estimates

All estimates in USD per month. Costs assume Polygon Starter (free for 15+ tickers), RevenueCat free tier (up to $2.5k MRR), Supabase free tier, Fly.io, Vercel, and Upstash Redis.

### At 1,000 Monthly Active Users

| Service | Tier | Est. Cost/Month |
|---------|------|----------------|
| Supabase | Pro ($25/mo) | $25 |
| Vercel | Pro ($20/mo, 500K edge function invocations) | $20 |
| Fly.io (wave scanner) | shared-cpu-1x, 256MB, 1 machine | $5 |
| Fly.io (wave stream WS) | shared-cpu-1x, 256MB, 1 machine | $5 |
| Upstash Redis | Pay-as-you-go (~200K commands/day) | $5 |
| Polygon.io | Starter (free) + Options add-on | $0–$29 |
| Anthropic API | ~5K commentary calls/day × $0.000003/token × 300 tokens | ~$5 |
| RevenueCat | Free (<$2.5K MRR) | $0 |
| **Total** | | **~$65–$94/mo** |

Assuming 10% conversion at $24.99/mo Pro → ~100 paying users → $2,499 MRR. Margins are strong at this scale.

---

### At 10,000 Monthly Active Users

| Service | Tier | Est. Cost/Month |
|---------|------|----------------|
| Supabase | Team ($599/mo, 8M row reads) | $599 |
| Vercel | Pro + extra function invocations (~5M/mo) | $100 |
| Fly.io (wave scanner) | 2× shared-cpu-2x, autoscale | $40 |
| Fly.io (wave stream WS) | 2× shared-cpu-2x, autoscale | $40 |
| Upstash Redis | ~2M commands/day | $50 |
| Polygon.io | Business plan (required for FINRA data) | $199 |
| Anthropic API | ~50K commentary calls/day × 300 tokens | ~$50 |
| RevenueCat | Growth ($119/mo after $2.5K MRR) | $119 |
| CDN / Bandwidth | Cloudflare free tier | $0 |
| **Total** | | **~$1,197/mo** |

At 10% conversion (1,000 paying) and 50% Pro / 50% Elite: ~$425K ARR. Infrastructure is <4% of ARR.

---

### At 100,000 Monthly Active Users

| Service | Tier | Est. Cost/Month |
|---------|------|----------------|
| Supabase | Enterprise (custom pricing) | ~$2,000 |
| Vercel | Enterprise (~$500M+ req/mo) | ~$500 |
| Fly.io (wave scanner) | 4–8× performance-2x with autoscale | $400 |
| Fly.io (wave stream WS) | 4–8× performance-2x with autoscale | $400 |
| Upstash Redis | ~20M commands/day | $200 |
| Polygon.io | Enterprise (negotiate; likely ~$500–$1,000) | ~$750 |
| Anthropic API | ~500K calls/day × 300 tokens | ~$500 |
| RevenueCat | Enterprise (~$999/mo) | $999 |
| Additional CDN / monitoring / alerting | | ~$300 |
| **Total** | | **~$6,049/mo** |

At 10% conversion (10,000 paying) and average $30/mo: ~$3.6M ARR. Infrastructure is <2% of ARR.

**Scale considerations at 100K MAU:**
- Supabase Realtime may need to be supplemented or replaced by a dedicated WebSocket cluster (Ably, Pusher Channels, or self-hosted).
- Wave engine computation should move to a dedicated worker pool (not the JS thread) — consider WASM compilation of the wave engine.
- Polygon WebSocket connections are rate-limited — implement a fanout proxy that receives 1 connection per ticker and broadcasts to all subscribed clients.
- Consider caching AI commentary per wave count ID (not per user) — if 1,000 users are watching SPY Wave 3, all 1,000 don't need separate AI calls.

---

## File Index (key source files)

| File | Purpose |
|------|---------|
| `packages/wave-engine/src/index.ts` | Wave engine public API |
| `apps/mobile/stores/waveCount.ts` | Wave count Zustand store |
| `apps/mobile/hooks/useWaveEngine.ts` | Runs engine on candle close |
| `apps/mobile/components/chart/CandlestickChart.tsx` | Main chart component (Skia) |
| `apps/mobile/components/scenarios/ScenarioPanel.tsx` | 4-scenario display |
| `apps/mobile/navigation/AppNavigator.tsx` | Full navigation tree |
| `apps/mobile/stores/subscription.ts` | RevenueCat tier + FEATURE_GATES |
| `services/proxy/ai-commentary.ts` | Vercel Edge — Anthropic proxy |
| `services/fastapi/wave-scan.py` | Fly.io — historical analog scanner |
| `supabase/migrations/001_initial_schema.sql` | Full DB schema |
| `scripts/generate-icons.ts` | Icon asset generator |
| `docs/LAUNCH_CHECKLIST.md` | Pre-submission checklist |

---

*Prepared: March 2026 — Elliott Wave Pro v1.0.0*
