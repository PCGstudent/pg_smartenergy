'use server'

import { cookies } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { isLocale, type Locale } from '@/i18n/config'
import { LOCALE_COOKIE_NAME } from '@/lib/i18n/locale'

/**
 * Server action: persist the user's language choice in a cookie.
 *
 * One-year persistence so the choice survives across visits, and SameSite=Lax
 * so it works on cross-site navigation (e.g. clicking a magic-link email).
 *
 * `revalidatePath('/', 'layout')` re-renders every server component below the
 * root layout with the new locale on the very next render — no hard reload.
 */
export async function setLocale(next: Locale): Promise<void> {
  if (!isLocale(next)) return
  const store = await cookies()
  store.set(LOCALE_COOKIE_NAME, next, {
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
  })
  revalidatePath('/', 'layout')
}
