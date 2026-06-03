/**
 * Voltwise locale config.
 *
 * Single source of truth for the supported languages. Used by:
 * - `src/i18n/request.ts` — next-intl request config
 * - `src/lib/i18n/locale.ts` — server helpers
 * - `src/components/layout/language-switcher.tsx` — UI
 */

export const locales = ['pt', 'es', 'en'] as const
export type Locale = (typeof locales)[number]

export const defaultLocale: Locale = 'pt'

export const localeNames: Record<Locale, string> = {
  pt: 'Português',
  es: 'Español',
  en: 'English',
}

export const localeFlags: Record<Locale, string> = {
  pt: '🇵🇹',
  es: '🇪🇸',
  en: '🇬🇧',
}

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (locales as readonly string[]).includes(value)
}
