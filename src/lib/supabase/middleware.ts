import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

/**
 * Routes that require an authenticated session.
 * The dashboard is intentionally NOT here — public OMIE data should be browseable.
 */
const PROTECTED_PREFIXES = ['/auditor', '/alerts', '/settings', '/onboarding']

/** Routes that should redirect away when already signed in. */
const AUTH_PREFIXES = ['/signin']

/**
 * Refreshes the Supabase session cookie on every request, then enforces
 * route guards for protected and auth-only paths.
 *
 * Mounted from `src/middleware.ts`.
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request })

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anon) {
    // Without Supabase configured we just no-op; routes still render.
    return response
  }

  const supabase = createServerClient(url, anon, {
    cookies: {
      getAll() {
        return request.cookies.getAll()
      },
      setAll(cookiesToSet: Array<{ name: string; value: string; options: CookieOptions }>) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
        response = NextResponse.next({ request })
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        )
      },
    },
  })

  // IMPORTANT: do not run any code between createServerClient and getUser —
  // doing so risks logging users out at random.
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const path = request.nextUrl.pathname
  const isProtected = PROTECTED_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`))
  const isAuthRoute = AUTH_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`))

  if (isProtected && !user) {
    const target = request.nextUrl.clone()
    target.pathname = '/signin'
    target.searchParams.set('next', path)
    return NextResponse.redirect(target)
  }

  if (isAuthRoute && user) {
    const target = request.nextUrl.clone()
    target.pathname = '/dashboard'
    target.search = ''
    return NextResponse.redirect(target)
  }

  return response
}
