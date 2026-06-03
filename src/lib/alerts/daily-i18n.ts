/**
 * Locale-aware translators for the alert engines (DAILY anchor + HOURLY Smart Guard) —
 * request-context free.
 *
 * Both engines execute in a cron (no incoming request → no next-intl request locale), and
 * each user may want a different language. So instead of next-intl's request-scoped `t`,
 * we load the message catalog for a user's profile locale directly and build a tiny
 * translator scoped to `alerts.daily` or `alerts.hourly`.
 *
 * Our daily strings only use simple `{placeholder}` substitution (no ICU plural/select) —
 * the numeric values are PRE-FORMATTED euro strings — so a plain brace replace is correct
 * and avoids pulling the full ICU machinery into a background job. Unknown keys fall back
 * to the PT (primary) catalog, then to the key itself, so a missing translation degrades
 * to a sensible string rather than throwing inside the cron.
 */

import { defaultLocale, isLocale, type Locale } from '@/i18n/config'
import type { Translate } from './daily-messages'

type MessageTree = Record<string, unknown>

const DAILY_NAMESPACE = ['alerts', 'daily'] as const
const HOURLY_NAMESPACE = ['alerts', 'hourly'] as const

/** Cache loaded catalogs so a batch of users in the same locale loads each file once. */
const catalogCache = new Map<Locale, MessageTree>()

async function loadCatalog(locale: Locale): Promise<MessageTree> {
  const cached = catalogCache.get(locale)
  if (cached) return cached
  const mod = (await import(`../../../messages/${locale}.json`)) as { default: MessageTree }
  catalogCache.set(locale, mod.default)
  return mod.default
}

/** Normalize an arbitrary profile.locale string to a supported Locale (default PT). */
export function resolveMessageLocale(raw: string | null | undefined): Locale {
  return isLocale(raw) ? raw : defaultLocale
}

/**
 * Build a `Translate` scoped to an `alerts.*` namespace for the given locale.
 *
 * Resolution order for each key: requested-locale catalog → PT catalog → the raw key.
 * Pre-loads both the requested and the fallback (PT) catalog so lookups are synchronous.
 */
async function createAlertTranslator(
  locale: Locale,
  namespace: readonly string[],
): Promise<Translate> {
  const [primary, fallback] = await Promise.all([
    loadCatalog(locale),
    locale === defaultLocale ? Promise.resolve(null) : loadCatalog(defaultLocale),
  ])

  const primaryScope = descend(primary, namespace)
  const fallbackScope = fallback ? descend(fallback, namespace) : null

  return (key, params) => {
    const template = lookup(primaryScope, key) ?? lookup(fallbackScope, key) ?? key
    return interpolate(template, params)
  }
}

/** Translator scoped to `alerts.daily` (once-a-day anchor engine). */
export function createDailyTranslator(locale: Locale): Promise<Translate> {
  return createAlertTranslator(locale, DAILY_NAMESPACE)
}

/** Translator scoped to `alerts.hourly` (Smart Guard hourly evaluator). */
export function createHourlyTranslator(locale: Locale): Promise<Translate> {
  return createAlertTranslator(locale, HOURLY_NAMESPACE)
}

/** Walk a path of keys into a message tree, returning the subtree or null. */
function descend(tree: MessageTree | null, path: readonly string[]): MessageTree | null {
  let node: unknown = tree
  for (const segment of path) {
    if (node == null || typeof node !== 'object') return null
    node = (node as MessageTree)[segment]
  }
  return node != null && typeof node === 'object' ? (node as MessageTree) : null
}

/** Look up a dotted key (e.g. "anchor.title") within a subtree; returns a string or null. */
function lookup(tree: MessageTree | null, dottedKey: string): string | null {
  if (!tree) return null
  let node: unknown = tree
  for (const segment of dottedKey.split('.')) {
    if (node == null || typeof node !== 'object') return null
    node = (node as MessageTree)[segment]
  }
  return typeof node === 'string' ? node : null
}

/** Replace every `{name}` in `template` with the matching param (string-coerced). */
function interpolate(template: string, params?: Record<string, string | number>): string {
  if (!params) return template
  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in params ? String(params[name]) : whole,
  )
}
