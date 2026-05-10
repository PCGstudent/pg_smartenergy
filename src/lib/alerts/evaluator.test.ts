import { describe, expect, it } from 'vitest'
import {
  evaluateAlert,
  isInQuietHours,
  isWeekdayEnabled,
  pickPrimaryMatch,
  type EvaluatorAlert,
  type PricePoint,
} from './evaluator'

const NOW = new Date('2024-05-14T10:00:00Z')

function priceAt(hoursFromNow: number, priceEurMwh: number): PricePoint {
  return { ts: new Date(NOW.getTime() + hoursFromNow * 3600 * 1000), priceEurMwh }
}

const baseAlert: Omit<EvaluatorAlert, 'type' | 'thresholdEurMwh'> = {
  id: 'a1',
  userId: 'u1',
  channels: ['push'],
  schedule: null,
}

describe('evaluateAlert — free_energy', () => {
  it('matches hours below 1 €/MWh and ≥ 0', () => {
    const prices = [priceAt(1, 0.5), priceAt(2, 50), priceAt(3, 0)]
    const matches = evaluateAlert(
      { ...baseAlert, type: 'free_energy', thresholdEurMwh: null },
      prices,
      NOW,
    )
    expect(matches).toHaveLength(2)
    expect(matches.map((m) => m.priceEurMwh).sort()).toEqual([0, 0.5])
  })

  it('does NOT match negative prices (those belong to negative alert)', () => {
    const matches = evaluateAlert(
      { ...baseAlert, type: 'free_energy', thresholdEurMwh: null },
      [priceAt(1, -5)],
      NOW,
    )
    expect(matches).toHaveLength(0)
  })
})

describe('evaluateAlert — negative', () => {
  it('matches strictly < 0', () => {
    const matches = evaluateAlert(
      { ...baseAlert, type: 'negative', thresholdEurMwh: null },
      [priceAt(1, 0), priceAt(2, -1), priceAt(3, -10)],
      NOW,
    )
    expect(matches).toHaveLength(2)
    expect(matches[0]?.reason).toMatch(/NEGATIVE/)
  })
})

describe('evaluateAlert — cheap_hour', () => {
  it('respects custom threshold', () => {
    const prices = [priceAt(1, 30), priceAt(2, 80), priceAt(3, 25)]
    const matches = evaluateAlert(
      { ...baseAlert, type: 'cheap_hour', thresholdEurMwh: 50 },
      prices,
      NOW,
    )
    expect(matches).toHaveLength(2)
  })

  it('falls back to default threshold when null', () => {
    const matches = evaluateAlert(
      { ...baseAlert, type: 'cheap_hour', thresholdEurMwh: null },
      [priceAt(1, 49.9), priceAt(2, 50.1)],
      NOW,
    )
    expect(matches).toHaveLength(1)
  })
})

describe('evaluateAlert — spike', () => {
  it('matches strictly > threshold', () => {
    const matches = evaluateAlert(
      { ...baseAlert, type: 'spike', thresholdEurMwh: 200 },
      [priceAt(1, 200), priceAt(2, 250)],
      NOW,
    )
    expect(matches).toHaveLength(1)
    expect(matches[0]?.priceEurMwh).toBe(250)
  })
})

describe('evaluateAlert — past hours', () => {
  it('ignores prices at or before `now`', () => {
    const matches = evaluateAlert(
      { ...baseAlert, type: 'free_energy', thresholdEurMwh: null },
      [priceAt(-1, 0), priceAt(0, 0), priceAt(1, 0)],
      NOW,
    )
    expect(matches).toHaveLength(1)
  })
})

describe('pickPrimaryMatch', () => {
  it('returns the earliest match', () => {
    const matches = [
      { alertId: 'a', ts: new Date('2024-05-14T15:00Z'), priceEurMwh: 0, reason: 'late' },
      { alertId: 'a', ts: new Date('2024-05-14T11:00Z'), priceEurMwh: 0, reason: 'early' },
    ]
    expect(pickPrimaryMatch(matches)?.reason).toBe('early')
  })

  it('returns null on empty input', () => {
    expect(pickPrimaryMatch([])).toBeNull()
  })
})

describe('isInQuietHours', () => {
  it('returns false when no schedule', () => {
    expect(isInQuietHours(null, new Date(), 'PT')).toBe(false)
    expect(isInQuietHours({}, new Date(), 'PT')).toBe(false)
  })

  it('handles same-day window 09–17', () => {
    // 12:00 UTC in May = 13:00 Lisbon (WEST, UTC+1) = inside 09–17
    expect(isInQuietHours({ quietStartHour: 9, quietEndHour: 17 }, new Date('2024-05-14T12:00:00Z'), 'PT')).toBe(true)
    expect(isInQuietHours({ quietStartHour: 9, quietEndHour: 17 }, new Date('2024-05-14T19:00:00Z'), 'PT')).toBe(false)
  })

  it('handles wrap-around window 22–08', () => {
    // 23:00 Lisbon = inside quiet
    expect(isInQuietHours({ quietStartHour: 22, quietEndHour: 8 }, new Date('2024-05-14T22:00:00Z'), 'PT')).toBe(true)
    // 03:00 Lisbon = inside quiet
    expect(isInQuietHours({ quietStartHour: 22, quietEndHour: 8 }, new Date('2024-05-14T02:00:00Z'), 'PT')).toBe(true)
    // 12:00 Lisbon = NOT quiet
    expect(isInQuietHours({ quietStartHour: 22, quietEndHour: 8 }, new Date('2024-05-14T11:00:00Z'), 'PT')).toBe(false)
  })

  it('returns false when start === end', () => {
    expect(isInQuietHours({ quietStartHour: 12, quietEndHour: 12 }, new Date(), 'PT')).toBe(false)
  })
})

describe('isWeekdayEnabled', () => {
  it('always-on when weekdays absent', () => {
    expect(isWeekdayEnabled({}, new Date(), 'PT')).toBe(true)
    expect(isWeekdayEnabled(null, new Date(), 'PT')).toBe(true)
  })

  it('matches the local weekday', () => {
    // 2024-05-14 is a Tuesday → ISO 2
    const tue = new Date('2024-05-14T12:00:00Z')
    expect(isWeekdayEnabled({ weekdays: [2] }, tue, 'PT')).toBe(true)
    expect(isWeekdayEnabled({ weekdays: [1, 3] }, tue, 'PT')).toBe(false)
  })
})
