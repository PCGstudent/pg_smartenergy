'use server'

import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { getSession } from '@/lib/supabase/auth'
import { createSupabaseServer } from '@/lib/supabase/server'

/**
 * Iberian mobile in E.164: a +351 (PT) or +34 (ES) prefix followed by 9 digits.
 * We only message Iberian users, so we constrain to those two country codes — both
 * the WhatsApp Cloud sender and the alert delivery seam expect an E.164 number.
 */
const WHATSAPP_E164 = /^\+(351|34)\d{9}$/

export async function saveSettings(formData: FormData): Promise<{ error: string } | void> {
  const session = await getSession()
  if (!session) redirect('/signin')

  const t = await getTranslations('settings.errors')

  const contractedKvaRaw = formData.get('contracted_kva')?.toString().trim()
  const country = formData.get('country')?.toString() as 'PT' | 'ES' | undefined
  const displayName = formData.get('display_name')?.toString().trim() ?? null
  // Strip spaces so "+351 912 345 678" pasted from a contacts app still validates.
  const whatsappRaw = formData.get('whatsapp_e164')?.toString().replace(/\s+/g, '') ?? ''

  let contractedKva: number | null = null
  if (contractedKvaRaw && contractedKvaRaw !== '') {
    const parsed = parseFloat(contractedKvaRaw.replace(',', '.'))
    if (isNaN(parsed) || parsed <= 0 || parsed > 100) {
      return { error: t('invalidKva') }
    }
    contractedKva = Math.round(parsed * 100) / 100
  }

  // Empty = clear the number (null). Otherwise it must be a valid PT/ES E.164 number.
  let whatsappE164: string | null = null
  if (whatsappRaw !== '') {
    if (!WHATSAPP_E164.test(whatsappRaw)) {
      return { error: t('invalidWhatsapp') }
    }
    whatsappE164 = whatsappRaw
  }

  if (country && country !== 'PT' && country !== 'ES') {
    return { error: t('invalidCountry') }
  }

  const supa = await createSupabaseServer()
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (contractedKva !== null) patch.contracted_kva = contractedKva
  if (country) patch.country = country
  if (displayName !== null) patch.display_name = displayName || null
  // Always write whatsapp_e164 (including null) so the user can CLEAR a saved number.
  patch.whatsapp_e164 = whatsappE164

  const { error } = await supa.from('profiles').update(patch).eq('id', session.user.id)
  if (error) return { error: t('saveFailed') }
}
