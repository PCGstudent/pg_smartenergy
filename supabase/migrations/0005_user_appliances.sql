-- =====================================================================
-- Voltwise — user appliances (loads)
-- A user's controllable/shiftable loads (EV, washer, dishwasher, water
-- heater, home battery, ...). The "Hoje & Amanhã" planner reads these and
-- maps each to its cheapest FINAL-price window for tomorrow.
--
-- RLS: owner-only (mirrors invoices / consumption_readings / alerts).
-- Idempotent: safe to re-run.
-- =====================================================================

create table if not exists public.user_appliances (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  -- Human label, e.g. "Máquina de lavar loiça".
  label text not null,
  -- Icon/category. Free text on the DB; the app constrains to a known set
  -- (ev | washer | dishwasher | water_heater | home_battery | dryer | pool_pump | other).
  type text not null default 'other',
  -- Energy delivered per run, kWh (e.g. an EV top-up of 20 kWh, a wash of 1.2 kWh).
  energy_kwh numeric(8, 3) not null,
  -- Draw while running, kW. The planner derives slot count = ceil(energy/power).
  power_kw numeric(6, 3) not null,
  -- Convenience copy of a typical cycle length, minutes. Informational/UX only —
  -- the planner uses energy_kwh + power_kw for the math. NULL = derive from energy/power.
  typical_duration_min integer,
  -- Can the load be paused/resumed (cherry-pick the cheapest scattered slots)?
  interruptible boolean not null default false,
  -- Availability window in LOCAL hours (Europe/Lisbon for PT). The appliance may
  -- only run between earliest_hour (inclusive) and latest_hour (must finish by).
  -- 0..24; default = no constraint (whole day).
  earliest_hour integer not null default 0,
  latest_hour integer not null default 24,
  -- Soft-disable without deleting; inactive loads are skipped by the planner.
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint user_appliances_energy_positive check (energy_kwh > 0),
  constraint user_appliances_power_positive check (power_kw > 0),
  constraint user_appliances_duration_positive
    check (typical_duration_min is null or typical_duration_min > 0),
  constraint user_appliances_earliest_range check (earliest_hour between 0 and 24),
  constraint user_appliances_latest_range check (latest_hour between 0 and 24),
  constraint user_appliances_window_order check (earliest_hour < latest_hour)
);

create index if not exists idx_user_appliances_user
  on public.user_appliances (user_id, active);

-- RLS: each user does full CRUD on their own rows only. -----------------
alter table public.user_appliances enable row level security;

drop policy if exists "user_appliances crud own" on public.user_appliances;
create policy "user_appliances crud own" on public.user_appliances
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
