import { describe, expect, it } from 'vitest'
import {
  IEC_EUR_PER_KWH,
  legalTimeOf,
  periodFor,
  SCHEDULES,
  tarEurKwhForDate,
  tarForDate,
  TAR_ENERGY_EUR_PER_KWH,
  TAR_VALID_FROM,
  type CountingCycle,
  type DayKind,
  type LegalTime,
  type Period,
  type TariffCycle,
} from './tar'

// All instants are UTC. Lisbon is UTC+0 in winter, UTC+1 in summer.
// 2026-01-14 is a Wednesday (winter); 2026-07-15 is a Wednesday (summer).
// 2026-01-17 is a Saturday (winter); 2026-01-18 is a Sunday (winter).

describe('TAR constants — known ERSE 2026 BTN values (incl. CIEG)', () => {
  it('exposes the published €/kWh per period', () => {
    expect(TAR_ENERGY_EUR_PER_KWH.SIMPLES).toBe(0.0607)
    expect(TAR_ENERGY_EUR_PER_KWH.FORA_VAZIO).toBe(0.0835)
    expect(TAR_ENERGY_EUR_PER_KWH.PONTA).toBe(0.2452)
    expect(TAR_ENERGY_EUR_PER_KWH.CHEIAS).toBe(0.0412)
    expect(TAR_ENERGY_EUR_PER_KWH.VAZIO).toBe(0.0158)
  })

  it('bi Fora de Vazio is the published value, NOT derived from tri Ponta/Cheias', () => {
    // The common encoding bug: blending tri values. The published bi value stands alone.
    expect(TAR_ENERGY_EUR_PER_KWH.FORA_VAZIO).toBe(0.0835)
    expect(TAR_ENERGY_EUR_PER_KWH.FORA_VAZIO).not.toBe(
      (TAR_ENERGY_EUR_PER_KWH.PONTA + TAR_ENERGY_EUR_PER_KWH.CHEIAS) / 2,
    )
  })

  it('pins the regulatory metadata', () => {
    expect(TAR_VALID_FROM).toBe('2026-01-01')
    expect(IEC_EUR_PER_KWH).toBe(0.001)
  })
})

describe('legalTimeOf — winter/summer from real DST offset', () => {
  it('January is winter (Lisbon UTC+0)', () => {
    expect(legalTimeOf(new Date('2026-01-14T12:00:00Z'))).toBe('winter')
  })

  it('July is summer (Lisbon UTC+1)', () => {
    expect(legalTimeOf(new Date('2026-07-15T12:00:00Z'))).toBe('summer')
  })
})

describe('tarForDate — simples', () => {
  it('returns the single SIMPLES price at any hour', () => {
    expect(tarEurKwhForDate(new Date('2026-01-14T03:00:00Z'), 'simples')).toBe(0.0607)
    expect(tarEurKwhForDate(new Date('2026-07-15T19:00:00Z'), 'simples')).toBe(0.0607)
    const r = tarForDate(new Date('2026-01-14T03:00:00Z'), 'simples')
    expect(r.period).toBe('SIMPLES')
  })
})

describe('tarForDate — tri (ciclo diário)', () => {
  it('winter weekday 09:30 local → PONTA', () => {
    // 09:30 UTC = 09:30 Lisbon (winter). Ponta = 09:00–10:30.
    const r = tarForDate(new Date('2026-01-14T09:30:00Z'), 'tri')
    expect(r.legalTime).toBe('winter')
    expect(r.dayKind).toBe('weekday')
    expect(r.period).toBe('PONTA')
    expect(r.tarEurKwh).toBe(0.2452)
  })

  it('winter weekday 00:00 local → VAZIO', () => {
    const r = tarForDate(new Date('2026-01-14T00:00:00Z'), 'tri')
    expect(r.period).toBe('VAZIO')
    expect(r.tarEurKwh).toBe(0.0158)
  })

  it('winter weekday 08:00 local → CHEIAS (08:00–09:00 band)', () => {
    expect(tarEurKwhForDate(new Date('2026-01-14T08:00:00Z'), 'tri')).toBe(0.0412)
  })

  it('summer weekday 09:30 local → CHEIAS (summer Ponta starts 10:30)', () => {
    // 08:30 UTC = 09:30 Lisbon in summer. Summer Cheias = 08:00–10:30.
    const r = tarForDate(new Date('2026-07-15T08:30:00Z'), 'tri')
    expect(r.legalTime).toBe('summer')
    expect(r.period).toBe('CHEIAS')
    expect(r.tarEurKwh).toBe(0.0412)
  })

  it('summer weekday 10:30 local → PONTA (boundary is start-inclusive)', () => {
    // 09:30 UTC = 10:30 Lisbon summer → PONTA begins exactly here.
    expect(tarForDate(new Date('2026-07-15T09:30:00Z'), 'tri').period).toBe('PONTA')
    // one minute earlier (10:29) is still CHEIAS.
    expect(tarForDate(new Date('2026-07-15T09:29:00Z'), 'tri').period).toBe('CHEIAS')
  })

  it('Saturday (diário) uses the weekday clock → 10:00 winter is PONTA', () => {
    // 2026-01-17 is Saturday; ciclo diário treats it like any day.
    const r = tarForDate(new Date('2026-01-17T10:00:00Z'), 'tri', 'diario')
    expect(r.dayKind).toBe('saturday')
    expect(r.period).toBe('PONTA')
    expect(r.tarEurKwh).toBe(0.2452)
  })

  it('Sunday (diário) 12:00 winter → CHEIAS', () => {
    const r = tarForDate(new Date('2026-01-18T12:00:00Z'), 'tri', 'diario')
    expect(r.dayKind).toBe('sunday')
    expect(r.period).toBe('CHEIAS')
    expect(r.tarEurKwh).toBe(0.0412)
  })
})

describe('tarForDate — tri (ciclo semanal): weekends differ', () => {
  it('Sunday is VAZIO all day (semanal)', () => {
    expect(tarEurKwhForDate(new Date('2026-01-18T12:00:00Z'), 'tri', 'semanal')).toBe(0.0158)
    expect(tarEurKwhForDate(new Date('2026-01-18T20:00:00Z'), 'tri', 'semanal')).toBe(0.0158)
    expect(tarForDate(new Date('2026-01-18T12:00:00Z'), 'tri', 'semanal').period).toBe('VAZIO')
  })

  it('Saturday winter (semanal) has Cheias but no Ponta', () => {
    // Sat semanal winter: Cheias 09:30–13:00 & 18:30–22:00; rest Vazio. 10:00 → CHEIAS.
    expect(tarForDate(new Date('2026-01-17T10:00:00Z'), 'tri', 'semanal').period).toBe('CHEIAS')
    // 08:00 Saturday → Vazio.
    expect(tarForDate(new Date('2026-01-17T08:00:00Z'), 'tri', 'semanal').period).toBe('VAZIO')
  })

  it('weekday (semanal) summer Ponta window is 09:15–12:15', () => {
    expect(periodFor('tri', 'semanal', 'summer', 'weekday', 9 * 60 + 14)).toBe('CHEIAS')
    expect(periodFor('tri', 'semanal', 'summer', 'weekday', 9 * 60 + 15)).toBe('PONTA')
    expect(periodFor('tri', 'semanal', 'summer', 'weekday', 12 * 60 + 14)).toBe('PONTA')
    expect(periodFor('tri', 'semanal', 'summer', 'weekday', 12 * 60 + 15)).toBe('CHEIAS')
  })

  it('weekday (semanal) winter Vazio is 00:00–07:00', () => {
    expect(periodFor('tri', 'semanal', 'winter', 'weekday', 6 * 60 + 59)).toBe('VAZIO')
    expect(periodFor('tri', 'semanal', 'winter', 'weekday', 7 * 60)).toBe('CHEIAS')
  })
})

describe('tarForDate — bi (ciclo diário): boundaries', () => {
  it('07:30 local → VAZIO; 08:00 → FORA_VAZIO; 22:00 → VAZIO', () => {
    expect(tarForDate(new Date('2026-01-14T07:30:00Z'), 'bi').period).toBe('VAZIO')
    expect(tarForDate(new Date('2026-01-14T07:30:00Z'), 'bi').tarEurKwh).toBe(0.0158)
    // 08:00 is the start of Fora de Vazio (inclusive).
    expect(tarForDate(new Date('2026-01-14T08:00:00Z'), 'bi').period).toBe('FORA_VAZIO')
    expect(tarForDate(new Date('2026-01-14T08:00:00Z'), 'bi').tarEurKwh).toBe(0.0835)
    // 22:00 flips back to Vazio (inclusive start of the 22:00–24:00 band).
    expect(tarForDate(new Date('2026-01-14T22:00:00Z'), 'bi').period).toBe('VAZIO')
    expect(tarForDate(new Date('2026-01-14T21:59:00Z'), 'bi').period).toBe('FORA_VAZIO')
  })

  it('bi daily is identical winter and summer', () => {
    // 12:00 local is Fora de Vazio in both seasons.
    expect(tarForDate(new Date('2026-01-14T12:00:00Z'), 'bi').period).toBe('FORA_VAZIO')
    expect(tarForDate(new Date('2026-07-15T11:00:00Z'), 'bi').period).toBe('FORA_VAZIO') // 12:00 Lisbon summer
  })
})

describe('periodFor — full-day coverage (every minute is classified, all 24 configs)', () => {
  const MINUTES_IN_DAY = 1440
  const allMinutes = Array.from({ length: MINUTES_IN_DAY }, (_, m) => m)

  const cycles: Exclude<TariffCycle, 'simples'>[] = ['bi', 'tri']
  const countings: CountingCycle[] = ['diario', 'semanal']
  const legalTimes: LegalTime[] = ['winter', 'summer']
  const dayKinds: DayKind[] = ['weekday', 'saturday', 'sunday']

  /** The full set of periods a cycle is ever allowed to classify into. */
  const allowedPeriods: Record<Exclude<TariffCycle, 'simples'>, Period[]> = {
    bi: ['VAZIO', 'FORA_VAZIO'],
    tri: ['VAZIO', 'CHEIAS', 'PONTA'],
  }

  for (const cycle of cycles) {
    for (const counting of countings) {
      for (const legalTime of legalTimes) {
        for (const dayKind of dayKinds) {
          const label = `${cycle} ${counting} ${legalTime} ${dayKind}`

          it(`${label}: every minute maps to a valid period for the cycle`, () => {
            for (const m of allMinutes) {
              const p = periodFor(cycle, counting, legalTime, dayKind, m)
              expect(allowedPeriods[cycle]).toContain(p)
            }
          })

          // Independent of periodFor's defensive VAZIO fallback: assert the encoded
          // SCHEDULES intervals themselves tile 00:00–24:00 with no gaps and no overlaps.
          // This catches a single-digit typo (e.g. I(9,15,12,15) → I(9,15,12,16)) that
          // would leave a minute uncovered and be silently misclassified as VAZIO.
          it(`${label}: encoded intervals tile the day with no gaps or overlaps`, () => {
            const sched = SCHEDULES[cycle][counting][legalTime][dayKind]
            const coverCount = new Array<number>(MINUTES_IN_DAY).fill(0)
            for (const period of Object.keys(sched) as Period[]) {
              for (const [start, end] of sched[period] ?? []) {
                for (let m = start; m < end; m++) coverCount[m] = (coverCount[m] ?? 0) + 1
              }
            }
            const gaps = allMinutes.filter((m) => (coverCount[m] ?? 0) === 0)
            const overlaps = allMinutes.filter((m) => (coverCount[m] ?? 0) > 1)
            expect(gaps).toEqual([])
            expect(overlaps).toEqual([])
          })
        }
      }
    }
  }

  it('simples classifies every minute as SIMPLES', () => {
    for (const m of allMinutes) {
      expect(periodFor('simples', 'diario', 'winter', 'weekday', m)).toBe('SIMPLES')
    }
  })
})
