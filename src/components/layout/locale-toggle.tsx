'use client'

import { useLocale } from 'next-intl'
import { useTransition } from 'react'
import { locales, localeFlags, localeNames, type Locale } from '@/i18n/config'
import { setLocale } from '@/lib/i18n/actions'

/**
 * Standalone language toggle for the top bar — visible to EVERYONE, signed in or
 * not (the in-menu LanguageSwitcher only shows after login). Renders the three
 * locale flags inline; the active one is highlighted. Clicking sets the locale
 * cookie via a server action and re-renders the layout in the chosen language.
 */
export function LocaleToggle() {
  const current = useLocale() as Locale
  const [isPending, startTransition] = useTransition()

  const onPick = (next: Locale) => {
    if (next === current || isPending) return
    startTransition(async () => {
      await setLocale(next)
    })
  }

  return (
    <div
      className="flex items-center gap-0.5 rounded-md border border-border/60 bg-card/40 p-0.5"
      role="group"
      aria-label={localeNames[current]}
    >
      {locales.map((loc) => {
        const active = loc === current
        return (
          <button
            key={loc}
            type="button"
            onClick={() => onPick(loc)}
            disabled={isPending}
            aria-pressed={active}
            aria-label={localeNames[loc]}
            title={localeNames[loc]}
            className={`flex h-7 min-w-7 items-center justify-center rounded px-1.5 text-base leading-none transition ${
              active
                ? 'bg-primary/15 ring-1 ring-primary/40'
                : 'opacity-60 hover:bg-secondary hover:opacity-100'
            } disabled:cursor-not-allowed`}
          >
            <span aria-hidden>{localeFlags[loc]}</span>
            <span className="sr-only">{localeNames[loc]}</span>
          </button>
        )
      })}
    </div>
  )
}
