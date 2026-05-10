'use client'

import { useLocale, useTranslations } from 'next-intl'
import { useTransition } from 'react'
import { Check, Languages } from 'lucide-react'
import { locales, localeFlags, localeNames, type Locale } from '@/i18n/config'
import { setLocale } from '@/lib/i18n/actions'
import {
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu'

/**
 * Language picker rendered inside the user menu dropdown.
 *
 * Uses a server action so the cookie is set HttpOnly-style by the platform,
 * not by client JS — same trust model as the Supabase session cookie.
 *
 * `useTransition` keeps the UI responsive while the server revalidates the
 * layout. The chosen language gets re-rendered with `revalidatePath('/', 'layout')`
 * on the next paint.
 */
export function LanguageSwitcher() {
  const t = useTranslations('userMenu')
  const current = useLocale() as Locale
  const [isPending, startTransition] = useTransition()

  const onPick = (next: Locale) => {
    if (next === current || isPending) return
    startTransition(async () => {
      await setLocale(next)
    })
  }

  return (
    <>
      <DropdownMenuSeparator />
      <DropdownMenuLabel className="flex items-center gap-2">
        <Languages className="h-3 w-3" />
        {t('language')}
      </DropdownMenuLabel>
      {locales.map((loc) => {
        const active = loc === current
        return (
          <DropdownMenuItem
            key={loc}
            onSelect={(event) => {
              // Keep the menu open while the transition runs so the user
              // sees the checkmark land before it closes.
              event.preventDefault()
              onPick(loc)
            }}
            className="cursor-pointer"
            data-active={active}
          >
            <span className="text-base leading-none">{localeFlags[loc]}</span>
            <span className="flex-1">{localeNames[loc]}</span>
            {active ? <Check className="h-3 w-3 text-primary" /> : null}
          </DropdownMenuItem>
        )
      })}
    </>
  )
}
