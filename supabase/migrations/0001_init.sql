-- =====================================================================
-- Voltwise — initial Supabase migration
-- Apply via Supabase SQL editor OR `supabase db push` after `pnpm db:push`.
-- This file is idempotent: safe to re-run.
-- =====================================================================

-- 1. EXTENSIONS ------------------------------------------------------------

create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto";

-- 2. STORAGE BUCKETS -------------------------------------------------------

-- Private bucket for raw OMIE/ESIOS dumps (audit/replay).
insert into storage.buckets (id, name, public)
  values ('raw', 'raw', false)
  on conflict (id) do nothing;

-- Private bucket for user invoice PDFs.
insert into storage.buckets (id, name, public)
  values ('invoices', 'invoices', false)
  on conflict (id) do nothing;

-- 3. ROW-LEVEL SECURITY ----------------------------------------------------
-- Drizzle creates tables; we enforce policies here.

-- profiles: each user reads/writes their own row.
alter table public.profiles enable row level security;

drop policy if exists "profiles select own" on public.profiles;
create policy "profiles select own" on public.profiles
  for select using (auth.uid() = id);

drop policy if exists "profiles insert own" on public.profiles;
create policy "profiles insert own" on public.profiles
  for insert with check (auth.uid() = id);

drop policy if exists "profiles update own" on public.profiles;
create policy "profiles update own" on public.profiles
  for update using (auth.uid() = id);

-- market_prices: public read, service-role write only.
alter table public.market_prices enable row level security;

drop policy if exists "market_prices read all" on public.market_prices;
create policy "market_prices read all" on public.market_prices
  for select using (true);

-- price_forecasts: public read.
alter table public.price_forecasts enable row level security;

drop policy if exists "price_forecasts read all" on public.price_forecasts;
create policy "price_forecasts read all" on public.price_forecasts
  for select using (true);

-- tariffs: public read (catalog).
alter table public.tariffs enable row level security;

drop policy if exists "tariffs read all" on public.tariffs;
create policy "tariffs read all" on public.tariffs
  for select using (true);

-- invoices: user owns their rows.
alter table public.invoices enable row level security;

drop policy if exists "invoices select own" on public.invoices;
create policy "invoices select own" on public.invoices
  for select using (auth.uid() = user_id);

drop policy if exists "invoices insert own" on public.invoices;
create policy "invoices insert own" on public.invoices
  for insert with check (auth.uid() = user_id);

drop policy if exists "invoices update own" on public.invoices;
create policy "invoices update own" on public.invoices
  for update using (auth.uid() = user_id);

drop policy if exists "invoices delete own" on public.invoices;
create policy "invoices delete own" on public.invoices
  for delete using (auth.uid() = user_id);

-- audits: user-scoped.
alter table public.audits enable row level security;

drop policy if exists "audits select own" on public.audits;
create policy "audits select own" on public.audits
  for select using (auth.uid() = user_id);

drop policy if exists "audits insert own" on public.audits;
create policy "audits insert own" on public.audits
  for insert with check (auth.uid() = user_id);

-- consumption_readings: user-scoped.
alter table public.consumption_readings enable row level security;

drop policy if exists "consumption select own" on public.consumption_readings;
create policy "consumption select own" on public.consumption_readings
  for select using (auth.uid() = user_id);

drop policy if exists "consumption insert own" on public.consumption_readings;
create policy "consumption insert own" on public.consumption_readings
  for insert with check (auth.uid() = user_id);

-- alerts: user-scoped.
alter table public.alerts enable row level security;

drop policy if exists "alerts crud own" on public.alerts;
create policy "alerts crud own" on public.alerts
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- alert_events: user reads, service writes.
alter table public.alert_events enable row level security;

drop policy if exists "alert_events select own" on public.alert_events;
create policy "alert_events select own" on public.alert_events
  for select using (auth.uid() = user_id);

-- devices: user-scoped.
alter table public.devices enable row level security;

drop policy if exists "devices crud own" on public.devices;
create policy "devices crud own" on public.devices
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- 4. STORAGE POLICIES ------------------------------------------------------

-- Users can read/write only files prefixed with their user-id under `invoices`.
drop policy if exists "invoices read own files" on storage.objects;
create policy "invoices read own files" on storage.objects
  for select to authenticated using (
    bucket_id = 'invoices'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "invoices upload own files" on storage.objects;
create policy "invoices upload own files" on storage.objects
  for insert to authenticated with check (
    bucket_id = 'invoices'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- 5. PROFILE AUTO-CREATE ON SIGNUP ----------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  -- country left NULL on purpose: forces /onboarding on first login.
  -- locale is best-effort from signup metadata, defaults to 'pt'.
  insert into public.profiles (id, country, locale)
  values (
    new.id,
    new.raw_user_meta_data->>'country',  -- null unless explicitly provided
    coalesce(new.raw_user_meta_data->>'locale', 'pt')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 6. SEED: a couple of reference tariffs so audits work out of the box ---

insert into public.tariffs (country, provider, name, type, formula, fees)
values
  ('PT', 'EDP Comercial', 'Tarifa Estável Simples', 'fixed',
   '{"fixed_eur_kwh": 0.1849, "taxes": {"iva": 0.06}}'::jsonb,
   '{"fixed_monthly_eur": 12.5}'::jsonb),
  ('PT', 'Coopérnico', 'Indexada OMIE', 'indexed',
   '{"markup_eur_mwh": 30, "taxes": {"iva": 0.06}}'::jsonb,
   '{"fixed_monthly_eur": 6.0}'::jsonb),
  ('ES', 'Endesa', 'One Luz', 'fixed',
   '{"fixed_eur_kwh": 0.142, "taxes": {"iva": 0.21}}'::jsonb,
   '{"fixed_monthly_eur": 9.8}'::jsonb),
  ('ES', 'Octopus Energy', 'Octopus Indexada', 'indexed',
   '{"markup_eur_mwh": 25, "taxes": {"iva": 0.21}}'::jsonb,
   '{"fixed_monthly_eur": 4.5}'::jsonb)
on conflict do nothing;
