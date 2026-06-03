-- =====================================================================
-- Voltwise — foreign key: alerts.user_id -> profiles.id
--
-- WHY: the daily-anchor runner loads active alerts joined to the owner's
-- profile via PostgREST embedding —
--   .select('..., profile:profiles!inner(country, push_subscription, ...)')
-- (src/lib/db/alert-queries.ts:listActiveAlertsWithProfile). PostgREST can
-- only embed `profiles` into `alerts` when a foreign key declares the
-- relationship; without it the query fails at runtime with PGRST200
-- ("Could not find a relationship ... in the schema cache"), which is why
-- /api/inngest was erroring in production.
--
-- profiles.id IS the auth.users id (1:1 per user), so an alert's user_id
-- always has a matching profile row. Verified zero orphans before adding.
-- ON DELETE CASCADE: if a user/profile is removed, their alerts go too.
--
-- Idempotent: drops the constraint first so re-runs are safe.
-- =====================================================================

alter table public.alerts
  drop constraint if exists alerts_user_id_profiles_fkey;

alter table public.alerts
  add constraint alerts_user_id_profiles_fkey
  foreign key (user_id) references public.profiles (id) on delete cascade;
