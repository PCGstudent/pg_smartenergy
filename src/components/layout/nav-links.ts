/**
 * Canonical primary-navigation model.
 *
 * Both the desktop inline nav and the collapsed mobile drawer render from this
 * single source so the two surfaces never drift. Each entry pairs a route with
 * the `nav.*` translation key used for its label — labels are resolved by the
 * caller (server or client) so this stays a pure, framework-free module that is
 * trivially unit-testable under the node test environment.
 */

/** A primary nav destination. `labelKey` is a key under the `nav` namespace. */
export interface NavLink {
  href: string
  labelKey: 'dashboard' | 'market' | 'plan' | 'auditor' | 'alerts'
  /** When true, the link is only shown to an authenticated user. */
  authOnly: boolean
}

/** Full ordered set of primary links, independent of auth state. */
export const NAV_LINKS: readonly NavLink[] = [
  { href: '/dashboard', labelKey: 'dashboard', authOnly: false },
  { href: '/market', labelKey: 'market', authOnly: false },
  { href: '/plan', labelKey: 'plan', authOnly: true },
  { href: '/auditor', labelKey: 'auditor', authOnly: true },
  { href: '/alerts', labelKey: 'alerts', authOnly: true },
] as const

/**
 * Resolve which primary links to render for the current session.
 *
 * @param isSignedIn whether a user session is present
 * @returns the public links plus, when signed in, the auth-gated links — in the
 *   canonical order above. Returns a new array (never mutates `NAV_LINKS`).
 */
export function buildNavLinks(isSignedIn: boolean): NavLink[] {
  return NAV_LINKS.filter((link) => !link.authOnly || isSignedIn)
}
