-- =====================================================================
-- Voltwise — savings ledger (the "já poupaste X€" stickiness figure)
-- One row per (user, day): the EUROS that day's smart-charging plan saved
-- vs charging at a typical hour, summed across the user's active loads.
-- Euros only, on the FINAL customer price (product rule #1/#2).
--
-- Written once per day by the daily-anchor runner (after tomorrow's prices
-- land it persists the realized saving for the planned day). Read back as a
-- cumulative month/year total on /plan and /dashboard.
--
-- RLS: owner-only read (mirrors invoices / consumption_readings / alerts).
--   The service-role runner BYPASSES RLS for the idempotent upsert.
-- Idempotent: safe to re-run; unique (user_id, date) makes the daily write
--   an UPSERT so an Inngest retry / manual replay never double-counts.
-- =====================================================================

create table if not exists public.savings_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  -- The LOCAL day this saving is for (the planned day), e.g. 2026-06-01.
  date date not null,
  -- Estimated € saved that day by timing loads vs charging at a typical hour.
  -- Always >= 0 (we never record a negative "saving"). FINAL price, euros.
  estimated_saving_eur numeric(10, 2) not null default 0,
  -- Per-appliance breakdown for transparency / future drill-down:
  --   [{ "appliance_id": uuid, "label": text, "saving_eur": number }]
  breakdown jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint savings_ledger_saving_nonneg check (estimated_saving_eur >= 0),
  -- One ledger row per user per day → the daily write is an idempotent upsert.
  constraint savings_ledger_user_date_unique unique (user_id, date)
);

create index if not exists idx_savings_ledger_user_date
  on public.savings_ledger (user_id, date desc);

-- RLS: a user can READ their own ledger rows. Writes happen via the
-- service-role runner (which bypasses RLS), so no user-facing write policy. ---
alter table public.savings_ledger enable row level security;

drop policy if exists "savings_ledger read own" on public.savings_ledger;
create policy "savings_ledger read own" on public.savings_ledger
  for select using (auth.uid() = user_id);
