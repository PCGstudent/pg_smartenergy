import { NextResponse } from 'next/server'
import { createSupabaseServer } from '@/lib/supabase/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Magic-link callback.
 *
 * Supabase appends `?code=<otp>` (PKCE flow) — we exchange it for a session,
 * then route the user based on profile state:
 *
 *   no session     → /signin?error=callback_failed
 *   no profile     → /onboarding (trigger should have created one; this is a safety net)
 *   onboarded_at?  → /onboarding
 *   onboarded      → ?next=… or /dashboard
 */
export async function GET(request: Request) {
  const url = new URL(request.url)
  const code = url.searchParams.get('code')
  const next = url.searchParams.get('next') ?? '/dashboard'
  const errorDescription = url.searchParams.get('error_description')

  if (errorDescription) {
    const target = new URL('/signin', url.origin)
    target.searchParams.set('error', errorDescription)
    return NextResponse.redirect(target)
  }

  if (!code) {
    const target = new URL('/signin', url.origin)
    target.searchParams.set('error', 'missing_code')
    return NextResponse.redirect(target)
  }

  const supabase = await createSupabaseServer()
  const { error } = await supabase.auth.exchangeCodeForSession(code)
  if (error) {
    const target = new URL('/signin', url.origin)
    target.searchParams.set('error', error.message)
    return NextResponse.redirect(target)
  }

  // Determine post-login destination based on profile state.
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.redirect(new URL('/signin?error=session_lost', url.origin))
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('onboarded_at')
    .eq('id', user.id)
    .maybeSingle()

  if (!profile?.onboarded_at) {
    const target = new URL('/onboarding', url.origin)
    if (next && next !== '/dashboard') target.searchParams.set('next', next)
    return NextResponse.redirect(target)
  }

  return NextResponse.redirect(new URL(next, url.origin))
}
