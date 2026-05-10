'use server'

import { redirect } from 'next/navigation'
import { z } from 'zod'
import { createSupabaseServer } from '@/lib/supabase/server'

const schema = z.object({
  country: z.enum(['PT', 'ES']),
  next: z.string().regex(/^\/[a-zA-Z0-9_\-/?=&%]*$/).default('/dashboard'),
})

/**
 * Server Action invoked from the onboarding form.
 * Saves country + onboarded_at on the caller's profile (RLS limits to self).
 * Returns an `{ error }` object on failure, otherwise redirects.
 */
export async function completeOnboarding(input: { country: 'PT' | 'ES'; next: string }) {
  const parsed = schema.safeParse(input)
  if (!parsed.success) {
    return { error: 'Invalid input.' }
  }

  const supabase = await createSupabaseServer()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Session expired. Sign in again.' }

  const { error } = await supabase
    .from('profiles')
    .update({
      country: parsed.data.country,
      onboarded_at: new Date().toISOString(),
      locale: parsed.data.country === 'ES' ? 'es' : 'pt',
    })
    .eq('id', user.id)

  if (error) {
    return { error: error.message }
  }

  // redirect throws — must be outside the try/catch.
  redirect(parsed.data.next)
}
