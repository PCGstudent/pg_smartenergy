import { describe, expect, it } from 'vitest'
import { syntheticProfile } from './profile'

describe('syntheticProfile', () => {
  it('produces 24 hours per day for a one-day period', () => {
    const hours = syntheticProfile('2024-05-14', '2024-05-14', 24)
    expect(hours).toHaveLength(24)
  })

  it('produces 24 × N hours across an inclusive multi-day period', () => {
    const hours = syntheticProfile('2024-05-01', '2024-05-31', 300) // 31 days
    expect(hours).toHaveLength(31 * 24)
  })

  it('total kWh equals input totalKwh (within float epsilon)', () => {
    const hours = syntheticProfile('2024-05-01', '2024-05-31', 300)
    const total = hours.reduce((s, h) => s + h.kwh, 0)
    expect(total).toBeCloseTo(300, 6)
  })

  it('emits monotonically increasing timestamps', () => {
    const hours = syntheticProfile('2024-05-14', '2024-05-15', 48)
    for (let i = 1; i < hours.length; i++) {
      expect(hours[i]!.ts.getTime()).toBeGreaterThan(hours[i - 1]!.ts.getTime())
    }
  })

  it('peak hour (20:00 local) consumes more than valley hour (03:00 local)', () => {
    const hours = syntheticProfile('2024-05-14', '2024-05-14', 24)
    // hour 20 local = ts at 18:00 UTC (CEST = UTC+2)
    // hour 3 local = ts at 01:00 UTC
    const peak = hours.find((h) => h.ts.toISOString() === '2024-05-14T18:00:00.000Z')
    const valley = hours.find((h) => h.ts.toISOString() === '2024-05-14T01:00:00.000Z')
    expect(peak).toBeDefined()
    expect(valley).toBeDefined()
    expect(peak!.kwh).toBeGreaterThan(valley!.kwh)
  })

  it('rejects end-before-start', () => {
    expect(() => syntheticProfile('2024-05-31', '2024-05-01', 100)).toThrow(/end before start/)
  })

  it('handles same-day start/end', () => {
    const hours = syntheticProfile('2024-05-14', '2024-05-14', 12)
    expect(hours).toHaveLength(24)
    const total = hours.reduce((s, h) => s + h.kwh, 0)
    expect(total).toBeCloseTo(12, 6)
  })
})
