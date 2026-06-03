import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { Zap } from 'lucide-react'
import { getSession } from '@/lib/supabase/auth'
import { UserMenu } from '@/components/auth/user-menu'
import { MobileNav } from '@/components/layout/mobile-nav'
import { LocaleToggle } from '@/components/layout/locale-toggle'
import { buildNavLinks } from '@/components/layout/nav-links'

/**
 * Server component — reads the Supabase session per request.
 * Calling cookies() (via getSession) automatically opts the layout out
 * of static rendering, so the menu always reflects the current user.
 *
 * Two nav surfaces share one link model (`buildNavLinks`):
 * - `md` and up: the inline horizontal nav below.
 * - below `md`: the collapsed `<MobileNav>` drawer, which also mirrors the
 *   account actions from `<UserMenu>`.
 */
export async function SiteNav() {
  const [session, t] = await Promise.all([safeSession(), getTranslations('nav')])
  const isSignedIn = Boolean(session?.user)
  const links = buildNavLinks(isSignedIn)

  return (
    <header className="sticky top-0 z-40 w-full border-b border-border/50 bg-background/60 backdrop-blur-xl">
      <div className="container flex h-16 items-center justify-between">
        <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-primary/10 ring-1 ring-primary/30">
            <Zap className="h-4 w-4 text-primary" />
          </span>
          <span className="text-base">Voltwise</span>
        </Link>

        {/* Desktop: full inline nav (md and up). */}
        <nav className="hidden items-center gap-1 text-sm md:flex">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="rounded-md px-3 py-1.5 text-muted-foreground transition hover:bg-secondary hover:text-foreground"
            >
              {t(link.labelKey)}
            </Link>
          ))}
          {/* Language toggle — always visible, signed in or not. */}
          <div className="ml-2">
            <LocaleToggle />
          </div>
          {session?.user ? (
            <div className="ml-1">
              <UserMenu
                email={session.user.email ?? '—'}
                country={session.profile?.country ?? null}
              />
            </div>
          ) : (
            <Link
              href="/signin"
              className="ml-1 rounded-md bg-primary px-3 py-1.5 font-medium text-primary-foreground transition hover:opacity-90"
            >
              {t('signIn')}
            </Link>
          )}
        </nav>

        {/* Mobile: collapsed hamburger drawer (below md). */}
        <MobileNav isSignedIn={isSignedIn} email={session?.user.email ?? null} />
      </div>
    </header>
  )
}

/**
 * Wrap getSession so a missing/misconfigured Supabase doesn't crash the layout.
 * Returns null on any error → header renders the signed-out state.
 */
async function safeSession() {
  try {
    return await getSession()
  } catch {
    return null
  }
}
