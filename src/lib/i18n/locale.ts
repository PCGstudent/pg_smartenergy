import { cookies, headers } from 'next/headers'
import { defaultLocale, isLocale, type Locale } from '@/i18n/config'
import { getSession } from '@/lib/supabase/auth'

const LOCALE_COOKIE = 'NEXT_LOCALE'

/**
 * Resolve the active locale for the current request.
 *
 * Priority (highest → lowest):
 *  1. `NEXT_LOCALE` cookie — set by the in-app language switcher.
 *  2. `profiles.country` — `PT` → `pt`, `ES` → `es`. So a returning user
 *     who picked Spain at onboarding sees Spanish without doing anything.
 *  3. `Accept-Language` header — first matching locale we support.
 *  4. `defaultLocale` (`pt`).
 *
 * Failures bubble up as silent fallbacks so the app never 500s on locale
 * resolution.
 */
export async function resolveLocale(): Promise<Locale> {
  // 1. Explicit user choice via cookie.
  const fromCookie = await readCookieLocale()
  if (fromCookie) return fromCookie

  // 2. Profile country (PT/ES → pt/es).
  const fromProfile = await readProfileLocale()
  if (fromProfile) return fromProfile

  // 3. Browser Accept-Language.
  const fromHeader = await readHeaderLocale()
  if (fromHeader) return fromHeader

  // 4. Hardcoded fallback.
  return defaultLocale
}

async function readCookieLocale(): Promise<Locale | null> {
  try {
    const store = await cookies()
    const value = store.get(LOCALE_COOKIE)?.value
    return isLocale(value) ? value : null
  } catch {
    return null
  }
}

async function readProfileLocale(): Promise<Locale | null> {
  try {
    const session = await getSession()
    const country = session?.profile?.country
    if (country === 'PT') return 'pt'
    if (country === 'ES') return 'es'
    return null
  } catch {
    return null
  }
}

async function readHeaderLocale(): Promise<Locale | null> {
  try {
    const store = await headers()
    const accept = store.get('accept-language') ?? ''
    // Match the highest-quality entry whose language code is one of ours.
    // Format: "es-ES,es;q=0.9,pt;q=0.8,en;q=0.7".
    const candidates = accept
      .split(',')
      .map((entry: string) => entry.trim().split(';')[0]?.toLowerCase().split('-')[0])
      .filter((c: string | undefined): c is string => Boolean(c))
    for (const c of candidates) {
      if (isLocale(c)) return c
    }
    return null
  } catch {
    return null
  }
}

export const LOCALE_COOKIE_NAME = LOCALE_COOKIE
