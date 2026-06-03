import { describe, expect, it } from 'vitest'
import { planChargeWindow, type HourlyFinalPrice } from '@/lib/pricing/charge-planner'
import type { ApplianceWindow, CurvePoint, DayPlan } from '@/lib/pricing/plan-builder'
import {
  decideAnchor,
  decideDaily,
  decideFree,
  decideSpike,
  FREE_FINAL_EUR_KWH,
  SPIKE_FINAL_EUR_KWH,
} from './daily-decision'
import type { AlertType } from './evaluator'

/**
 * Hand-built FINAL-price days. We label local hours in UTC so the array INDEX equals the
 * local hour (no DST offset to reason about) — the decision engine consumes the curve's
 * own `localTime`/`localHour` fields verbatim and never re-derives a timezone, so a UTC
 * frame is a faithful, offset-independent fixture. `finalEurKwh` is the all-in customer
 * price the engine reasons about.
 */
const DAY = '2026-06-01'

/** Build a 24h FINAL curve from an array of 24 €/kWh values (index = local hour). */
function curveFromFinals(finals: number[], tz = 'UTC'): CurvePoint[] {
  return finals.map((finalEurKwh, hour) => {
    const ts = new Date(`${DAY}T${pad(hour)}:00:00Z`)
    return {
      ts: ts.toISOString(),
      localTime: localHhmm(ts, tz),
      localHour: localHour(ts, tz),
      wholesaleEurMwh: finalEurKwh * 1000, // chart-only; irrelevant to decisions
      finalEurKwh,
    }
  })
}

function pad(n: number): string {
  return n.toString().padStart(2, '0')
}
function localHour(ts: Date, tz: string): number {
  return Number(new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hour12: false, timeZone: tz }).format(ts))
}
function localHhmm(ts: Date, tz: string): string {
  return new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: tz }).format(ts)
}

/** A flat day — every hour the same price. Should NOT trigger anchor / free / spike. */
const FLAT = curveFromFinals(Array.from({ length: 24 }, () => 0.15))

/**
 * A deep-valley day: a cheap night (00–06 at ~0.01 €/kWh, i.e. ≤ FREE threshold) and a
 * normal day. Triggers the free block; no negative hour, no spike.
 */
const VALLEY = curveFromFinals([
  0.01, 0.01, 0.005, 0.005, 0.01, 0.01, // 00–05 near-free
  0.12, 0.14, 0.16, 0.17, 0.18, 0.18, // 06–11
  0.17, 0.16, 0.15, 0.15, 0.16, 0.17, // 12–17
  0.19, 0.2, 0.19, 0.17, 0.14, 0.1, // 18–23
])

/** A day with three negative hours overnight. Triggers free with negative=true. */
const NEGATIVE = curveFromFinals([
  -0.02, -0.05, -0.03, 0.0, 0.02, 0.05, // 00–05 (00–02 negative)
  0.1, 0.13, 0.15, 0.16, 0.17, 0.18,
  0.17, 0.16, 0.15, 0.15, 0.16, 0.17,
  0.18, 0.19, 0.18, 0.16, 0.13, 0.09,
])

/**
 * A spike day: a clearly expensive evening block (19–21 above the spike threshold), and an
 * otherwise normal day with NO near-free hour. Triggers spike; not free.
 */
const SPIKE = curveFromFinals([
  0.1, 0.09, 0.08, 0.08, 0.09, 0.1,
  0.12, 0.14, 0.16, 0.17, 0.18, 0.19,
  0.18, 0.17, 0.16, 0.17, 0.19, 0.22,
  0.28, 0.32, 0.3, 0.2, 0.14, 0.11, // 18–21 expensive; 19–20 the peak
])

/** Build a minimal ApplianceWindow by running the real optimizer over a curve. */
function applianceWindow(
  curve: CurvePoint[],
  opts: {
    id?: string
    label?: string
    type?: string
    energyKwh: number
    powerKw: number
    interruptible?: boolean
    earliestHour?: number
    latestHour?: number
  },
): ApplianceWindow {
  const prices: HourlyFinalPrice[] = curve.map((c) => ({ ts: new Date(c.ts), finalEurKwh: c.finalEurKwh }))
  const plan = planChargeWindow({
    prices,
    energyKwh: opts.energyKwh,
    powerKw: opts.powerKw,
    earliestHour: opts.earliestHour,
    latestHour: opts.latestHour,
    // UTC so the optimizer's local-hour feasibility lines up with the curve's UTC labels.
    timeZone: 'UTC',
  })
  return {
    applianceId: opts.id ?? 'ap1',
    label: opts.label ?? 'EV',
    type: opts.type ?? 'ev',
    energyKwh: opts.energyKwh,
    powerKw: opts.powerKw,
    interruptible: opts.interruptible ?? true,
    plan,
  }
}

function dayPlan(curve: CurvePoint[], appliances: ApplianceWindow[]): DayPlan {
  const finals = curve.map((c) => c.finalEurKwh)
  return {
    curve,
    cheapestEurKwh: Math.min(...finals),
    peakEurKwh: Math.max(...finals),
    appliances,
  }
}

const ALL_TYPES: AlertType[] = ['cheap_hour', 'free_energy', 'negative', 'spike']

describe('decideFree', () => {
  it('finds the cheapest near-free block on a deep-valley day', () => {
    const free = decideFree(VALLEY)
    expect(free).not.toBeNull()
    expect(free!.negative).toBe(false)
    // The near-free run is 00:00–06:00 (six hours ≤ 0.02 €/kWh) → end label 06:00.
    expect(free!.block.startLocal).toBe('00:00')
    expect(free!.block.endLocal).toBe('06:00')
    expect(free!.block.hours).toBe(6)
    expect(free!.block.minEurKwh).toBeLessThanOrEqual(FREE_FINAL_EUR_KWH)
  })

  it('flags a negative block when an hour is below zero', () => {
    const free = decideFree(NEGATIVE)
    expect(free).not.toBeNull()
    expect(free!.negative).toBe(true)
    expect(free!.block.minEurKwh).toBeLessThan(0)
  })

  it('returns null on a flat day with no near-free hour', () => {
    expect(decideFree(FLAT)).toBeNull()
  })

  it('returns null on a spike day (no hour at/below the free threshold)', () => {
    expect(decideFree(SPIKE)).toBeNull()
  })

  it('labels a block ending at local midnight as 24:00 with :00 minutes', () => {
    // A near-free run on the LAST two hours (22:00, 23:00) → end of the 23:00 hour is local
    // midnight. The end label must be a clean "24:00" (special-cased), minutes hardcoded ':00'
    // regardless of the source row's HH:MM — guarding against an invalid "24:30" if a future
    // sub-hourly source ever landed.
    const lateValley = curveFromFinals(
      Array.from({ length: 24 }, (_, h) => (h >= 22 ? 0.01 : 0.15)),
    )
    const free = decideFree(lateValley)
    expect(free).not.toBeNull()
    expect(free!.block.startLocal).toBe('22:00')
    expect(free!.block.endLocal).toBe('24:00')
    expect(free!.block.hours).toBe(2)
  })
})

describe('decideSpike', () => {
  it('finds the most expensive contiguous block on a spike day', () => {
    const spike = decideSpike(SPIKE)
    expect(spike).not.toBeNull()
    // Hours above the 0.25 spike threshold: index 18 (0.28), 19 (0.32), 20 (0.30) →
    // a 3-hour block 18:00–21:00. 21 (0.20) is below threshold and ends it.
    expect(spike!.block.startLocal).toBe('18:00')
    expect(spike!.block.endLocal).toBe('21:00')
    expect(spike!.block.hours).toBe(3)
    expect(spike!.block.maxEurKwh).toBeGreaterThan(SPIKE_FINAL_EUR_KWH)
    expect(spike!.block.maxEurKwh).toBeCloseTo(0.32, 6)
  })

  it('returns null on a flat day', () => {
    expect(decideSpike(FLAT)).toBeNull()
  })

  it('returns null on a valley day (no expensive block)', () => {
    expect(decideSpike(VALLEY)).toBeNull()
  })

  it('ignores a single expensive hour (needs a multi-hour block)', () => {
    // One spike hour at 20:00 only.
    const oneHour = curveFromFinals(
      Array.from({ length: 24 }, (_, h) => (h === 20 ? 0.4 : 0.12)),
    )
    expect(decideSpike(oneHour)).toBeNull()
  })
})

describe('decideAnchor', () => {
  it('recommends the cheap-night window and a positive € saving for an EV', () => {
    // EV: 8 kWh at 4 kW → 2 slots. Cheapest pair is the 0.005 valley hours (02–04).
    const ap = applianceWindow(VALLEY, { energyKwh: 8, powerKw: 4, interruptible: true })
    const anchor = decideAnchor(dayPlan(VALLEY, [ap]))
    expect(anchor).not.toBeNull()
    expect(anchor!.kind).toBe('anchor')
    expect(anchor!.applianceLabel).toBe('EV')
    expect(anchor!.savedEur).toBeGreaterThan(0)
    // Cheapest 2 feasible hours are 02:00 & 03:00 (0.005 each) → avg 0.005 €/kWh.
    expect(anchor!.avgEurKwh).toBeCloseTo(0.005, 6)
  })

  it('returns null on a flat day (no saving to nudge)', () => {
    const ap = applianceWindow(FLAT, { energyKwh: 8, powerKw: 4, interruptible: true })
    expect(decideAnchor(dayPlan(FLAT, [ap]))).toBeNull()
  })

  it('returns null when the plan has no appliances', () => {
    expect(decideAnchor(dayPlan(VALLEY, []))).toBeNull()
  })
})

describe('decideDaily — kind selection by subscription', () => {
  it('emits anchor + free on a valley day for a fully-subscribed user', () => {
    const ap = applianceWindow(VALLEY, { energyKwh: 8, powerKw: 4, interruptible: true })
    const decisions = decideDaily({ plan: dayPlan(VALLEY, [ap]), subscribedTypes: ALL_TYPES })
    const kinds = decisions.map((d) => d.kind).sort()
    expect(kinds).toEqual(['anchor', 'free'])
  })

  it('emits ONLY spike on a spike day, and only if subscribed', () => {
    const ap = applianceWindow(SPIKE, { energyKwh: 8, powerKw: 4, interruptible: true })
    const plan = dayPlan(SPIKE, [ap])

    const spikeOnly = decideDaily({ plan, subscribedTypes: ['spike'] })
    expect(spikeOnly.map((d) => d.kind)).toEqual(['spike'])

    // Subscribed only to free_energy → a spike day yields nothing.
    const freeSub = decideDaily({ plan, subscribedTypes: ['free_energy'] })
    expect(freeSub).toEqual([])
  })

  it('emits NOTHING on a flat day even when subscribed to everything', () => {
    const ap = applianceWindow(FLAT, { energyKwh: 8, powerKw: 4, interruptible: true })
    const decisions = decideDaily({ plan: dayPlan(FLAT, [ap]), subscribedTypes: ALL_TYPES })
    expect(decisions).toEqual([])
  })

  it('does not emit an anchor when the user is not subscribed to cheap_hour', () => {
    const ap = applianceWindow(VALLEY, { energyKwh: 8, powerKw: 4, interruptible: true })
    const decisions = decideDaily({
      plan: dayPlan(VALLEY, [ap]),
      subscribedTypes: ['free_energy'], // free only
    })
    expect(decisions.map((d) => d.kind)).toEqual(['free'])
  })
})
