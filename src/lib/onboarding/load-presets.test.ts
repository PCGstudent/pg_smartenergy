import { describe, expect, it } from 'vitest'
import {
  AVAILABILITY_WINDOWS,
  daysPerWeekFor,
  loadDescriptionToAppliance,
  presetDefaults,
  runsPerMonthFor,
  WEEKS_PER_MONTH,
  type LoadDescription,
} from './load-presets'

describe('loadDescriptionToAppliance — onboarding → appliance mapping', () => {
  it('maps the canonical TVDE EV description to a planner-ready appliance', () => {
    // "I charge an EV, ~40 kWh, 5 days/week, available overnight (22h–07h)".
    const description: LoadDescription = {
      profile: 'ev',
      energyKwh: 40,
      availability: 'overnight',
      daysPerWeek: 5,
    }

    const appliance = loadDescriptionToAppliance(description, 'Carro elétrico')

    expect(appliance.type).toBe('ev')
    expect(appliance.label).toBe('Carro elétrico')
    expect(appliance.energyKwh).toBe(40)
    expect(appliance.powerKw).toBe(7.4) // single-phase home AC charger default
    expect(appliance.interruptible).toBe(true) // a car doesn't mind pausing
    // Overnight normalises to the deep VAZIO valley 00:00–08:00 (planner can't wrap 22→07).
    expect(appliance.earliestHour).toBe(0)
    expect(appliance.latestHour).toBe(8)
  })

  it('falls back to preset defaults when the user overrides nothing', () => {
    const appliance = loadDescriptionToAppliance({ profile: 'ev' }, 'EV')
    const defaults = presetDefaults('ev')
    expect(appliance.energyKwh).toBe(defaults.energyKwh)
    expect(appliance.powerKw).toBe(defaults.powerKw)
    expect(appliance.earliestHour).toBe(AVAILABILITY_WINDOWS.overnight.earliestHour)
    expect(appliance.latestHour).toBe(AVAILABILITY_WINDOWS.overnight.latestHour)
  })

  it('always yields a window the optimizer accepts (earliest < latest)', () => {
    for (const availability of ['overnight', 'daytime', 'anytime'] as const) {
      const a = loadDescriptionToAppliance({ profile: 'water_heater', availability }, 'WH')
      expect(a.earliestHour).toBeLessThan(a.latestHour)
      expect(a.earliestHour).toBeGreaterThanOrEqual(0)
      expect(a.latestHour).toBeLessThanOrEqual(24)
    }
  })

  it('maps a non-interruptible washer with a full-day window by default', () => {
    const a = loadDescriptionToAppliance({ profile: 'washer' }, 'Washer')
    expect(a.type).toBe('washer')
    expect(a.interruptible).toBe(false) // a wash must run start-to-finish
    expect(a.earliestHour).toBe(0)
    expect(a.latestHour).toBe(24)
  })

  it('clamps a non-positive energy override back to the preset default', () => {
    const a = loadDescriptionToAppliance({ profile: 'dishwasher', energyKwh: 0 }, 'DW')
    expect(a.energyKwh).toBe(presetDefaults('dishwasher').energyKwh)
  })

  it('clamps an absurd energy override to the 500 kWh ceiling', () => {
    const a = loadDescriptionToAppliance({ profile: 'ev', energyKwh: 9999 }, 'EV')
    expect(a.energyKwh).toBe(500)
  })

  it('sets typicalDurationMin from the preset (informational only)', () => {
    const a = loadDescriptionToAppliance({ profile: 'ev' }, 'EV')
    expect(a.typicalDurationMin).toBe(presetDefaults('ev').typicalDurationMin)
  })
})

describe('cadence helpers', () => {
  it('clamps days/week into [1, 7] and rounds', () => {
    expect(daysPerWeekFor({ profile: 'ev', daysPerWeek: 5 })).toBe(5)
    expect(daysPerWeekFor({ profile: 'ev', daysPerWeek: 0 })).toBe(1)
    expect(daysPerWeekFor({ profile: 'ev', daysPerWeek: 99 })).toBe(7)
    expect(daysPerWeekFor({ profile: 'ev', daysPerWeek: 4.4 })).toBe(4)
  })

  it('defaults days/week to the preset when omitted or non-finite', () => {
    expect(daysPerWeekFor({ profile: 'water_heater' })).toBe(7)
    expect(daysPerWeekFor({ profile: 'ev', daysPerWeek: Number.NaN })).toBe(5)
  })

  it('projects runs/month from days/week via 52/12 weeks', () => {
    // 5 days/week × (52/12) ≈ 21.67 runs/month.
    expect(runsPerMonthFor({ profile: 'ev', daysPerWeek: 5 })).toBeCloseTo(5 * WEEKS_PER_MONTH, 9)
    expect(runsPerMonthFor({ profile: 'ev', daysPerWeek: 5 })).toBeCloseTo(21.6667, 3)
  })
})
