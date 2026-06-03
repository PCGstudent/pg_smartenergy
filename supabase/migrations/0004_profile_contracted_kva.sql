-- Add contracted_kva to profiles for accurate tariff math.
-- NULL means "use default (6.9 kW)". User sets this on the settings page.
alter table public.profiles
  add column if not exists contracted_kva numeric(5, 2);
