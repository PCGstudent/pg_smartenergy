'use server'

import { revalidatePath } from 'next/cache'
import { getTranslations } from 'next-intl/server'
import { z } from 'zod'
import { createSupabaseServer } from '@/lib/supabase/server'
import {
  deleteAlert as deleteAlertRow,
  insertAlert,
  updateAlert as updateAlertRow,
} from '@/lib/db/alert-queries'

const ALERT_TYPES = ['cheap_hour', 'free_energy', 'spike', 'negative'] as const

const channelsSchema = z
  .array(z.enum(['push', 'whatsapp']))
  .min(1, 'Pick at least one delivery channel.')

const scheduleSchema = z
  .object({
    quietStartHour: z.number().int().min(0).max(23).optional(),
    quietEndHour: z.number().int().min(0).max(23).optional(),
    weekdays: z.array(z.number().int().min(1).max(7)).optional(),
  })
  .nullable()
  .optional()

const createSchema = z.object({
  type: z.enum(ALERT_TYPES),
  thresholdEurMwh: z
    .number()
    .min(-200)
    .max(1000)
    .nullable()
    .optional(),
  channels: channelsSchema,
  schedule: scheduleSchema,
})

const updateSchema = createSchema.partial().extend({
  active: z.boolean().optional(),
})

export type CreateAlertInput = z.infer<typeof createSchema>
export type UpdateAlertInput = z.infer<typeof updateSchema>

interface ActionResult {
  ok?: boolean
  id?: string
  error?: string
}

export async function createAlert(input: CreateAlertInput): Promise<ActionResult> {
  const t = await getTranslations('alerts.errors')
  const parsed = createSchema.safeParse(input)
  if (!parsed.success) {
    return { error: parsed.error.issues.map((i) => i.message).join(' · ') }
  }

  const supa = await createSupabaseServer()
  const {
    data: { user },
  } = await supa.auth.getUser()
  if (!user) return { error: t('signInCreate') }

  // free_energy / negative ignore threshold — coerce to null.
  const threshold =
    parsed.data.type === 'free_energy' || parsed.data.type === 'negative'
      ? null
      : (parsed.data.thresholdEurMwh ?? null)

  try {
    const result = await insertAlert(supa, {
      user_id: user.id,
      type: parsed.data.type,
      threshold_eur_mwh: threshold,
      channels: parsed.data.channels,
      schedule: parsed.data.schedule ?? null,
    })
    revalidatePath('/alerts')
    return { ok: true, id: result.id }
  } catch (err) {
    return { error: err instanceof Error ? err.message : t('couldNotCreate') }
  }
}

export async function updateAlert(id: string, input: UpdateAlertInput): Promise<ActionResult> {
  const t = await getTranslations('alerts.errors')
  const parsed = updateSchema.safeParse(input)
  if (!parsed.success) {
    return { error: parsed.error.issues.map((i) => i.message).join(' · ') }
  }

  const supa = await createSupabaseServer()
  const {
    data: { user },
  } = await supa.auth.getUser()
  if (!user) return { error: t('signInUpdate') }

  const patch: Parameters<typeof updateAlertRow>[2] = {}
  if (parsed.data.type) patch.type = parsed.data.type
  if (parsed.data.thresholdEurMwh !== undefined) patch.threshold_eur_mwh = parsed.data.thresholdEurMwh
  if (parsed.data.channels) patch.channels = parsed.data.channels
  if (parsed.data.schedule !== undefined) patch.schedule = parsed.data.schedule ?? null
  if (parsed.data.active !== undefined) patch.active = parsed.data.active

  try {
    await updateAlertRow(supa, id, patch)
    revalidatePath('/alerts')
    return { ok: true }
  } catch (err) {
    return { error: err instanceof Error ? err.message : t('couldNotUpdate') }
  }
}

export async function deleteAlert(id: string): Promise<ActionResult> {
  const t = await getTranslations('alerts.errors')
  const supa = await createSupabaseServer()
  const {
    data: { user },
  } = await supa.auth.getUser()
  if (!user) return { error: t('signInDelete') }

  try {
    await deleteAlertRow(supa, id)
    revalidatePath('/alerts')
    return { ok: true }
  } catch (err) {
    return { error: err instanceof Error ? err.message : t('couldNotDelete') }
  }
}
