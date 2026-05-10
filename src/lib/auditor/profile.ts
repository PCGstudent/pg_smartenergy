import { fromZonedTime } from 'date-fns-tz'

/**
 * Iberian residential consumption shape (24-hour normalized).
 * Source: averaged ENTSO-E + REE residential load curves, then smoothed.
 * Values sum to ~1.0; we re-normalize at runtime for safety.
 *
 * Index 0 = 00:00–01:00 local time, index 23 = 23:00–24:00.
 */
const RESIDENTIAL_24H = [
  0.025, 0.020, 0.018, 0.018, 0.020, 0.022, // 00–06: night dip
  0.030, 0.040, 0.045, 0.045, 0.040, 0.040, // 06–12: morning ramp
  0.045, 0.050, 0.045, 0.040, 0.040, 0.045, // 12–18: midday + return
  0.050, 0.060, 0.070, 0.075, 0.060, 0.040, // 18–24: evening peak
]

const sum24 = RESIDENTIAL_24H.reduce((s, v) => s + v, 0)
const NORM_24H = RESIDENTIAL_24H.map((v) => v / sum24)

export interface SyntheticHour {
  ts: Date // period start, UTC
  kwh: number
}

/**
 * Generate an hour-by-hour synthetic consumption series spanning [start, end]
 * (inclusive on both ends — Iberian invoices are inclusive). Total sums to
 * exactly `totalKwh` modulo floating-point.
 *
 * @param start ISO YYYY-MM-DD or Date — first day of period
 * @param end ISO YYYY-MM-DD or Date — last day of period
 * @param totalKwh total energy to distribute
 * @param tz time zone of the local 24-hour profile (defaults Europe/Lisbon)
 */
export function syntheticProfile(
  start: Date | string,
  end: Date | string,
  totalKwh: number,
  tz: string = 'Europe/Lisbon',
): SyntheticHour[] {
  const startDate = typeof start === 'string' ? new Date(`${start}T00:00:00Z`) : start
  const endDate = typeof end === 'string' ? new Date(`${end}T00:00:00Z`) : end

  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
    throw new Error('syntheticProfile: invalid start/end date')
  }
  if (endDate.getTime() < startDate.getTime()) {
    throw new Error('syntheticProfile: end before start')
  }
  if (totalKwh < 0) throw new Error('syntheticProfile: negative totalKwh')

  // Iterate days in [start, end] inclusive; one bucket per local hour.
  const days: Date[] = []
  const cursor = new Date(Date.UTC(
    startDate.getUTCFullYear(),
    startDate.getUTCMonth(),
    startDate.getUTCDate(),
  ))
  const lastDay = Date.UTC(
    endDate.getUTCFullYear(),
    endDate.getUTCMonth(),
    endDate.getUTCDate(),
  )
  while (cursor.getTime() <= lastDay) {
    days.push(new Date(cursor))
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
  if (days.length === 0) return []

  const perDayKwh = totalKwh / days.length
  const out: SyntheticHour[] = []
  for (const day of days) {
    const yyyy = day.getUTCFullYear()
    const mm = pad(day.getUTCMonth() + 1)
    const dd = pad(day.getUTCDate())
    for (let h = 0; h < 24; h++) {
      const local = `${yyyy}-${mm}-${dd}T${pad(h)}:00:00`
      const tsUtc = fromZonedTime(local, tz)
      out.push({ ts: tsUtc, kwh: perDayKwh * (NORM_24H[h] ?? 0) })
    }
  }
  return out
}

function pad(n: number): string {
  return n.toString().padStart(2, '0')
}
