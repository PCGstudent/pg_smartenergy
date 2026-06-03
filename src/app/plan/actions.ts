'use server'

import { revalidatePath } from 'next/cache'
import { getTranslations } from 'next-intl/server'
import { z } from 'zod'
import { createSupabaseServer } from '@/lib/supabase/server'
import {
  APPLIANCE_NOT_FOUND,
  APPLIANCE_TYPES,
  deleteAppliance as deleteApplianceRow,
  insertAppliance,
  updateAppliance as updateApplianceRow,
} from '@/lib/db/appliance-queries'

/**
 * Server actions for the user's appliances (loads). Mirrors `app/alerts/actions.ts`:
 * Zod at the boundary, RLS-enforced Supabase client, revalidate the page, translated
 * errors. All numbers are validated to sane ranges so the planner never sees garbage.
 */

const HOUR = z.number().int().min(0).max(24)

const baseShape = {
  label: z.string().trim().min(1).max(80),
  type: z.enum(APPLIANCE_TYPES),
  energyKwh: z.number().positive().max(500),
  powerKw: z.number().positive().max(50),
  typicalDurationMin: z.number().int().positive().max(1440).nullable().optional(),
  interruptible: z.boolean(),
  earliestHour: HOUR,
  latestHour: HOUR,
}

const createSchema = z
  .object(baseShape)
  .refine((v) => v.earliestHour < v.latestHour, {
    message: 'windowOrder',
    path: ['latestHour'],
  })

const updateSchema = z
  .object({
    label: baseShape.label.optional(),
    type: baseShape.type.optional(),
    energyKwh: baseShape.energyKwh.optional(),
    powerKw: baseShape.powerKw.optional(),
    typicalDurationMin: baseShape.typicalDurationMin,
    interruptible: z.boolean().optional(),
    earliestHour: HOUR.optional(),
    latestHour: HOUR.optional(),
    active: z.boolean().optional(),
  })
  .refine(
    (v) => v.earliestHour === undefined || v.latestHour === undefined || v.earliestHour < v.latestHour,
    { message: 'windowOrder', path: ['latestHour'] },
  )

export type CreateApplianceInput = z.infer<typeof createSchema>
export type UpdateApplianceInput = z.infer<typeof updateSchema>

interface ActionResult {
  ok?: boolean
  id?: string
  error?: string
}

export async function createAppliance(input: CreateApplianceInput): Promise<ActionResult> {
  const t = await getTranslations('plan.errors')
  const parsed = createSchema.safeParse(input)
  if (!parsed.success) return { error: validationMessage(t, parsed.error) }

  const supa = await createSupabaseServer()
  const {
    data: { user },
  } = await supa.auth.getUser()
  if (!user) return { error: t('signIn') }

  try {
    const { id } = await insertAppliance(supa, user.id, {
      label: parsed.data.label,
      type: parsed.data.type,
      energyKwh: parsed.data.energyKwh,
      powerKw: parsed.data.powerKw,
      typicalDurationMin: parsed.data.typicalDurationMin ?? null,
      interruptible: parsed.data.interruptible,
      earliestHour: parsed.data.earliestHour,
      latestHour: parsed.data.latestHour,
    })
    revalidatePath('/plan')
    return { ok: true, id }
  } catch (err) {
    return { error: err instanceof Error ? err.message : t('couldNotCreate') }
  }
}

export async function updateAppliance(
  id: string,
  input: UpdateApplianceInput,
): Promise<ActionResult> {
  const t = await getTranslations('plan.errors')
  const parsed = updateSchema.safeParse(input)
  if (!parsed.success) return { error: validationMessage(t, parsed.error) }

  const supa = await createSupabaseServer()
  const {
    data: { user },
  } = await supa.auth.getUser()
  if (!user) return { error: t('signIn') }

  try {
    await updateApplianceRow(supa, id, parsed.data)
    revalidatePath('/plan')
    return { ok: true }
  } catch (err) {
    if (err instanceof Error && err.message === APPLIANCE_NOT_FOUND)
      return { error: t('couldNotUpdate') }
    return { error: err instanceof Error ? err.message : t('couldNotUpdate') }
  }
}

export async function deleteAppliance(id: string): Promise<ActionResult> {
  const t = await getTranslations('plan.errors')
  const supa = await createSupabaseServer()
  const {
    data: { user },
  } = await supa.auth.getUser()
  if (!user) return { error: t('signIn') }

  try {
    await deleteApplianceRow(supa, id)
    revalidatePath('/plan')
    return { ok: true }
  } catch (err) {
    if (err instanceof Error && err.message === APPLIANCE_NOT_FOUND)
      return { error: t('couldNotDelete') }
    return { error: err instanceof Error ? err.message : t('couldNotDelete') }
  }
}

/** Map a Zod error to a friendly, translated message (falls back to a generic one). */
function validationMessage(
  t: Awaited<ReturnType<typeof getTranslations>>,
  error: z.ZodError,
): string {
  const hasWindowOrder = error.issues.some((i) => i.message === 'windowOrder')
  if (hasWindowOrder) return t('windowOrder')
  return t('invalidInput')
}
