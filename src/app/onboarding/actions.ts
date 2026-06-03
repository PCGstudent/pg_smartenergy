'use server'

import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { z } from 'zod'
import { createSupabaseServer } from '@/lib/supabase/server'
import { insertAppliance } from '@/lib/db/appliance-queries'
import { ensureDefaultTariff } from '@/lib/db/onboarding-queries'
import {
  AVAILABILITY_PRESETS,
  labelKeyFor,
  loadDescriptionToAppliance,
  SELECTABLE_LOAD_PROFILES,
  type LoadDescription,
} from '@/lib/onboarding/load-presets'

/**
 * Onboarding server action.
 *
 * Always: persist country + onboarded_at + locale on the caller's profile (RLS = self).
 *
 * Light path (frictionless): when the user describes a primary load, we ALSO
 *   1. set a sensible default INDEXED tariff for their country (so the planner can price
 *      the FINAL curve immediately — no invoice required), and
 *   2. persist that load as an appliance,
 * then route them straight to `/plan` to see a real recommendation + monthly saving.
 *
 * When no load is described we keep the original behaviour and honour `next`.
 * Invoice upload stays an OPTIONAL accuracy upgrade — never a requirement here.
 */

const loadSchema = z.object({
  // Only the four real, selectable loads — the `'none'` skip sentinel is never sent
  // (the form omits `load` entirely when skipping), so it must not pass validation.
  profile: z.enum(SELECTABLE_LOAD_PROFILES),
  energyKwh: z.number().positive().max(500).optional(),
  availability: z.enum(AVAILABILITY_PRESETS).optional(),
  daysPerWeek: z.number().int().min(1).max(7).optional(),
})

const schema = z.object({
  country: z.enum(['PT', 'ES']),
  next: z
    .string()
    .regex(/^\/[a-zA-Z0-9_\-/?=&%]*$/)
    .default('/dashboard'),
  /** Optional primary-load description from the light path. Absent = country-only onboarding. */
  load: loadSchema.optional(),
})

export type OnboardingInput = z.infer<typeof schema>

/** Where to send the user after onboarding: the planner when they added a load, else `next`. */
const PLAN_ROUTE = '/plan'
/**
 * Fallback destination when a load was described but NO tariff could be defaulted (the
 * catalog has no plan for the country yet). Landing on /plan would only show a
 * "configure your tariff" prompt — /settings is the actionable first screen instead.
 */
const SETTINGS_ROUTE = '/settings'

export async function completeOnboarding(input: OnboardingInput) {
  const parsed = schema.safeParse(input)
  if (!parsed.success) {
    return { error: 'Invalid input.' }
  }
  const { country, load } = parsed.data

  const supabase = await createSupabaseServer()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Session expired. Sign in again.' }

  const { error } = await supabase
    .from('profiles')
    .update({
      country,
      onboarded_at: new Date().toISOString(),
      locale: country === 'ES' ? 'es' : 'pt',
    })
    .eq('id', user.id)

  if (error) {
    return { error: error.message }
  }

  // Light path: a described load gets a default tariff + an appliance, then → /plan.
  // `loadSchema` only admits the four real profiles, so `load` is already planner-ready.
  let destination = parsed.data.next
  if (load) {
    try {
      const provisioned = await provisionLightPath(supabase, user.id, country, {
        profile: load.profile,
        energyKwh: load.energyKwh,
        availability: load.availability,
        daysPerWeek: load.daysPerWeek,
      })
      // A described load → the planner, UNLESS no tariff exists for the country yet
      // (empty catalog): then send them to settings, the actionable first screen.
      destination = provisioned.tariffId ? PLAN_ROUTE : SETTINGS_ROUTE
    } catch (err) {
      // The user IS onboarded (country saved). A load-provisioning failure shouldn't
      // strand them — surface it so the form can show a non-fatal message and they can
      // retry adding the appliance from the planner.
      return { error: err instanceof Error ? err.message : 'Could not set up your load.' }
    }
  }

  // redirect throws — must be outside the try/catch.
  redirect(destination)
}

/**
 * Set a default indexed tariff (if the user has none) and persist the described load as
 * an appliance. Pure side-effect orchestration; validation already happened upstream.
 *
 * Returns the resulting `tariffId` (null = the catalog has no plan for the country, so the
 * caller routes to settings instead of the planner).
 */
async function provisionLightPath(
  supabase: Awaited<ReturnType<typeof createSupabaseServer>>,
  userId: string,
  country: 'PT' | 'ES',
  description: LoadDescription,
): Promise<{ tariffId: string | null }> {
  // 1. Default tariff so the planner can compute a FINAL price immediately.
  const tariff = await ensureDefaultTariff(supabase, userId, country)

  // 2. Localised appliance label from the shared plan.appliances.types.* namespace.
  const t = await getTranslations('plan.appliances')
  const label = t(`types.${labelKeyFor(description.profile)}`)

  // 3. Persist the load as an appliance the planner maps to a window.
  const appliance = loadDescriptionToAppliance(description, label)
  await insertAppliance(supabase, userId, appliance)

  return { tariffId: tariff.tariffId }
}
