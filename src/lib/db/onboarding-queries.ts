import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Supabase-side helpers for the FRICTIONLESS onboarding light path.
 *
 * Two jobs, both RLS-aware (the caller passes a `createSupabaseServer()` client):
 *   1. Pick a sensible DEFAULT indexed tariff for the user's country, so the planner
 *      has a real, OMIE-tracking plan to price the FINAL curve with — before the user
 *      uploads any invoice. We pick INDEXED (not fixed) on purpose: a fixed tariff
 *      flattens the curve and defeats time-shifting advice (same rationale as
 *      `plan-tariff.ts`). Among indexed plans we prefer the LOWEST markup (most
 *      consumer-favourable, and the curve shape is identical regardless of markup).
 *   2. Persist that tariff as the user's `current_tariff_id` (and, optionally, a
 *      starter contracted-power) without clobbering anything the user already set.
 */

/** Minimal tariff identity the onboarding flow needs. */
export interface DefaultTariff {
  id: string
  country: string
  provider: string
  name: string
  type: string
}

/**
 * The default indexed tariff for a country: the active indexed plan with the smallest
 * `markup_eur_mwh`. Falls back to ANY indexed plan, then null when the catalog has none.
 *
 * Sorting by markup is done in JS (the value lives inside the `formula` jsonb, which is
 * awkward to order on in PostgREST) over the small per-country indexed set.
 */
export async function pickDefaultIndexedTariff(
  client: SupabaseClient,
  country: 'PT' | 'ES',
): Promise<DefaultTariff | null> {
  const { data, error } = await client
    .from('tariffs')
    .select('id, country, provider, name, type, formula')
    .eq('country', country)
    .eq('type', 'indexed')
    // Safety bound: cap rows read into memory even if the catalog grows. The per-country
    // indexed set is tiny; 20 is far above any realistic count and keeps the JS sort cheap.
    // (No `active` filter: the `tariffs` table gates validity via active_from/active_to
    // dates, not a boolean column — see schema. Date-window filtering is a separate concern
    // handled where tariffs are priced, not at default-pick time.)
    .limit(20)
  if (error) throw error

  const rows = (data ?? []) as Array<DefaultTariff & { formula: Record<string, unknown> | null }>
  if (rows.length === 0) return null

  const lowestMarkup = rows
    .map((r) => ({ row: r, markup: markupOf(r.formula) }))
    .sort((a, b) => a.markup - b.markup)[0]

  const chosen = lowestMarkup?.row
  if (!chosen) return null
  return { id: chosen.id, country: chosen.country, provider: chosen.provider, name: chosen.name, type: chosen.type }
}

/** Read `markup_eur_mwh` from a tariff formula, treating a missing value as +Infinity. */
function markupOf(formula: Record<string, unknown> | null): number {
  const raw = formula?.['markup_eur_mwh']
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : Number.POSITIVE_INFINITY
}

/**
 * Set the user's default tariff during onboarding WITHOUT overwriting a tariff they
 * already chose. Returns whether a write happened (false = user already had one, or no
 * default exists for the country — both are non-errors).
 *
 * RLS limits the update to the caller's own row.
 */
export async function ensureDefaultTariff(
  client: SupabaseClient,
  userId: string,
  country: 'PT' | 'ES',
): Promise<{ applied: boolean; tariffId: string | null }> {
  const { data: profile, error: readErr } = await client
    .from('profiles')
    .select('current_tariff_id')
    .eq('id', userId)
    .maybeSingle()
  if (readErr) throw readErr

  const existing = (profile?.current_tariff_id as string | null) ?? null
  if (existing) return { applied: false, tariffId: existing }

  const tariff = await pickDefaultIndexedTariff(client, country)
  if (!tariff) return { applied: false, tariffId: null }

  const { error: updateErr } = await client
    .from('profiles')
    .update({ current_tariff_id: tariff.id })
    .eq('id', userId)
  if (updateErr) throw updateErr

  return { applied: true, tariffId: tariff.id }
}
