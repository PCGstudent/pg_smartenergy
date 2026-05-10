import { createSupabaseServer } from './server'

export interface AuthSession {
  user: { id: string; email?: string }
  profile: {
    country: 'PT' | 'ES' | null
    onboardedAt: string | null
    locale: string | null
  } | null
}

/**
 * Returns the current user + their profile in one call.
 * Use in Server Components and Route Handlers.
 * Returns null when no user is signed in (RLS may also block reads otherwise).
 */
export async function getSession(): Promise<AuthSession | null> {
  const supabase = await createSupabaseServer()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null

  const { data: profile } = await supabase
    .from('profiles')
    .select('country, onboarded_at, locale')
    .eq('id', user.id)
    .maybeSingle()

  return {
    user: { id: user.id, email: user.email ?? undefined },
    profile: profile
      ? {
          country: (profile.country as 'PT' | 'ES' | null) ?? null,
          onboardedAt: (profile.onboarded_at as string | null) ?? null,
          locale: (profile.locale as string | null) ?? null,
        }
      : null,
  }
}
