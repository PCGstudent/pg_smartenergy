import { describe, expect, it } from 'vitest'
import { NAV_LINKS, buildNavLinks } from './nav-links'

describe('buildNavLinks', () => {
  it('returns only public links when signed out', () => {
    // Arrange
    const isSignedIn = false

    // Act
    const links = buildNavLinks(isSignedIn)

    // Assert
    expect(links.map((l) => l.href)).toEqual(['/dashboard', '/market'])
    expect(links.every((l) => l.authOnly === false)).toBe(true)
  })

  it('returns public + auth-gated links when signed in', () => {
    // Arrange
    const isSignedIn = true

    // Act
    const links = buildNavLinks(isSignedIn)

    // Assert
    expect(links.map((l) => l.href)).toEqual([
      '/dashboard',
      '/market',
      '/plan',
      '/auditor',
      '/alerts',
    ])
  })

  it('preserves the canonical order for the signed-in set', () => {
    // Act
    const links = buildNavLinks(true)

    // Assert — order matches the source-of-truth declaration
    expect(links.map((l) => l.labelKey)).toEqual([
      'dashboard',
      'market',
      'plan',
      'auditor',
      'alerts',
    ])
  })

  it('does not mutate the shared NAV_LINKS source', () => {
    // Arrange
    const before = NAV_LINKS.length

    // Act
    buildNavLinks(true)
    buildNavLinks(false)

    // Assert — filtering returns a fresh array; the constant is untouched
    expect(NAV_LINKS.length).toBe(before)
    expect(NAV_LINKS.length).toBe(5)
  })

  it('every link label key is unique', () => {
    // Act
    const keys = NAV_LINKS.map((l) => l.labelKey)

    // Assert
    expect(new Set(keys).size).toBe(keys.length)
  })
})
