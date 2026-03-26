-- Elliott Wave Pro — Initial Schema Migration
-- Run in Supabase SQL editor or via: supabase db push
-- All tables have RLS enabled; users read/write only their own rows.

-- ─────────────────────────────────────────────────────────────────────────────
-- PROFILES
-- Auto-created on auth.users insert via trigger.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.profiles (
  id                uuid        primary key references auth.users on delete cascade,
  display_name      text,
  avatar_url        text,
  subscription_tier text        not null default 'free'
                                check (subscription_tier in ('free', 'pro', 'elite')),
  revenuecat_id     text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "profiles: users read own" on public.profiles
  for select using (auth.uid() = id);

create policy "profiles: users update own" on public.profiles
  for update using (auth.uid() = id);

-- Trigger: auto-create profile when a new auth user signs up
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into public.profiles (id)
  values (new.id)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- Trigger: keep updated_at current
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_updated_at
  before update on public.profiles
  for each row execute procedure public.set_updated_at();


-- ─────────────────────────────────────────────────────────────────────────────
-- SUBSCRIPTION TIERS  (reference table, no RLS needed — read-only by all)
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.subscription_tiers (
  tier          text primary key,
  display_name  text    not null,
  monthly_price numeric not null,
  annual_price  numeric not null,
  watchlist_max integer not null,
  scenarios_max integer not null,
  api_daily_max integer not null
);

insert into public.subscription_tiers values
  ('free',  'Free',  0,     0,    3,   2,    50),
  ('pro',   'Pro',   24.99, 199,  999, 4,  5000),
  ('elite', 'Elite', 59.99, 499,  999, 4, 50000)
on conflict (tier) do nothing;


-- ─────────────────────────────────────────────────────────────────────────────
-- WATCHLISTS
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.watchlists (
  id         uuid        primary key default gen_random_uuid(),
  user_id    uuid        not null references auth.users on delete cascade,
  ticker     text        not null,
  sort_order integer     not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists watchlists_user_id_idx  on public.watchlists (user_id);
create index if not exists watchlists_ticker_idx   on public.watchlists (ticker);
create unique index if not exists watchlists_user_ticker_uidx on public.watchlists (user_id, ticker);

alter table public.watchlists enable row level security;

create policy "watchlists: users read own" on public.watchlists
  for select using (auth.uid() = user_id);

create policy "watchlists: users insert own" on public.watchlists
  for insert with check (auth.uid() = user_id);

create policy "watchlists: users update own" on public.watchlists
  for update using (auth.uid() = user_id);

create policy "watchlists: users delete own" on public.watchlists
  for delete using (auth.uid() = user_id);


-- ─────────────────────────────────────────────────────────────────────────────
-- WAVE COUNT CACHE  (realtime push target; updated by server-side workers)
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.wave_count_cache (
  id          text        primary key,  -- "${ticker}_${timeframe}"
  ticker      text        not null,
  timeframe   text        not null,
  wave_label  text,
  structure   text,
  posterior   float,
  target      float,
  stop        float,
  payload     jsonb,
  updated_at  timestamptz not null default now()
);

create index if not exists wave_count_cache_ticker_idx     on public.wave_count_cache (ticker);
create index if not exists wave_count_cache_timeframe_idx  on public.wave_count_cache (timeframe);

-- No RLS — server writes; clients subscribe via Realtime
alter publication supabase_realtime add table public.wave_count_cache;


-- ─────────────────────────────────────────────────────────────────────────────
-- ALERTS
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.alerts (
  id          uuid        primary key default gen_random_uuid(),
  user_id     uuid        not null references auth.users on delete cascade,
  ticker      text        not null,
  label       text        not null,
  conditions  jsonb       not null default '[]',
  channels    jsonb       not null default '{}',
  is_active   boolean     not null default true,
  triggered   boolean     not null default false,
  triggered_at timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists alerts_user_id_idx on public.alerts (user_id);
create index if not exists alerts_ticker_idx  on public.alerts (ticker);

alter table public.alerts enable row level security;

create policy "alerts: users read own" on public.alerts
  for select using (auth.uid() = user_id);

create policy "alerts: users insert own" on public.alerts
  for insert with check (auth.uid() = user_id);

create policy "alerts: users update own" on public.alerts
  for update using (auth.uid() = user_id);

create policy "alerts: users delete own" on public.alerts
  for delete using (auth.uid() = user_id);

create trigger alerts_updated_at
  before update on public.alerts
  for each row execute procedure public.set_updated_at();


-- ─────────────────────────────────────────────────────────────────────────────
-- ALERT HISTORY  (immutable log of triggered alerts with AI interpretation)
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.alert_history (
  id              uuid        primary key default gen_random_uuid(),
  alert_id        uuid        references public.alerts on delete set null,
  user_id         uuid        not null references auth.users on delete cascade,
  ticker          text        not null,
  label           text        not null,
  trigger_price   float,
  wave_label      text,
  regime          text,
  probability     float,
  interpretation  text,
  context_snapshot jsonb,
  triggered_at    timestamptz not null default now()
);

create index if not exists alert_history_user_id_idx  on public.alert_history (user_id);
create index if not exists alert_history_ticker_idx   on public.alert_history (ticker);
create index if not exists alert_history_alert_id_idx on public.alert_history (alert_id);

alter table public.alert_history enable row level security;

create policy "alert_history: users read own" on public.alert_history
  for select using (auth.uid() = user_id);

create policy "alert_history: users insert own" on public.alert_history
  for insert with check (auth.uid() = user_id);

-- No update/delete — history is immutable


-- ─────────────────────────────────────────────────────────────────────────────
-- TRADE JOURNAL
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.trade_journal (
  id             uuid        primary key default gen_random_uuid(),
  user_id        uuid        not null references auth.users on delete cascade,
  ticker         text        not null,
  direction      text        not null check (direction in ('long', 'short')),
  entry_price    float       not null,
  exit_price     float,
  stop_price     float,
  target_price   float,
  quantity       float,
  entry_at       timestamptz not null,
  exit_at        timestamptz,
  wave_label     text,
  wave_structure text,
  regime         text,
  r_multiple     float,
  pnl_usd        float,
  notes          text,
  tags           text[]      not null default '{}',
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists trade_journal_user_id_idx on public.trade_journal (user_id);
create index if not exists trade_journal_ticker_idx  on public.trade_journal (ticker);
create index if not exists trade_journal_entry_at_idx on public.trade_journal (entry_at desc);

alter table public.trade_journal enable row level security;

create policy "trade_journal: users read own" on public.trade_journal
  for select using (auth.uid() = user_id);

create policy "trade_journal: users insert own" on public.trade_journal
  for insert with check (auth.uid() = user_id);

create policy "trade_journal: users update own" on public.trade_journal
  for update using (auth.uid() = user_id);

create policy "trade_journal: users delete own" on public.trade_journal
  for delete using (auth.uid() = user_id);

create trigger trade_journal_updated_at
  before update on public.trade_journal
  for each row execute procedure public.set_updated_at();


-- ─────────────────────────────────────────────────────────────────────────────
-- API KEYS  (for Quant API access — Elite tier)
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.api_keys (
  id          uuid        primary key default gen_random_uuid(),
  user_id     uuid        not null references auth.users on delete cascade,
  key_hash    text        not null unique,  -- SHA-256 hex of the raw key
  label       text        not null default 'Default',
  tier        text        not null default 'elite' check (tier in ('free', 'pro', 'elite')),
  daily_uses  integer     not null default 0,
  last_reset  date        not null default current_date,
  is_active   boolean     not null default true,
  created_at  timestamptz not null default now()
);

create index if not exists api_keys_user_id_idx  on public.api_keys (user_id);
create index if not exists api_keys_key_hash_idx on public.api_keys (key_hash);

alter table public.api_keys enable row level security;

create policy "api_keys: users read own" on public.api_keys
  for select using (auth.uid() = user_id);

create policy "api_keys: users insert own" on public.api_keys
  for insert with check (auth.uid() = user_id);

create policy "api_keys: users update own" on public.api_keys
  for update using (auth.uid() = user_id);

create policy "api_keys: users delete own" on public.api_keys
  for delete using (auth.uid() = user_id);


-- ─────────────────────────────────────────────────────────────────────────────
-- MARKET REGIMES  (server-maintained; clients read via Realtime)
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.market_regimes (
  ticker      text        primary key,
  regime      text,
  ema_alignment text,
  atr_expansion float,
  atm_iv      float,
  updated_at  timestamptz not null default now()
);

create index if not exists market_regimes_ticker_idx on public.market_regimes (ticker);

-- No RLS — server writes; read by all authenticated users
create policy "market_regimes: authenticated read" on public.market_regimes
  for select to authenticated using (true);

alter table public.market_regimes enable row level security;
alter publication supabase_realtime add table public.market_regimes;


-- ─────────────────────────────────────────────────────────────────────────────
-- GEX LEVELS  (server-maintained)
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.gex_levels (
  ticker           text        primary key,
  zero_gex         float,
  call_wall        float,
  put_wall         float,
  net_gex_billion  float,
  refreshed_at     timestamptz not null default now()
);

create index if not exists gex_levels_ticker_idx on public.gex_levels (ticker);

alter table public.gex_levels enable row level security;

create policy "gex_levels: authenticated read" on public.gex_levels
  for select to authenticated using (true);


-- ─────────────────────────────────────────────────────────────────────────────
-- Finalise
-- ─────────────────────────────────────────────────────────────────────────────
-- Grant usage to anon and authenticated roles (required for PostgREST)
grant usage on schema public to anon, authenticated;
grant select on public.subscription_tiers to anon, authenticated;
grant all on public.profiles         to authenticated;
grant all on public.watchlists       to authenticated;
grant all on public.alerts           to authenticated;
grant all on public.alert_history    to authenticated;
grant all on public.trade_journal    to authenticated;
grant all on public.api_keys         to authenticated;
grant select on public.wave_count_cache  to authenticated;
grant select on public.market_regimes   to authenticated;
grant select on public.gex_levels       to authenticated;
