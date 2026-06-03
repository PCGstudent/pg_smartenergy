import { describe, expect, it } from 'vitest'
import { deriveVolatility, formatCentsOrFree, FREE_CENTS_EPSILON } from './volatility'

describe('deriveVolatility — absolute ¢/kWh spread', () => {
  it('returns all-zero stats for an empty day', () => {
    expect(deriveVolatility([])).toEqual({ minCents: 0, maxCents: 0, spreadCents: 0 })
  })

  it('computes min, max and absolute spread for a normal positive day', () => {
    // 0.05 €/kWh = 5¢, 0.20 €/kWh = 20¢, 0.12 €/kWh = 12¢
    const stats = deriveVolatility([0.05, 0.2, 0.12])
    expect(stats.minCents).toBeCloseTo(5, 6)
    expect(stats.maxCents).toBeCloseTo(20, 6)
    expect(stats.spreadCents).toBeCloseTo(15, 6)
  })

  it('stays well-defined (no 0.0× collapse) when the cheapest hour is NEGATIVE', () => {
    // Regression: the old max/min ratio forced spreadX to 0 when min <= 0.
    // Cheapest = -0.03 €/kWh (-3¢), peak = 0.22 €/kWh (22¢) → spread 25¢.
    const stats = deriveVolatility([-0.03, 0.1, 0.22])
    expect(stats.minCents).toBeCloseTo(-3, 6)
    expect(stats.maxCents).toBeCloseTo(22, 6)
    expect(stats.spreadCents).toBeCloseTo(25, 6)
    // The spread must be a meaningful positive number, never 0.
    expect(stats.spreadCents).toBeGreaterThan(0)
  })

  it('handles a free (zero) cheapest hour', () => {
    const stats = deriveVolatility([0, 0.08, 0.15])
    expect(stats.minCents).toBeCloseTo(0, 6)
    expect(stats.spreadCents).toBeCloseTo(15, 6)
  })

  it('spread is zero when every hour costs the same', () => {
    const stats = deriveVolatility([0.1, 0.1, 0.1])
    expect(stats.spreadCents).toBeCloseTo(0, 6)
  })
})

describe('formatCentsOrFree', () => {
  it('renders a normal positive value with two decimals and the ¢ suffix', () => {
    expect(formatCentsOrFree(12.3456, 'GRÁTIS')).toBe('12.35¢')
  })

  it('renders the free label for a negative value instead of "-0.00¢"', () => {
    expect(formatCentsOrFree(-2.5, 'GRÁTIS')).toBe('GRÁTIS')
  })

  it('renders the free label for an exact zero', () => {
    expect(formatCentsOrFree(0, 'FREE')).toBe('FREE')
  })

  it('treats values within the epsilon of zero as free', () => {
    expect(formatCentsOrFree(FREE_CENTS_EPSILON, 'GRATIS')).toBe('GRATIS')
    expect(formatCentsOrFree(FREE_CENTS_EPSILON + 0.01, 'GRATIS')).toBe('0.06¢')
  })
})
