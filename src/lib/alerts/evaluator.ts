/**
 * Pure alert evaluator — no I/O, fully unit-testable.
 *
 * Given a user's alert rule and a window of hourly OMIE prices, returns the
 * list of upcoming hours that match the rule. The dispatcher decides cooldown,
 * channel routing, and quiet hours — this file just answers "did anything fire?".
 */

export type AlertType = 'cheap_hour' | 'free_energy' | 'spike' | 'negative'

export interface EvaluatorAlert {
  id: string
  userId: string
  type: AlertType
  /** €/MWh — required for cheap_hour and spike, ignored for free/negative. */
  thresholdEurMwh: number | null
  channels: string[]
  /** Optional schedule (quiet hours, days). Honored by the dispatcher, not here. */
  schedule: AlertSchedule | null
}

export interface AlertSchedule {
  /** Quiet-hours start (0–23, local time of user's country). */
  quietStartHour?: number
  /** Quiet-hours end (0–23). If end < start the window wraps midnight. */
  quietEndHour?: number
  /** ISO weekdays the alert is active. 1=Mon … 7=Sun. Empty/absent = all days. */
  weekdays?: number[]
}

export interface PricePoint {
  ts: Date
  priceEurMwh: number
}

export interface AlertMatch {
  alertId: string
  ts: Date
  priceEurMwh: number
  /**
   * Short INTERNAL descriptor for logs / debugging only — never surfaced to users.
   * It carries NO price figure (the evaluator has no tariff context, so any ¢/kWh here
   * would be a raw-wholesale number that under-states the real bill — product rule #2).
   * The dispatcher builds the user-facing title/body from localized copy on the FINAL
   * price, with the hour label rendered in the user's own timezone.
   */
  reason: string
  /** Sort key — earlier `ts` first; ties broken by extremeness. */
}

const FREE_THRESHOLD_EUR_MWH = 1

const DEFAULT_CHEAP_THRESHOLD_EUR_MWH = 50 // ~5¢/kWh wholesale
const DEFAULT_SPIKE_THRESHOLD_EUR_MWH = 200 // ~20¢/kWh wholesale

/**
 * Find every upcoming hour that satisfies an alert's condition.
 *
 * @param alert the rule to evaluate
 * @param prices prices for the look-ahead window (typically next 24–36h, sorted by ts)
 * @param now reference clock — we only return matches with `ts > now`
 */
export function evaluateAlert(
  alert: EvaluatorAlert,
  prices: PricePoint[],
  now: Date = new Date(),
): AlertMatch[] {
  const upcoming = prices.filter((p) => p.ts.getTime() > now.getTime())
  if (upcoming.length === 0) return []

  switch (alert.type) {
    case 'free_energy':
      return upcoming
        .filter((p) => p.priceEurMwh < FREE_THRESHOLD_EUR_MWH && p.priceEurMwh >= 0)
        .map((p) => ({
          alertId: alert.id,
          ts: p.ts,
          priceEurMwh: p.priceEurMwh,
          reason: `free_energy@${fmt(p.ts)}`,
        }))

    case 'negative':
      return upcoming
        .filter((p) => p.priceEurMwh < 0)
        .map((p) => ({
          alertId: alert.id,
          ts: p.ts,
          priceEurMwh: p.priceEurMwh,
          reason: `NEGATIVE@${fmt(p.ts)}`,
        }))

    case 'cheap_hour': {
      const t = alert.thresholdEurMwh ?? DEFAULT_CHEAP_THRESHOLD_EUR_MWH
      return upcoming
        .filter((p) => p.priceEurMwh < t)
        .map((p) => ({
          alertId: alert.id,
          ts: p.ts,
          priceEurMwh: p.priceEurMwh,
          reason: `cheap_hour@${fmt(p.ts)}`,
        }))
    }

    case 'spike': {
      const t = alert.thresholdEurMwh ?? DEFAULT_SPIKE_THRESHOLD_EUR_MWH
      return upcoming
        .filter((p) => p.priceEurMwh > t)
        .map((p) => ({
          alertId: alert.id,
          ts: p.ts,
          priceEurMwh: p.priceEurMwh,
          reason: `spike@${fmt(p.ts)}`,
        }))
    }
  }
}

/**
 * Returns true if `now` falls inside the alert's quiet hours.
 * Hours are compared in the country's local timezone.
 */
export function isInQuietHours(
  schedule: AlertSchedule | null | undefined,
  now: Date,
  country: 'PT' | 'ES',
): boolean {
  if (!schedule) return false
  const { quietStartHour: start, quietEndHour: end } = schedule
  if (start == null || end == null) return false

  const tz = country === 'ES' ? 'Europe/Madrid' : 'Europe/Lisbon'
  const localHour = Number(
    new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hour12: false, timeZone: tz }).format(now),
  )

  if (start === end) return false
  if (start < end) {
    // Same-day window, e.g. 10–18 → quiet between 10:00 and 18:00.
    return localHour >= start && localHour < end
  }
  // Wraps midnight, e.g. 22–08 → quiet 22:00–24:00 OR 00:00–08:00.
  return localHour >= start || localHour < end
}

/**
 * Whether today's ISO weekday is enabled for this alert.
 * Empty/absent weekdays array = always-on.
 */
export function isWeekdayEnabled(
  schedule: AlertSchedule | null | undefined,
  now: Date,
  country: 'PT' | 'ES',
): boolean {
  if (!schedule || !schedule.weekdays || schedule.weekdays.length === 0) return true
  const tz = country === 'ES' ? 'Europe/Madrid' : 'Europe/Lisbon'
  // ISO weekday: 1=Mon..7=Sun. JS getDay: 0=Sun..6=Sat.
  const localDayName = new Intl.DateTimeFormat('en-GB', { weekday: 'short', timeZone: tz }).format(now)
  const map: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 }
  const iso = map[localDayName] ?? 0
  return schedule.weekdays.includes(iso)
}

/** Pick the single most actionable match — earliest in time. */
export function pickPrimaryMatch(matches: AlertMatch[]): AlertMatch | null {
  if (matches.length === 0) return null
  return [...matches].sort((a, b) => a.ts.getTime() - b.ts.getTime())[0]!
}

/**
 * Hour:minute label for the INTERNAL `reason` descriptor only. The fixed Lisbon zone is
 * fine here because this string is for logs/debugging, never user-facing; the dispatcher
 * formats the user-visible hour in the user's own timezone (Europe/Lisbon | Europe/Madrid).
 */
function fmt(ts: Date): string {
  return ts.toLocaleTimeString('pt-PT', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Lisbon',
  })
}
