import { NextResponse } from 'next/server'
import { createSupabaseServer } from '@/lib/supabase/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Sign out and bounce back to the landing page.
 * Use a form POST from the user menu (CSRF-safe via SameSite cookies).
 */
export async function POST(request: Request) {
  const supabase = await createSupabaseServer()
  await supabase.auth.signOut()
  // 303 = "see other" so browser follows with GET (avoids re-POSTing the redirect target).
  return NextResponse.redirect(new URL('/', request.url), { status: 303 })
}
