import { NextResponse } from 'next/server'
import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { createSupabaseService } from '@/lib/supabase/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * DEV-ONLY login bypass for automated UX evaluation (Playwright agents).
 *
 * Hard-guarded: returns 403 unless NODE_ENV === 'development'. NEVER ships to prod
 * (a production build sets NODE_ENV=production, so this endpoint is inert there).
 *
 *   GET /api/dev-login?email=ux-test@voltwise.local&next=/plan
 *
 * It ensures the test user exists (service role), mints a magic-link OTP for them,
 * verifies it server-side so the SSR cookie jar gets a real session, then redirects.
 */
const DEFAULT_EMAIL = 'ux-test@voltwise.local'

export async function GET(request: Request) {
  if (process.env.NODE_ENV !== 'development') {
    return NextResponse.json({ error: 'dev-login is disabled outside development' }, { status: 403 })
  }

  const url = new URL(request.url)
  const email = url.searchParams.get('email') ?? DEFAULT_EMAIL
  const next = url.searchParams.get('next') ?? '/plan'

  const admin = createSupabaseService()

  // 1. Ensure the user exists (idempotent).
  try {
    await admin.auth.admin.createUser({ email, email_confirm: true })
  } catch {
    // Already exists — fine.
  }

  // 2. Generate a magic-link OTP for this email.
  const { data: link, error: linkErr } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email,
  })
  if (linkErr || !link?.properties?.hashed_token) {
    return NextResponse.json({ error: linkErr?.message ?? 'could not generate link' }, { status: 500 })
  }

  // 3. Verify the OTP through an SSR client so the session lands in the cookie jar.
  const supaUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  const cookieStore = await cookies()
  const res = NextResponse.redirect(new URL(next, url.origin))
  const supabase = createServerClient(supaUrl, anon, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (toSet: Array<{ name: string; value: string; options: CookieOptions }>) =>
        toSet.forEach(({ name, value, options }) => res.cookies.set(name, value, options)),
    },
  })

  const { error: vErr } = await supabase.auth.verifyOtp({
    type: 'magiclink',
    token_hash: link.properties.hashed_token,
  })
  if (vErr) {
    return NextResponse.json({ error: vErr.message }, { status: 500 })
  }

  return res
}
