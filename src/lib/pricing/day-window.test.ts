import { describe, expect, it } from 'vitest'
import { localDayWindow, tomorrowWindow, zonedWallClockToUtc } from './day-window'

const LISBON = 'Europe/Lisbon'
const MADRID = 'Europe/Madrid'

describe('localDayWindow — Lisbon winter (UTC+0)', () => {
  it('00:00 local == 00:00Z and spans exactly 24h', () => {
    // Mid-January: Lisbon is WET (UTC+0).
    const at = new Date('2026-01-14T09:30:00Z')
    const w = localDayWindow(at, LISBON)
    expect(w.localDate).toBe('2026-01-14')
    expect(w.startUtc.toISOString()).toBe('2026-01-14T00:00:00.000Z')
    expect(w.endUtc.toISOString()).toBe('2026-01-15T00:00:00.000Z')
    expect(w.endUtc.getTime() - w.startUtc.getTime()).toBe(24 * 3600 * 1000)
  })
})

describe('localDayWindow — Lisbon summer (UTC+1)', () => {
  it('00:00 local == 23:00Z the previous calendar day', () => {
    // Mid-July: Lisbon is WEST (UTC+1), so local midnight is 23:00Z the day before.
    const at = new Date('2026-07-15T10:00:00Z')
    const w = localDayWindow(at, LISBON)
    expect(w.localDate).toBe('2026-07-15')
    expect(w.startUtc.toISOString()).toBe('2026-07-14T23:00:00.000Z')
    expect(w.endUtc.toISOString()).toBe('2026-07-15T23:00:00.000Z')
  })
})

describe('localDayWindow — Madrid offsets differ from Lisbon', () => {
  it('Madrid winter is UTC+1 (00:00 local == 23:00Z previous day)', () => {
    const at = new Date('2026-01-14T09:30:00Z')
    const w = localDayWindow(at, MADRID)
    expect(w.localDate).toBe('2026-01-14')
    expect(w.startUtc.toISOString()).toBe('2026-01-13T23:00:00.000Z')
    expect(w.endUtc.toISOString()).toBe('2026-01-14T23:00:00.000Z')
  })

  it('Madrid summer is UTC+2 (00:00 local == 22:00Z previous day)', () => {
    const at = new Date('2026-07-15T10:00:00Z')
    const w = localDayWindow(at, MADRID)
    expect(w.startUtc.toISOString()).toBe('2026-07-14T22:00:00.000Z')
    expect(w.endUtc.toISOString()).toBe('2026-07-15T22:00:00.000Z')
  })
})

describe('tomorrowWindow', () => {
  it('returns the day AFTER the local day of `now`', () => {
    // now = 2026-01-14 afternoon Lisbon → tomorrow = 2026-01-15.
    const now = new Date('2026-01-14T15:00:00Z')
    const w = tomorrowWindow(now, LISBON)
    expect(w.localDate).toBe('2026-01-15')
    expect(w.startUtc.toISOString()).toBe('2026-01-15T00:00:00.000Z')
    expect(w.endUtc.toISOString()).toBe('2026-01-16T00:00:00.000Z')
  })

  it('rolls correctly across a month boundary', () => {
    // Last day of January → tomorrow is the 1st of February.
    const now = new Date('2026-01-31T18:00:00Z')
    const w = tomorrowWindow(now, LISBON)
    expect(w.localDate).toBe('2026-02-01')
    expect(w.startUtc.toISOString()).toBe('2026-02-01T00:00:00.000Z')
  })

  it('handles late-evening local time near the UTC day boundary (summer)', () => {
    // 2026-07-14 23:30Z == 2026-07-15 00:30 Lisbon (WEST). Local "today" is the 15th,
    // so tomorrow is the 16th — NOT the 15th. Guards against a UTC-vs-local off-by-one.
    const now = new Date('2026-07-14T23:30:00Z')
    const w = tomorrowWindow(now, LISBON)
    expect(w.localDate).toBe('2026-07-16')
    expect(w.startUtc.toISOString()).toBe('2026-07-15T23:00:00.000Z')
  })
})

// DST transitions: last Sunday of October (fall back) and March (spring forward) for
// both Iberian zones. The previous manual single-iteration offset correction silently
// mishandled the skipped spring-forward hour; `fromZonedTime` resolves both edges
// deterministically. For the doubled fall-back hour it returns the SECOND (later,
// already-winter) occurrence — the value asserted below is the exact production output.
describe('zonedWallClockToUtc — DST fall-back ambiguous hour (2026-10-25)', () => {
  it('Lisbon 01:00 (doubled this night) resolves deterministically to 01:00Z', () => {
    // Lisbon falls back at 01:00Z (WEST→WET), so local 01:00–02:00 happens twice:
    // first = 00:00Z (UTC+1), second = 01:00Z (UTC+0). fromZonedTime returns the second.
    expect(zonedWallClockToUtc(2026, 10, 25, 1, 0, LISBON).toISOString()).toBe(
      '2026-10-25T01:00:00.000Z',
    )
    expect(zonedWallClockToUtc(2026, 10, 25, 1, 30, LISBON).toISOString()).toBe(
      '2026-10-25T01:30:00.000Z',
    )
    // 02:30 is unambiguous and already in winter time (UTC+0).
    expect(zonedWallClockToUtc(2026, 10, 25, 2, 30, LISBON).toISOString()).toBe(
      '2026-10-25T02:30:00.000Z',
    )
  })

  it('Madrid 02:00 (doubled this night) resolves deterministically to 01:00Z', () => {
    // Madrid falls back one wall-clock hour later than Lisbon: 02:00–03:00 is doubled
    // (first = 00:00Z UTC+2, second = 01:00Z UTC+1). fromZonedTime returns the second.
    expect(zonedWallClockToUtc(2026, 10, 25, 2, 0, MADRID).toISOString()).toBe(
      '2026-10-25T01:00:00.000Z',
    )
    expect(zonedWallClockToUtc(2026, 10, 25, 2, 30, MADRID).toISOString()).toBe(
      '2026-10-25T01:30:00.000Z',
    )
  })
})

describe('zonedWallClockToUtc — DST spring-forward skipped hour (2026-03-29)', () => {
  it('Lisbon: the skipped 01:00–02:00 window resolves via the post-jump (WEST) offset', () => {
    // At 01:00Z Lisbon jumps WET(UTC+0)→WEST(UTC+1), so local 01:00–02:00 never happens.
    // fromZonedTime resolves the gap with the post-jump UTC+1 offset: 01:00 local → 00:00Z,
    // 02:00 local (the first instant that actually exists) → 01:00Z. The OLD manual
    // algorithm, by contrast, mishandled this skipped hour.
    expect(zonedWallClockToUtc(2026, 3, 29, 1, 0, LISBON).toISOString()).toBe(
      '2026-03-29T00:00:00.000Z',
    )
    expect(zonedWallClockToUtc(2026, 3, 29, 2, 0, LISBON).toISOString()).toBe(
      '2026-03-29T01:00:00.000Z',
    )
  })

  it('Madrid 03:00 (the first instant after the skipped hour) is post-jump CEST (UTC+2)', () => {
    // Madrid jumps CET(UTC+1)→CEST(UTC+2) at 01:00Z, skipping local 02:00–03:00.
    expect(zonedWallClockToUtc(2026, 3, 29, 3, 0, MADRID).toISOString()).toBe(
      '2026-03-29T01:00:00.000Z',
    )
  })
})

describe('localDayWindow — DST transition days span the correct number of hours', () => {
  it('Lisbon fall-back day (2026-10-25) is a 25-HOUR day', () => {
    // Lisbon falls back WEST→WET at 01:00Z. Both local midnights sit in their own
    // offsets (start 00:00 WEST = 23:00Z prev day; end 00:00 WET = 00:00Z next day),
    // so the day is 25h — the extra hour the optimizer must price.
    const w = localDayWindow(new Date('2026-10-25T12:00:00Z'), LISBON)
    expect(w.localDate).toBe('2026-10-25')
    expect(w.startUtc.toISOString()).toBe('2026-10-24T23:00:00.000Z')
    expect(w.endUtc.toISOString()).toBe('2026-10-26T00:00:00.000Z')
    expect(w.endUtc.getTime() - w.startUtc.getTime()).toBe(25 * 3600 * 1000)
  })

  it('Madrid fall-back day (2026-10-25) is a 25-HOUR day', () => {
    const w = localDayWindow(new Date('2026-10-25T12:00:00Z'), MADRID)
    expect(w.startUtc.toISOString()).toBe('2026-10-24T22:00:00.000Z')
    expect(w.endUtc.toISOString()).toBe('2026-10-25T23:00:00.000Z')
    expect(w.endUtc.getTime() - w.startUtc.getTime()).toBe(25 * 3600 * 1000)
  })

  it('Lisbon spring-forward day (2026-03-29) is a 23-HOUR day', () => {
    // Lisbon springs forward WET→WEST at 01:00Z, skipping a local hour, so the day
    // between local midnights is only 23h.
    const w = localDayWindow(new Date('2026-03-29T12:00:00Z'), LISBON)
    expect(w.localDate).toBe('2026-03-29')
    expect(w.startUtc.toISOString()).toBe('2026-03-29T00:00:00.000Z')
    expect(w.endUtc.toISOString()).toBe('2026-03-29T23:00:00.000Z')
    expect(w.endUtc.getTime() - w.startUtc.getTime()).toBe(23 * 3600 * 1000)
  })
})
