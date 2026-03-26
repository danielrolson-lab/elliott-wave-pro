# Elliott Wave Pro

Institutional-grade Elliott Wave analysis for iOS and Android.

Built on Expo SDK 51 / React Native 0.74 / TypeScript strict mode.

---

## Features

### Wave Analysis
- **Elliott Wave Engine** — Bayesian-scored impulse and corrective wave detection across all timeframes (1m–1W)
- **4-Scenario Panel** — ranked wave count scenarios with posterior probabilities, targets, and stop levels; animated reorder
- **Fibonacci Overlay** — dashed retracements + extensions with right-axis price labels
- **Wave Scanner** — 2-year historical analog matching via FastAPI on Fly.io
- **Setup Replay Mode** — bar-by-bar candle playback showing wave engine state at each step
- **AI Commentary** — Claude (claude-sonnet-4-20250514) explains the primary wave count in plain English; updates on >5% probability shift

### Options & GEX
- **GEX Overlay** — Zero GEX, Call Wall, Put Wall plotted directly on chart
- **Options Chain** — full strike ladder with Greeks (Delta, Gamma, Vanna, Charm), IV Rank badge, Max Pain, Max Gamma
- **IV Surface** — term structure (contango/backwardation) + 25Δ skew chart (Skia)
- **Options Flow Feed** — real-time sweeps/blocks/unusual activity with premium filter
- **Earnings Playbook** — pre-trade checklist with IV crush estimate and strategy recommendation

### Market Data
- **Real-time WebSocket** — Polygon.io live ticks, L2 quotes, tape
- **Level 2 Depth Ladder** — top-10 bid/ask with proportional size bars, imbalance ratio
- **Time & Sales** — Lee-Ready aggressor tape with block detection
- **CVD Indicator** — Cumulative Volume Delta with divergence detection
- **Dark Pool Feed** — FINRA OTC prints with wave context annotation
- **Market Internals** — NYSE TICK, TRIN, A/D line, McClellan Oscillator, breadth

### Portfolio & Research
- **Trade Journal** — auto-fills from chart state; R-multiple P&L; win rate by wave/regime; behavioral bias flags
- **Correlation Matrix** — rolling 20-day Pearson R heatmap; breakdown detection
- **Earnings Volatility Tool** — implied vs historical move, IV crush, strategy card, countdown
- **Multi-ticker Wave Grid** — sortable table of all watchlist positions by probability

### Platform
- **Multi-chart iPad** — 2×2 grid layout; compare mode (normalized to 100)
- **Voice Navigation** — keyword matching for chart, wave count, overlay, and theme commands
- **Social Sentiment** — StockTwits bullish/bearish %, divergence flag, Wave 5 contrarian warning
- **Alert Intelligence** — AI-generated one-sentence interpretation when an alert fires
- **Market Regime** — 6-regime classifier (EMA alignment, ATR, IV proxy)
- **Leveraged ETF Decay** — annual drag % and rollover cost for 20 leveraged ETFs

---

## Setup

### Prerequisites

```bash
node -v    # 20+
pnpm -v    # 9+
```

### Install

```bash
git clone https://github.com/your-org/elliott-wave-pro
cd elliott-wave-pro
pnpm install
```

### Environment

```bash
cp apps/mobile/.env.example apps/mobile/.env
# Fill in: EXPO_PUBLIC_SUPABASE_URL, EXPO_PUBLIC_SUPABASE_ANON_KEY,
#          EXPO_PUBLIC_POLYGON_API_KEY, EXPO_PUBLIC_REVENUECAT_KEY
```

### Run

```bash
cd apps/mobile
pnpm start          # Expo Go
pnpm ios            # iOS simulator
pnpm android        # Android emulator
```

### Type check

```bash
cd apps/mobile
pnpm typecheck
```

### Wave engine tests

```bash
cd packages/wave-engine
pnpm test
```

---

## Architecture

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the full system diagram.

**Key decisions:**
- Skia GPU rendering — all chart paths built in UI-thread worklets
- Zustand + Immer — components read, hooks write
- Pure TS wave engine — zero React Native deps, Vitest tested
- MMKV persistence — watchlist, journal, theme, auth session
- Vercel proxy — Anthropic API key never touches client bundle

---

## Deployment

See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for step-by-step:
- Supabase schema migrations
- Vercel Edge Function deployment
- Fly.io FastAPI wave scanner
- Fly.io WebSocket wave stream
- EAS production build + App Store submission

---

## API

See [docs/API.md](docs/API.md) for the Quant REST API and WebSocket event reference.

---

## Subscription Tiers

| Feature | Free | Pro | Elite |
|---------|------|-----|-------|
| Watchlist tickers | 3 | Unlimited | Unlimited |
| Wave scenarios shown | 2 | 4 | 4 |
| Wave Scanner | — | ✓ | ✓ |
| Trade Journal | — | ✓ | ✓ |
| Market Internals | — | ✓ | ✓ |
| Dark Pool Feed | — | ✓ | ✓ |
| Wave Grid | — | ✓ | ✓ |
| Earnings Vol Tool | — | ✓ | ✓ |
| Correlation Matrix | — | ✓ | ✓ |
| Setup Replay Mode | — | — | ✓ |
| Quant API Access | — | — | ✓ |

**Pricing:** Pro $24.99/mo · $199/yr — Elite $59.99/mo · $499/yr

---

## Screenshots

> Placeholder — add screenshots before App Store submission.

- Chart screen with wave overlay and scenario panel
- Options flow feed
- Wave Scanner analogs
- Trade journal analytics
- Market internals dashboard

---

## License

Proprietary. All rights reserved. © 2026 Elliott Wave Pro.
