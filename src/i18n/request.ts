import { getRequestConfig } from 'next-intl/server'
import { resolveLocale } from '@/lib/i18n/locale'

/**
 * next-intl request config. Loaded once per request via the plugin in
 * `next.config.ts`. We resolve the active locale ourselves (cookie →
 * profile.country → Accept-Language → default) and lazy-load the matching
 * messages file.
 *
 * Without internationalized routing — paths stay clean (`/dashboard`,
 * not `/pt/dashboard`). For a SaaS with authenticated users and a stored
 * `profiles.country`, locale-from-profile is more natural than URL prefixes.
 */
export default getRequestConfig(async () => {
  const locale = await resolveLocale()

  return {
    locale,
    messages: (await import(`../../messages/${locale}.json`)).default,
    timeZone: 'Europe/Madrid',
  }
})
