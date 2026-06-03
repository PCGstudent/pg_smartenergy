import type { SupabaseClient } from '@supabase/supabase-js'
import type { PlanTariff } from './plan-builder'

/**
 * Resolve the tariff used to price the planner's FINAL curve.
 *
 * Priority:
 *   1. The user's `current_tariff_id` (the plan they're actually on).
 *   2. A representative INDEXED tariff for the zone — so the curve still tracks
 *      OMIE hour-to-hour and the planner is useful before any audit. (A fixed
 *      tariff would flatten the curve and defeat time-shifting advice.)
 *
 * Returns null only when neither is available (no catalog rows at all), letting the
 * page show a "configure your tariff" hint instead of a misleading flat curve.
 */
export async function resolvePlanTariff(
  client: SupabaseClient,
  userId: string,
  zone: 'PT' | 'ES',
): Promise<PlanTariff | null> {
  const { data: profile } = await client
    .from('profiles')
    .select('current_tariff_id')
    .eq('id', userId)
    .maybeSingle()

  const currentTariffId = (profile?.current_tariff_id as string | null) ?? null
  if (currentTariffId) {
    const { data } = await client
      .from('tariffs')
      .select('id, country, type, formula')
      .eq('id', currentTariffId)
      .maybeSingle()
    if (data) return normalize(data)
  }

  // Fallback: cheapest-markup indexed tariff for the zone (most curve-faithful).
  const { data: indexed } = await client
    .from('tariffs')
    .select('id, country, type, formula')
    .eq('country', zone)
    .eq('type', 'indexed')
    .limit(1)
    .maybeSingle()
  if (indexed) return normalize(indexed)

  // Last resort: ANY tariff for the zone (may be FIXED) so a curve can still be priced.
  // NOTE: a FIXED tariff flattens the FINAL curve, so the planner page deliberately treats
  // a non-indexed result as "configure your tariff" (routes to /settings) rather than
  // showing a flat, meaningless recommendation — see `app/plan/page.tsx` (`planTariff`).
  // We still return it here because the type is a faithful signal callers can branch on.
  const { data: any } = await client
    .from('tariffs')
    .select('id, country, type, formula')
    .eq('country', zone)
    .limit(1)
    .maybeSingle()
  return any ? normalize(any) : null
}

interface RawTariff {
  id: string
  country: string
  type: string
  formula: Record<string, unknown>
}

function normalize(row: RawTariff): PlanTariff {
  return {
    id: row.id,
    country: row.country as PlanTariff['country'],
    type: row.type as PlanTariff['type'],
    formula: row.formula as PlanTariff['formula'],
  }
}
