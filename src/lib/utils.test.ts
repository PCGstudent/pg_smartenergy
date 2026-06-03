import { describe, expect, it } from 'vitest'
import { centsKwhToEurMwh, eurMwhToCentsKwh, mwhToKwh } from './utils'

describe('wholesale ↔ retail unit conversions', () => {
  it('mwhToKwh divides by 1000', () => {
    expect(mwhToKwh(50)).toBeCloseTo(0.05, 9)
    expect(mwhToKwh(0)).toBe(0)
    expect(mwhToKwh(-30)).toBeCloseTo(-0.03, 9)
  })

  it('eurMwhToCentsKwh converts wholesale €/MWh to ¢/kWh (÷10)', () => {
    expect(eurMwhToCentsKwh(50)).toBeCloseTo(5, 9) // 50 €/MWh = 5 ¢/kWh
    expect(eurMwhToCentsKwh(200)).toBeCloseTo(20, 9) // spike default
    expect(eurMwhToCentsKwh(1)).toBeCloseTo(0.1, 9)
    expect(eurMwhToCentsKwh(-50)).toBeCloseTo(-5, 9) // negative prices survive
  })

  it('centsKwhToEurMwh converts ¢/kWh back to €/MWh (×10)', () => {
    expect(centsKwhToEurMwh(5)).toBeCloseTo(50, 9)
    expect(centsKwhToEurMwh(20)).toBeCloseTo(200, 9)
    expect(centsKwhToEurMwh(-5)).toBeCloseTo(-50, 9)
  })

  it('round-trips €/MWh → ¢/kWh → €/MWh for the alert threshold range', () => {
    // The alert UI enters ¢/kWh but stores €/MWh; the value must survive the trip.
    for (const eurMwh of [-200, -50, 0, 1, 50, 123.4, 200, 1000]) {
      expect(centsKwhToEurMwh(eurMwhToCentsKwh(eurMwh))).toBeCloseTo(eurMwh, 6)
    }
  })
})
