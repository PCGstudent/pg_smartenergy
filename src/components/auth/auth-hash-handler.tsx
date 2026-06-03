'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createSupabaseBrowser } from '@/lib/supabase/client'

/**
 * Handles implicit-flow magic links that redirect to the root with
 * `#access_token=…` in the URL fragment.  The server never sees the hash,
 * so we need a client component to pick it up and turn it into a session.
 *
 * Mount this on any public page that Supabase uses as the redirect target
 * (currently the root `/`).
 */
export function AuthHashHandler() {
  const router = useRouter()

  useEffect(() => {
    if (typeof window === 'undefined') return
    const hash = window.location.hash
    if (!hash.includes('access_token')) return

    const params = new URLSearchParams(hash.slice(1))
    const accessToken = params.get('access_token')
    const refreshToken = params.get('refresh_token')
    if (!accessToken || !refreshToken) return

    const supabase = createSupabaseBrowser()
    supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken }).then(
      ({ data, error }) => {
        if (!error && data.session) {
          // Hard navigation so the server-side middleware sees the new session cookie.
          window.location.replace('/dashboard')
        }
      },
    )
  }, [router])

  return null
}
