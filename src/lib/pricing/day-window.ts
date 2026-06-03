/**
 * Local-day → UTC window helpers — pure, immutable, no I/O.
 *
 * The planner is PROSPECTIVE: it plans "tomorrow" as a full LOCAL calendar day
 * (00:00–24:00 in Europe/Lisbon or Europe/Madrid), then converts those wall-clock
 * bounds to the UTC instants we query `market_prices` with. Day-ahead prices for
 * tomorrow are published ~12:45, so by the afternoon the whole day is knowable.
 *
 * We compute the zone's UTC offset at the target day via `date-fns-tz` (DST-correct),
 * the same mechanism `tar.ts` uses, rather than assuming a fixed offset.
 */

import { fromZonedTime, toZonedTime } from 'date-fns-tz'

export interface DayWindow {
  /** UTC instant of local 00:00 on the target day (inclusive). */
  startUtc: Date
  /** UTC instant of local 00:00 on the NEXT day (exclusive). */
  endUtc: Date
  /** The target local calendar date as YYYY-MM-DD (for labels). */
  localDate: string
}

/**
 * The UTC window covering tomorrow's full local day in `timeZone`.
 * @param now    reference instant (defaults to real now); "tomorrow" is now + 1 local day.
 * @param timeZone IANA zone, e.g. 'Europe/Lisbon' (PT) or 'Europe/Madrid' (ES).
 *
 * DST note: `endUtc - startUtc` is NOT always 24h. On the two DST transition days per zone
 * the local day is 23h (spring-forward, last Sunday of March) or 25h (fall-back, last Sunday
 * of October). The window stays correct either way — it is derived from the zone's actual UTC
 * offset at each bound — so a spring-forward day yields 23 price rows and a fall-back day 25.
 * Downstream (`buildCurve` → `planChargeWindow`) handles the short/long day gracefully.
 */
export function tomorrowWindow(now: Date = new Date(), timeZone: string): DayWindow {
  return localDayWindow(addLocalDays(now, 1, timeZone), timeZone)
}

/**
 * The UTC window covering the FULL local day that `at` falls into, in `timeZone`.
 * Returns the [00:00 local, 00:00 next-day local) instants as UTC Dates.
 */
export function localDayWindow(at: Date, timeZone: string): DayWindow {
  const { year, month, day } = localYmd(at, timeZone)
  const startUtc = zonedWallClockToUtc(year, month, day, 0, 0, timeZone)
  const startOfNext = zonedWallClockToUtc(year, month, day + 1, 0, 0, timeZone)
  return {
    startUtc,
    endUtc: startOfNext,
    localDate: ymdString(year, month, day),
  }
}

/** Local Y/M/D fields (1-based month/day) for an instant in a zone. */
function localYmd(at: Date, timeZone: string): { year: number; month: number; day: number } {
  const local = toZonedTime(at, timeZone)
  return { year: local.getFullYear(), month: local.getMonth() + 1, day: local.getDate() }
}

/** Add `n` whole days to the local wall-clock date, returning a UTC instant at local noon. */
function addLocalDays(at: Date, n: number, timeZone: string): Date {
  const { year, month, day } = localYmd(at, timeZone)
  // Anchor at local noon to stay clear of DST 00:00 edge cases when shifting days.
  return zonedWallClockToUtc(year, month, day + n, 12, 0, timeZone)
}

/**
 * Convert a local wall-clock (year, 1-based month, day, hour, minute) in `timeZone`
 * to the corresponding UTC instant, honouring the zone's DST offset at that moment.
 *
 * Delegates to `date-fns-tz`'s `fromZonedTime`, which resolves DST edge cases
 * (the ambiguous hour on fall-back nights, the skipped hour on spring-forward
 * nights) deterministically — unlike a single-iteration manual offset correction.
 *
 * IMPORTANT: `fromZonedTime` is fed a TIMEZONE-NAIVE local string (`YYYY-MM-DDTHH:mm:ss`),
 * NOT a `Date` instance. Passing a `Date` makes v3 read its *host-local* field values, so
 * the result would vary with the machine's `TZ`. The string form is parsed directly in
 * `timeZone` and is host-independent — the same pattern `ingestion/omie.ts` uses. Calendar
 * overflow (e.g. day = 32, or hour = 24) is normalised first via `Date.UTC` getters.
 *
 * Exported for direct DST-edge unit testing; the window helpers only ever call it
 * at 00:00 and local-noon.
 */
export function zonedWallClockToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
): Date {
  // Normalise month/day/hour overflow into canonical fields, host-TZ independent.
  const n = new Date(Date.UTC(year, month - 1, day, hour, minute, 0))
  const localWallClock =
    `${n.getUTCFullYear()}-${pad2(n.getUTCMonth() + 1)}-${pad2(n.getUTCDate())}` +
    `T${pad2(n.getUTCHours())}:${pad2(n.getUTCMinutes())}:${pad2(n.getUTCSeconds())}`
  return fromZonedTime(localWallClock, timeZone)
}

function ymdString(year: number, month: number, day: number): string {
  return `${year}-${pad2(month)}-${pad2(day)}`
}

function pad2(n: number): string {
  return n.toString().padStart(2, '0')
}
