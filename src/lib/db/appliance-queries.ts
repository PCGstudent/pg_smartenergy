import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Supabase-side CRUD for `user_appliances` (a user's shiftable loads).
 *
 * Mirrors `alert-queries.ts`: every function takes a `SupabaseClient` so the
 * caller picks the security context (RLS-enforced `createSupabaseServer()` for
 * user-facing reads/writes). RLS guarantees a user only ever sees their own rows.
 */

/** Known appliance categories. Free text on the DB; the app constrains to this set. */
export const APPLIANCE_TYPES = [
  'ev',
  'washer',
  'dishwasher',
  'water_heater',
  'home_battery',
  'dryer',
  'pool_pump',
  'other',
] as const

export type ApplianceType = (typeof APPLIANCE_TYPES)[number]

/** Row as stored in Postgres. numeric columns arrive as strings via PostgREST. */
export interface ApplianceRow {
  id: string
  user_id: string
  label: string
  type: ApplianceType
  energy_kwh: string | number
  power_kw: string | number
  typical_duration_min: number | null
  interruptible: boolean
  earliest_hour: number
  latest_hour: number
  active: boolean
  created_at: string
  updated_at: string
}

/** Decoded, numeric view of an appliance — what the planner and UI consume. */
export interface Appliance {
  id: string
  userId: string
  label: string
  type: ApplianceType
  energyKwh: number
  powerKw: number
  typicalDurationMin: number | null
  interruptible: boolean
  earliestHour: number
  latestHour: number
  active: boolean
  createdAt: string
  updatedAt: string
}

/** Fields a caller may set on create. */
export interface ApplianceInput {
  label: string
  type: ApplianceType
  energyKwh: number
  powerKw: number
  typicalDurationMin: number | null
  interruptible: boolean
  earliestHour: number
  latestHour: number
}

/** Normalize a DB row (string numerics) into the numeric domain shape. */
export function decodeAppliance(row: ApplianceRow): Appliance {
  return {
    id: row.id,
    userId: row.user_id,
    label: row.label,
    type: row.type,
    energyKwh: Number(row.energy_kwh),
    powerKw: Number(row.power_kw),
    typicalDurationMin: row.typical_duration_min,
    interruptible: row.interruptible,
    earliestHour: row.earliest_hour,
    latestHour: row.latest_hour,
    active: row.active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export async function listAppliancesForUser(
  client: SupabaseClient,
  userId: string,
): Promise<Appliance[]> {
  const { data, error } = await client
    .from('user_appliances')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: true })
  if (error) throw error
  return (data ?? []).map((r) => decodeAppliance(r as ApplianceRow))
}

/** Active loads only — the set the planner maps to windows. */
export async function listActiveAppliancesForUser(
  client: SupabaseClient,
  userId: string,
): Promise<Appliance[]> {
  const { data, error } = await client
    .from('user_appliances')
    .select('*')
    .eq('user_id', userId)
    .eq('active', true)
    .order('created_at', { ascending: true })
  if (error) throw error
  return (data ?? []).map((r) => decodeAppliance(r as ApplianceRow))
}

export async function getApplianceById(
  client: SupabaseClient,
  id: string,
): Promise<Appliance | null> {
  const { data, error } = await client
    .from('user_appliances')
    .select('*')
    .eq('id', id)
    .maybeSingle()
  if (error) throw error
  return data ? decodeAppliance(data as ApplianceRow) : null
}

export async function insertAppliance(
  client: SupabaseClient,
  userId: string,
  input: ApplianceInput,
): Promise<{ id: string }> {
  const { data, error } = await client
    .from('user_appliances')
    .insert({
      user_id: userId,
      label: input.label,
      type: input.type,
      energy_kwh: input.energyKwh,
      power_kw: input.powerKw,
      typical_duration_min: input.typicalDurationMin,
      interruptible: input.interruptible,
      earliest_hour: input.earliestHour,
      latest_hour: input.latestHour,
      active: true,
    })
    .select('id')
    .single()
  if (error) throw error
  return data as { id: string }
}

/**
 * Thrown when an update/delete affected zero rows: the id does not exist, was
 * already removed (race), or RLS filtered it because it belongs to another user.
 * Surfacing this prevents a deceptive "saved!" toast when nothing persisted.
 */
export const APPLIANCE_NOT_FOUND = 'appliance_not_found'

export async function updateAppliance(
  client: SupabaseClient,
  id: string,
  patch: Partial<ApplianceInput & { active: boolean }>,
): Promise<void> {
  const row: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (patch.label !== undefined) row.label = patch.label
  if (patch.type !== undefined) row.type = patch.type
  if (patch.energyKwh !== undefined) row.energy_kwh = patch.energyKwh
  if (patch.powerKw !== undefined) row.power_kw = patch.powerKw
  if (patch.typicalDurationMin !== undefined) row.typical_duration_min = patch.typicalDurationMin
  if (patch.interruptible !== undefined) row.interruptible = patch.interruptible
  if (patch.earliestHour !== undefined) row.earliest_hour = patch.earliestHour
  if (patch.latestHour !== undefined) row.latest_hour = patch.latestHour
  if (patch.active !== undefined) row.active = patch.active

  // `.select('id').single()` makes PostgREST return the affected row. With 0 rows
  // affected (already deleted, or RLS-filtered as another user's), `single()` errors —
  // so a silent no-op becomes a real failure the UI can show.
  const { data, error } = await client
    .from('user_appliances')
    .update(row)
    .eq('id', id)
    .select('id')
    .single()
  if (error || !data) throw new Error(APPLIANCE_NOT_FOUND)
}

export async function deleteAppliance(client: SupabaseClient, id: string): Promise<void> {
  // `.select('id')` returns the deleted rows; an empty array means nothing matched
  // (already gone, or RLS-filtered). Treat that as not-found instead of a false success.
  const { data, error } = await client
    .from('user_appliances')
    .delete()
    .eq('id', id)
    .select('id')
  if (error) throw error
  if (!data || data.length === 0) throw new Error(APPLIANCE_NOT_FOUND)
}
