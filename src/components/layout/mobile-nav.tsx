'use client'

import Link from 'next/link'
import { useLocale, useTranslations } from 'next-intl'
import { useCallback, useEffect, useId, useRef, useState, useTransition } from 'react'
import {
  Bell,
  Check,
  FileText,
  Globe2,
  Languages,
  LogOut,
  Menu,
  Settings2,
  User2,
  X,
  Zap,
} from 'lucide-react'
import { localeFlags, localeNames, locales, type Locale } from '@/i18n/config'
import { setLocale } from '@/lib/i18n/actions'
import { buildNavLinks } from '@/components/layout/nav-links'

export interface MobileNavProps {
  /** Whether a user session is present (gates auth-only links + account block). */
  isSignedIn: boolean
  /** Signed-in user's email, shown as a label in the account block. */
  email: string | null
}

const ICON_BY_KEY = {
  dashboard: Globe2,
  market: Zap,
  plan: Zap,
  auditor: FileText,
  alerts: Bell,
} as const

/**
 * Collapsed primary navigation for viewports below the `md` breakpoint.
 *
 * Renders a 44px hamburger toggle that opens a full-width drawer holding the
 * primary links plus, when signed in, the account actions that live in the
 * desktop `UserMenu` (the Radix dropdown does not translate to a stacked mobile
 * sheet, so its contents are mirrored here as plain rows).
 *
 * Accessibility:
 * - toggle exposes `aria-expanded` / `aria-controls`
 * - `Escape` closes and returns focus to the toggle
 * - focus moves into the drawer on open
 * - body scroll is locked while open
 * - every interactive row is at least 44px tall
 *
 * The whole island is `md:hidden`; the desktop inline nav (in `SiteNav`) takes
 * over at `md` and up.
 */
export function MobileNav({ isSignedIn, email }: MobileNavProps) {
  const tNav = useTranslations('nav')
  const tCommon = useTranslations('common')
  const tUserMenu = useTranslations('userMenu')
  const activeLocale = useLocale() as Locale

  const [open, setOpen] = useState(false)
  const [isPending, startTransition] = useTransition()
  const panelId = useId()
  const toggleRef = useRef<HTMLButtonElement>(null)
  const firstItemRef = useRef<HTMLAnchorElement>(null)

  const links = buildNavLinks(isSignedIn)

  const close = useCallback(() => {
    setOpen(false)
    // Return focus to the trigger so keyboard users are not stranded.
    toggleRef.current?.focus()
  }, [])

  // Esc-to-close + body scroll lock while the drawer is open.
  useEffect(() => {
    if (!open) return

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        close()
      }
    }

    document.addEventListener('keydown', onKeyDown)
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    // Move focus into the open drawer (first nav link).
    firstItemRef.current?.focus()

    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previousOverflow
    }
  }, [open, close])

  const onPickLocale = (next: Locale) => {
    if (next === activeLocale || isPending) return
    startTransition(async () => {
      await setLocale(next)
      close()
    })
  }

  return (
    <div className="md:hidden">
      <button
        ref={toggleRef}
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={open ? tNav('closeMenu') : tNav('openMenu')}
        className="grid h-11 w-11 place-items-center rounded-lg border border-border/60 bg-card/40 text-foreground transition hover:border-border hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
      </button>

      {open ? (
        <>
          {/* Backdrop — sits below the header, dims the page, closes on tap. */}
          <button
            type="button"
            aria-hidden="true"
            tabIndex={-1}
            onClick={close}
            className="fixed inset-x-0 bottom-0 top-16 z-40 bg-background/70 backdrop-blur-sm"
          />
          <div
            id={panelId}
            role="dialog"
            aria-modal="true"
            aria-label={tNav('openMenu')}
            className="fixed inset-x-0 top-16 z-50 max-h-[calc(100dvh-4rem)] overflow-y-auto border-b border-border/60 bg-background/95 backdrop-blur-xl"
          >
            <div className="container flex flex-col gap-1 py-3">
              {/* Primary links */}
              <nav aria-label={tNav('openMenu')} className="flex flex-col gap-1">
                {links.map((link, index) => {
                  const Icon = ICON_BY_KEY[link.labelKey]
                  return (
                    <Link
                      key={link.href}
                      ref={index === 0 ? firstItemRef : undefined}
                      href={link.href}
                      onClick={close}
                      className="flex min-h-[44px] items-center gap-3 rounded-lg px-3 text-[15px] text-muted-foreground transition hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                    >
                      <Icon className="h-4 w-4 shrink-0" />
                      {tNav(link.labelKey)}
                    </Link>
                  )
                })}
              </nav>

              {/* Language — ALWAYS visible, signed in or not. */}
              <div className="my-1 h-px bg-border/60" />
              <p className="flex items-center gap-2 px-3 py-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                <Languages className="h-3 w-3" />
                {tUserMenu('language')}
              </p>
              {locales.map((loc) => {
                const active = loc === activeLocale
                return (
                  <button
                    key={loc}
                    type="button"
                    onClick={() => onPickLocale(loc)}
                    disabled={isPending}
                    aria-current={active ? 'true' : undefined}
                    className="flex min-h-[44px] items-center gap-3 rounded-lg px-3 text-[15px] text-muted-foreground transition hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:opacity-60"
                  >
                    <span className="text-base leading-none">{localeFlags[loc]}</span>
                    <span className="flex-1 text-left">{localeNames[loc]}</span>
                    {active ? <Check className="h-4 w-4 text-primary" /> : null}
                  </button>
                )
              })}

              {isSignedIn ? (
                <>
                  <div className="my-1 h-px bg-border/60" />
                  <p className="flex min-h-[44px] items-center gap-3 px-3 text-sm text-muted-foreground">
                    <User2 className="h-4 w-4 shrink-0" />
                    <span className="truncate">{email ?? '—'}</span>
                  </p>
                  <Link
                    href="/settings"
                    onClick={close}
                    className="flex min-h-[44px] items-center gap-3 rounded-lg px-3 text-[15px] text-muted-foreground transition hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                  >
                    <Settings2 className="h-4 w-4 shrink-0" />
                    {tCommon('settings')}
                  </Link>

                  {/* Sign out */}
                  <div className="my-1 h-px bg-border/60" />
                  <form action="/auth/signout" method="POST">
                    <button
                      type="submit"
                      onClick={close}
                      className="flex min-h-[44px] w-full items-center gap-3 rounded-lg px-3 text-left text-[15px] text-destructive transition hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                    >
                      <LogOut className="h-4 w-4 shrink-0" />
                      {tCommon('signOut')}
                    </button>
                  </form>
                </>
              ) : (
                <>
                  <div className="my-1 h-px bg-border/60" />
                  <Link
                    href="/signin"
                    onClick={close}
                    className="flex min-h-[44px] items-center justify-center gap-2 rounded-lg bg-primary px-3 text-[15px] font-medium text-primary-foreground transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                  >
                    {tNav('signIn')}
                  </Link>
                </>
              )}
            </div>
          </div>
        </>
      ) : null}
    </div>
  )
}
