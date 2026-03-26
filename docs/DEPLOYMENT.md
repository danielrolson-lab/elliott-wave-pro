# Elliott Wave Pro — Deployment Guide

## Prerequisites

- Node.js 20+, pnpm 9+
- Expo CLI: `npm install -g expo-cli eas-cli`
- Vercel CLI: `npm install -g vercel`
- Fly CLI: `curl -L https://fly.io/install.sh | sh`
- Supabase CLI: `npm install -g supabase`
- Python 3.11+ (for wave-scan FastAPI)

---

## 1. Supabase Database Setup

```sql
-- Run in Supabase SQL editor

-- Profiles (created automatically on auth.users insert)
create table public.profiles (
  id               uuid references auth.users primary key,
  subscription_tier text default 'free' check (subscription_tier in ('free','pro','elite')),
  created_at       timestamptz default now()
);

alter table public.profiles enable row level security;
create policy "Users can read own profile" on public.profiles
  for select using (auth.uid() = id);
create policy "Users can update own profile" on public.profiles
  for update using (auth.uid() = id);

-- Trigger to auto-create profile on signup
create function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id) values (new.id);
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- API keys (for Quant API)
create table public.api_keys (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid references auth.users not null,
  key_hash   text not null unique,  -- SHA-256 of the raw key
  tier       text default 'free',
  daily_uses integer default 0,
  last_reset date default current_date,
  created_at timestamptz default now()
);

-- Wave counts (for realtime WebSocket push)
create table public.wave_counts (
  id          text primary key,
  ticker      text not null,
  timeframe   text not null,
  wave_label  text,
  posterior   float,
  updated_at  timestamptz default now()
);

alter publication supabase_realtime add table public.wave_counts;

-- Market regimes
create table public.market_regimes (
  ticker      text primary key,
  regime      text,
  updated_at  timestamptz default now()
);

-- GEX levels
create table public.gex_levels (
  ticker      text primary key,
  zero_gex    float,
  call_wall   float,
  put_wall    float,
  updated_at  timestamptz default now()
);
```

---

## 2. Vercel Proxy Deployment

```bash
cd services/proxy

# Login to Vercel
vercel login

# Set environment variables
vercel env add ANTHROPIC_API_KEY production
vercel env add SUPABASE_URL production
vercel env add SUPABASE_SERVICE_ROLE_KEY production
vercel env add UPSTASH_REDIS_REST_URL production
vercel env add UPSTASH_REDIS_REST_TOKEN production

# Deploy
vercel --prod
```

The proxy exposes:
- `POST /api/ai-commentary`
- `POST /api/alert-intelligence`
- `GET  /api/wave-count`
- `GET  /api/scenarios`
- `GET  /api/regime`
- `GET  /api/gex`
- `GET  /api/signals`

---

## 3. Fly.io — Wave Scanner FastAPI

```bash
cd services/fastapi

# Install Fly CLI and login
fly auth login

# Create app (first time only)
fly launch --name elliott-wave-scanner --region ord

# Set secrets
fly secrets set POLYGON_API_KEY=your_polygon_key

# Deploy
fly deploy
```

The scanner exposes:
- `POST /wave-scan` — Historical analog detection

---

## 4. Fly.io — Wave Stream WebSocket

```bash
cd services/proxy

# Build the Node.js WebSocket server
fly launch --name elliott-wave-stream --region ord

# Set secrets
fly secrets set SUPABASE_URL=https://...supabase.co
fly secrets set SUPABASE_SERVICE_ROLE_KEY=...

# Deploy
fly deploy
```

---

## 5. Mobile App Build

### Development build
```bash
cd apps/mobile

# Install native dependencies
pnpm install

# Build dev client
eas build --platform ios --profile development
eas build --platform android --profile development
```

### Production build
```bash
# Set EAS project ID in app.json extra.eas.projectId
eas build --platform ios --profile production
eas build --platform android --profile production
```

### App Store submission
```bash
# iOS
eas submit --platform ios --latest

# Android
eas submit --platform android --latest
```

### Required native modules (before build)
```bash
pnpm add react-native-purchases @shopify/flash-list expo-av expo-speech
npx expo prebuild --clean
```

---

## 6. Environment Variables

### Mobile `.env` (client-safe only)
```
EXPO_PUBLIC_SUPABASE_URL=https://<project>.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=<anon_key>
EXPO_PUBLIC_POLYGON_API_KEY=<polygon_key>
EXPO_PUBLIC_REVENUECAT_KEY=<revenuecat_public_key>
EXPO_PUBLIC_AI_COMMENTARY_URL=https://elliott-wave-pro.vercel.app/api/ai-commentary
EXPO_PUBLIC_ALERT_INTELLIGENCE_URL=https://elliott-wave-pro.vercel.app/api/alert-intelligence
EXPO_PUBLIC_WAVE_SCAN_URL=https://elliott-wave-scanner.fly.dev
```

### Vercel (server-side only)
```
ANTHROPIC_API_KEY=sk-ant-...
SUPABASE_URL=https://...supabase.co
SUPABASE_SERVICE_ROLE_KEY=...
UPSTASH_REDIS_REST_URL=https://...upstash.io
UPSTASH_REDIS_REST_TOKEN=...
```

---

## 7. RevenueCat Setup

1. Create products in App Store Connect:
   - `pro_monthly` — $24.99/mo
   - `pro_annual` — $199/yr
   - `elite_monthly` — $59.99/mo
   - `elite_annual` — $499/yr

2. Create entitlements in RevenueCat dashboard:
   - `pro` → pro_monthly, pro_annual, elite_monthly, elite_annual
   - `elite` → elite_monthly, elite_annual

3. Set your RevenueCat public key in `.env` as `EXPO_PUBLIC_REVENUECAT_KEY`.

---

## 8. Post-Deployment Checklist

- [ ] Supabase RLS policies verified
- [ ] Polygon WebSocket proxy URL set in app config
- [ ] Wave scanner Fly.io app healthy (`fly status`)
- [ ] Wave stream WebSocket healthy (`wscat -c wss://elliott-wave-stream.fly.dev`)
- [ ] Vercel functions deployed and healthy (`vercel ls`)
- [ ] RevenueCat products approved in App Store Connect
- [ ] TestFlight build distributed to beta testers
- [ ] App Store review submitted
