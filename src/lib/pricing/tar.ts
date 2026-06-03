/**
 * Portuguese electricity Network Access Tariff (TAR — Tarifa de Acesso às Redes).
 * Scope: Portugal Continente, BTN (Baixa Tensão Normal), contracted power 3.45–20.7 kVA.
 *
 * Source of truth: ERSE Diretiva n.º 1/2026 (2026-01-07). VALID FROM 2026-01-01.
 * The TAR €/kWh values ALREADY INCLUDE CIEG — there is NO separate per-kWh CIEG charge.
 * The full per-kWh retail stack is: energy commodity + TAR (this module) + IEC, then × (1 + IVA).
 *
 * Cross-checked sources (TAR values + period clock — all agree):
 *  - ERSE period definitions (Art. 31.º Reg. Tarifário):
 *      https://www.erse.pt/media/wijn0vgt/periodos-hor%C3%A1rios-de-energia-el%C3%A9trica-em-portugal.pdf
 *  - EDP 2026 TAR tariff sheet (ERSE-derived, valid 01/01/2026):
 *      https://helpcenter.edp.pt/media/hswmizya/20251222_tarifas_acesso_redes.pdf
 *  - Tiago Felícia — TAR 2026 BTN: https://www.tiagofelicia.pt/tarifas-acesso-redes.html
 *  - Tiago Felícia — períodos horários BTN: https://www.tiagofelicia.pt/periodos-horarios.html
 *  - Doutor Finanças — horas vazio/cheias/ponta:
 *      https://www.doutorfinancas.pt/energia/quando-sao-as-horas-de-vazio-cheias-e-de-ponta/
 *  - lojaluz — TAR inclui CIEG: https://lojaluz.com/faq/tarifa-acesso-redes
 *  - ERSE Diretiva/Comunicado tarifas 2026:
 *      https://www.erse.pt/media/1u5dhvzl/comunicado_tarifasele_2026.pdf
 *
 * Watch item: ERSE consulta pública CP137 (Nov 2025) proposes new periods, NOT effective
 * before 2027-01-01. Re-verify before encoding 2027. This module is correct for 2026.
 *
 * ES (peajes de acceso + cargos) is intentionally a TODO stub below — it does not block PT.
 */

import { toZonedTime } from 'date-fns-tz'

export const TAR_VALID_FROM = '2026-01-01' as const
/** Imposto Especial de Consumo de Eletricidade — Continente. Social-tariff & self-consumption exempt. */
export const IEC_EUR_PER_KWH = 0.001 as const

const LISBON_TZ = 'Europe/Lisbon'

export type TariffCycle = 'simples' | 'bi' | 'tri'
export type Period = 'PONTA' | 'CHEIAS' | 'VAZIO' | 'FORA_VAZIO' | 'SIMPLES'
/** Hora legal de inverno/verão. Switch: last Sunday of March / October. */
export type LegalTime = 'winter' | 'summer'
/** Ciclo de contagem. `diario` = same clock every day; `semanal` = weekday/Sat/Sun differ. */
export type CountingCycle = 'diario' | 'semanal'
export type DayKind = 'weekday' | 'saturday' | 'sunday'

/**
 * TAR energy component €/kWh by period (BTN 3.45–20.7 kVA, 2026; incl. CIEG).
 * Bi "FORA_VAZIO" is the published bi value (0.0835) — NEVER derived from tri Ponta/Cheias.
 */
export const TAR_ENERGY_EUR_PER_KWH: Record<Period, number> = {
  SIMPLES: 0.0607,
  FORA_VAZIO: 0.0835,
  PONTA: 0.2452,
  CHEIAS: 0.0412,
  VAZIO: 0.0158,
}

/** [startMinutes, endMinutes) interval within a 24h day. hm notation: h*60 + m. 24:00 => 1440. */
type Interval = readonly [number, number]
const I = (h1: number, m1: number, h2: number, m2: number): Interval =>
  [h1 * 60 + m1, h2 * 60 + m2] as const

/** A day's coverage: Period -> list of [start,end) intervals spanning 00:00–24:00. */
type DaySchedule = Partial<Record<Period, Interval[]>>

/**
 * Period schedules as minute-of-day intervals (honours the 09:15 / 09:30 / 10:30 cut-points).
 * Structure: cycle -> counting -> legalTime -> dayKind -> { period: intervals }.
 */
export const SCHEDULES: Record<
  Exclude<TariffCycle, 'simples'>,
  Record<CountingCycle, Record<LegalTime, Record<DayKind, DaySchedule>>>
> = {
  bi: {
    diario: {
      // bi-horário daily: winter == summer.
      winter: {
        weekday: { VAZIO: [I(0, 0, 8, 0), I(22, 0, 24, 0)], FORA_VAZIO: [I(8, 0, 22, 0)] },
        saturday: { VAZIO: [I(0, 0, 8, 0), I(22, 0, 24, 0)], FORA_VAZIO: [I(8, 0, 22, 0)] },
        sunday: { VAZIO: [I(0, 0, 8, 0), I(22, 0, 24, 0)], FORA_VAZIO: [I(8, 0, 22, 0)] },
      },
      summer: {
        weekday: { VAZIO: [I(0, 0, 8, 0), I(22, 0, 24, 0)], FORA_VAZIO: [I(8, 0, 22, 0)] },
        saturday: { VAZIO: [I(0, 0, 8, 0), I(22, 0, 24, 0)], FORA_VAZIO: [I(8, 0, 22, 0)] },
        sunday: { VAZIO: [I(0, 0, 8, 0), I(22, 0, 24, 0)], FORA_VAZIO: [I(8, 0, 22, 0)] },
      },
    },
    semanal: {
      winter: {
        weekday: { VAZIO: [I(0, 0, 7, 0)], FORA_VAZIO: [I(7, 0, 24, 0)] },
        saturday: {
          VAZIO: [I(0, 0, 9, 30), I(13, 0, 18, 30), I(22, 0, 24, 0)],
          FORA_VAZIO: [I(9, 30, 13, 0), I(18, 30, 22, 0)],
        },
        sunday: { VAZIO: [I(0, 0, 24, 0)] },
      },
      summer: {
        weekday: { VAZIO: [I(0, 0, 7, 0)], FORA_VAZIO: [I(7, 0, 24, 0)] },
        saturday: {
          VAZIO: [I(0, 0, 9, 0), I(14, 0, 20, 0), I(22, 0, 24, 0)],
          FORA_VAZIO: [I(9, 0, 14, 0), I(20, 0, 22, 0)],
        },
        sunday: { VAZIO: [I(0, 0, 24, 0)] },
      },
    },
  },
  tri: {
    diario: {
      winter: {
        weekday: {
          VAZIO: [I(0, 0, 8, 0), I(22, 0, 24, 0)],
          PONTA: [I(9, 0, 10, 30), I(18, 0, 20, 30)],
          CHEIAS: [I(8, 0, 9, 0), I(10, 30, 18, 0), I(20, 30, 22, 0)],
        },
        saturday: {
          VAZIO: [I(0, 0, 8, 0), I(22, 0, 24, 0)],
          PONTA: [I(9, 0, 10, 30), I(18, 0, 20, 30)],
          CHEIAS: [I(8, 0, 9, 0), I(10, 30, 18, 0), I(20, 30, 22, 0)],
        },
        sunday: {
          VAZIO: [I(0, 0, 8, 0), I(22, 0, 24, 0)],
          PONTA: [I(9, 0, 10, 30), I(18, 0, 20, 30)],
          CHEIAS: [I(8, 0, 9, 0), I(10, 30, 18, 0), I(20, 30, 22, 0)],
        },
      },
      summer: {
        weekday: {
          VAZIO: [I(0, 0, 8, 0), I(22, 0, 24, 0)],
          PONTA: [I(10, 30, 13, 0), I(19, 30, 21, 0)],
          CHEIAS: [I(8, 0, 10, 30), I(13, 0, 19, 30), I(21, 0, 22, 0)],
        },
        saturday: {
          VAZIO: [I(0, 0, 8, 0), I(22, 0, 24, 0)],
          PONTA: [I(10, 30, 13, 0), I(19, 30, 21, 0)],
          CHEIAS: [I(8, 0, 10, 30), I(13, 0, 19, 30), I(21, 0, 22, 0)],
        },
        sunday: {
          VAZIO: [I(0, 0, 8, 0), I(22, 0, 24, 0)],
          PONTA: [I(10, 30, 13, 0), I(19, 30, 21, 0)],
          CHEIAS: [I(8, 0, 10, 30), I(13, 0, 19, 30), I(21, 0, 22, 0)],
        },
      },
    },
    semanal: {
      winter: {
        weekday: {
          VAZIO: [I(0, 0, 7, 0)],
          PONTA: [I(9, 30, 12, 0), I(18, 30, 21, 0)],
          CHEIAS: [I(7, 0, 9, 30), I(12, 0, 18, 30), I(21, 0, 24, 0)],
        },
        saturday: {
          VAZIO: [I(0, 0, 9, 30), I(13, 0, 18, 30), I(22, 0, 24, 0)],
          CHEIAS: [I(9, 30, 13, 0), I(18, 30, 22, 0)],
        },
        sunday: { VAZIO: [I(0, 0, 24, 0)] },
      },
      summer: {
        weekday: {
          VAZIO: [I(0, 0, 7, 0)],
          PONTA: [I(9, 15, 12, 15)],
          CHEIAS: [I(7, 0, 9, 15), I(12, 15, 24, 0)],
        },
        saturday: {
          VAZIO: [I(0, 0, 9, 0), I(14, 0, 20, 0), I(22, 0, 24, 0)],
          CHEIAS: [I(9, 0, 14, 0), I(20, 0, 22, 0)],
        },
        sunday: { VAZIO: [I(0, 0, 24, 0)] },
      },
    },
  },
}

/** Classify minutes-of-day → Period for an explicit (cycle, counting, legalTime, dayKind). */
export function periodFor(
  cycle: TariffCycle,
  counting: CountingCycle,
  legalTime: LegalTime,
  dayKind: DayKind,
  minutesOfDay: number,
): Period {
  if (cycle === 'simples') return 'SIMPLES'
  const sched = SCHEDULES[cycle][counting][legalTime][dayKind]
  for (const period of Object.keys(sched) as Period[]) {
    for (const [start, end] of sched[period] ?? []) {
      if (minutesOfDay >= start && minutesOfDay < end) return period
    }
  }
  // Defensive: schedules above cover the full day, so this is unreachable.
  return 'VAZIO'
}

/** TAR €/kWh for an explicit (cycle, counting, legalTime, dayKind, minutesOfDay). */
export function tarEurPerKwh(
  cycle: TariffCycle,
  counting: CountingCycle,
  legalTime: LegalTime,
  dayKind: DayKind,
  minutesOfDay: number,
): number {
  return TAR_ENERGY_EUR_PER_KWH[periodFor(cycle, counting, legalTime, dayKind, minutesOfDay)]
}

export interface TarLookup {
  period: Period
  tarEurKwh: number
  legalTime: LegalTime
  dayKind: DayKind
  /** Local wall-clock minute-of-day in Europe/Lisbon (0–1439). */
  minutesOfDay: number
}

/**
 * Resolve the TAR for an absolute instant, handling Europe/Lisbon local time,
 * weekend vs weekday, and winter/summer legal time (derived from the actual DST offset).
 *
 * @param at     the absolute moment (UTC `Date`)
 * @param cycle  the customer's tariff cycle (simples | bi | tri)
 * @param counting ciclo de contagem (default 'diario' — the most common BTN default)
 */
export function tarForDate(
  at: Date,
  cycle: TariffCycle,
  counting: CountingCycle = 'diario',
): TarLookup {
  const local = toZonedTime(at, LISBON_TZ)
  const minutesOfDay = local.getHours() * 60 + local.getMinutes()
  const dayKind = dayKindOf(local.getDay())
  const legalTime = legalTimeOf(at)
  const period = periodFor(cycle, counting, legalTime, dayKind, minutesOfDay)
  return {
    period,
    tarEurKwh: TAR_ENERGY_EUR_PER_KWH[period],
    legalTime,
    dayKind,
    minutesOfDay,
  }
}

/** Convenience: just the TAR €/kWh for an absolute instant. */
export function tarEurKwhForDate(
  at: Date,
  cycle: TariffCycle,
  counting: CountingCycle = 'diario',
): number {
  return tarForDate(at, cycle, counting).tarEurKwh
}

/** JS getDay() (0=Sun..6=Sat) → DayKind. */
function dayKindOf(jsDay: number): DayKind {
  if (jsDay === 0) return 'sunday'
  if (jsDay === 6) return 'saturday'
  return 'weekday'
}

/**
 * Winter vs summer legal time, derived from Lisbon's actual UTC offset at `at`.
 * Lisbon is UTC+0 in winter (WET) and UTC+1 in summer (WEST). DST switches on the
 * last Sunday of March/October, which `date-fns-tz` handles via the IANA database.
 */
export function legalTimeOf(at: Date): LegalTime {
  return lisbonOffsetMinutes(at) >= 60 ? 'summer' : 'winter'
}

/** Lisbon UTC offset (minutes) at an instant: (local wall-clock − UTC), via the zoned representation. */
function lisbonOffsetMinutes(at: Date): number {
  const local = toZonedTime(at, LISBON_TZ)
  // toZonedTime returns a Date whose *UTC* getters read the Lisbon wall-clock fields.
  const asUtcWall = Date.UTC(
    local.getFullYear(),
    local.getMonth(),
    local.getDate(),
    local.getHours(),
    local.getMinutes(),
    local.getSeconds(),
  )
  return Math.round((asUtcWall - at.getTime()) / 60000)
}

// ---------------------------------------------------------------------------
// ES — peajes de acceso + cargos (Spain). TODO STUB. Does NOT block PT.
// ---------------------------------------------------------------------------
//
// Spain's regulated network access charge has a different structure from PT:
//   - "Peajes de acceso" (set by CNMC) + "Cargos" (set by the Gobierno/MITECO),
//     both with 3 periods on the 2.0TD residential tariff (P1 punta / P2 llano / P3 valle),
//     each with its own €/kWh energy term AND €/kW·year power term, varying by season
//     (P1/P2/P3 clock differs Jun–Sep vs rest of year, weekends/holidays all P3 valle).
//   - The hourly clock (2.0TD): Mon–Fri P1 10–14 & 18–22, P2 8–10/14–18/22–24, P3 00–08;
//     weekends & national holidays: P3 all day. Peninsula timezone Europe/Madrid.
//
// When implementing, mirror the PT shape: an ES SCHEDULES map keyed by Madrid local
// time + a Record<ESPeriod, eurPerKwh> for the summed (peaje + cargo) energy term, plus
// a tarEurKwhForDateES(at, ...) entry point. Source: CNMC + BOE peajes/cargos resolutions.
export const ES_TAR_IMPLEMENTED = false as const

/** Placeholder so callers can branch without importing `undefined`. Always throws for now. */
export function tarEurKwhForDateES(_at: Date): number {
  throw new Error('ES peajes/cargos not implemented yet — see TODO in tar.ts')
}
