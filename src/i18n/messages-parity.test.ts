import { describe, expect, it } from 'vitest'
import pt from '../../messages/pt.json'
import es from '../../messages/es.json'
import en from '../../messages/en.json'

/**
 * i18n parity guard.
 *
 * The pt/es/en catalogs MUST stay key-for-key identical: every message key that
 * exists in one catalog must exist in all three. The primary catalog is pt.json,
 * so it is the reference set; es and en are diffed against it (and against each
 * other) in both directions so a key added to only one file fails the build.
 *
 * Values are intentionally NOT compared (they differ by language) — only the
 * dotted key paths. Empty-string values ARE flagged, since a blank translation
 * is almost always an accidental untranslated stub.
 */

type Json = Record<string, unknown>

/** Flatten a nested message object into a sorted list of dotted key paths. */
function flattenKeys(obj: Json, prefix = ''): string[] {
  const keys: string[] = []
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      keys.push(...flattenKeys(value as Json, path))
    } else {
      keys.push(path)
    }
  }
  return keys.sort()
}

/** Collect dotted paths whose leaf value is an empty/whitespace-only string. */
function emptyStringKeys(obj: Json, prefix = ''): string[] {
  const empties: string[] = []
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      empties.push(...emptyStringKeys(value as Json, path))
    } else if (typeof value === 'string' && value.trim() === '') {
      empties.push(path)
    }
  }
  return empties
}

const catalogs = {
  pt: pt as Json,
  es: es as Json,
  en: en as Json,
}

const keysByLocale = {
  pt: flattenKeys(catalogs.pt),
  es: flattenKeys(catalogs.es),
  en: flattenKeys(catalogs.en),
}

describe('i18n catalog parity (pt/es/en)', () => {
  it('all three catalogs expose the exact same set of keys', () => {
    // pt is the primary/reference catalog.
    expect(keysByLocale.es).toEqual(keysByLocale.pt)
    expect(keysByLocale.en).toEqual(keysByLocale.pt)
  })

  it('es is not missing any key present in pt', () => {
    const missing = keysByLocale.pt.filter((k) => !keysByLocale.es.includes(k))
    expect(missing).toEqual([])
  })

  it('es has no extra key absent from pt', () => {
    const extra = keysByLocale.es.filter((k) => !keysByLocale.pt.includes(k))
    expect(extra).toEqual([])
  })

  it('en is not missing any key present in pt', () => {
    const missing = keysByLocale.pt.filter((k) => !keysByLocale.en.includes(k))
    expect(missing).toEqual([])
  })

  it('en has no extra key absent from pt', () => {
    const extra = keysByLocale.en.filter((k) => !keysByLocale.pt.includes(k))
    expect(extra).toEqual([])
  })

  it('has no empty-string (untranslated) values in any catalog', () => {
    expect(emptyStringKeys(catalogs.pt)).toEqual([])
    expect(emptyStringKeys(catalogs.es)).toEqual([])
    expect(emptyStringKeys(catalogs.en)).toEqual([])
  })
})
