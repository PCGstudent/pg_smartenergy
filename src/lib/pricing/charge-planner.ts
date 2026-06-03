/**
 * Charge-window optimizer — pure, immutable, no I/O.
 *
 * Given an array of hourly FINAL customer prices (€/kWh — built with
 * `finalPricePerKwh` from `tariff-math.ts`, i.e. OMIE + markup + hourly TAR + taxes,
 * NEVER raw OMIE), plus an energy target and an appliance's power, it finds:
 *
 *   1. `contiguous`   — the cheapest single uninterrupted run that delivers the energy.
 *   2. `interruptible` — the cheapest SET of slots if the load can be paused/resumed.
 *
 * Both honour an optional local-hour availability window (Europe/Lisbon). Each plan
 * reports its start/end (UTC ISO + Lisbon local HH:MM), average €/kWh, total €, and
 * the € saved versus charging in the most expensive feasible window of the same shape.
 *
 * PRODUCT RULE: callers pass FINAL €/kWh. This module never sees raw OMIE.
 */

const LISBON_TZ = 'Europe/Lisbon'

export interface HourlyFinalPrice {
  /** Hour start (UTC `Date`). Slots are assumed to be 1 hour, sorted ascending by ts. */
  ts: Date
  /** All-in customer price for the hour, €/kWh (from `finalPricePerKwh`). */
  finalEurKwh: number
}

export interface ChargePlannerInput {
  /** Hourly final prices for the look-ahead window (e.g. tomorrow's 24h). */
  prices: HourlyFinalPrice[]
  /** Energy to deliver, kWh. */
  energyKwh: number
  /** Appliance power draw, kW. Number of hourly slots = ceil(energyKwh / powerKw). */
  powerKw: number
  /** Earliest allowed local start hour (0–24, inclusive). Default 0. Interpreted in `timeZone`. */
  earliestHour?: number
  /** Latest local hour by which charging must finish (0–24, exclusive). Default 24. Interpreted in `timeZone`. */
  latestHour?: number
  /**
   * IANA zone the availability hours and local labels are expressed in.
   * Default 'Europe/Lisbon' (PT). Pass 'Europe/Madrid' for ES so an ES user's
   * availability window matches Spanish wall-clock, not Lisbon's.
   */
  timeZone?: string
}

export interface PlanSlot {
  /** Hour start, UTC ISO. */
  ts: string
  /** Hour start in the zone passed to planChargeWindow (Europe/Lisbon for PT, Europe/Madrid for ES), HH:MM. */
  localTime: string
  /** Energy drawn in this slot, kWh (full power, or the remainder on the last slot). */
  kwh: number
  /** Final price for this slot, €/kWh. */
  eurKwh: number
  /** Cost of this slot, €. */
  eurCost: number
}

export interface ChargeWindow {
  /** First slot start, UTC ISO. */
  startTs: string
  /** End of the last slot, UTC ISO (start + 1h). */
  endTs: string
  /** First slot start in the zone passed to planChargeWindow (Europe/Lisbon for PT, Europe/Madrid for ES), HH:MM. */
  startLocal: string
  /** End of the last slot in the zone passed to planChargeWindow (Europe/Lisbon for PT, Europe/Madrid for ES), HH:MM. */
  endLocal: string
  /** Number of hourly slots occupied. */
  slots: number
  /** Energy-weighted average price across the window, €/kWh. */
  avgEurKwh: number
  /** Total cost of delivering the energy in this window, €. */
  totalEur: number
  /** Per-slot detail. */
  detail: PlanSlot[]
}

export interface ChargePlanResult {
  /** Total energy delivered, kWh (echoes input). */
  energyKwh: number
  /** Whole hourly slots required = ceil(energyKwh / powerKw). */
  slotsNeeded: number
  /** Cheapest uninterrupted window, or null if no feasible window fits. */
  contiguous: ChargeWindow | null
  /** Cheapest pausable set of slots, or null if not enough feasible slots. */
  interruptible: ChargeWindow | null
  /** Most expensive feasible contiguous window of the same size (the baseline we beat). */
  worstContiguous: ChargeWindow | null
  /** € saved by `contiguous` vs `worstContiguous` (0 when only one window fits). */
  savedVsWorstEur: number
  /** € saved by `interruptible` vs `contiguous` (≥ 0; the value of being pausable). */
  interruptibleSavingEur: number
  /**
   * The N (`slotsNeeded`) cheapest hours of the WHOLE day, IGNORING the availability
   * window, assembled like an interruptible set. Populated ONLY when the availability
   * window is too narrow to fit the load (`availabilityConstrained === true`) so the UI
   * can still offer "the cheapest hours of tomorrow" instead of a dead "no window".
   * Null whenever a real feasible window exists (the normal case) or there are simply
   * fewer priced hours than the load needs.
   */
  fallbackCheapest: ChargeWindow | null
  /**
   * True when `contiguous`/`interruptible` are null *because the availability window was
   * too narrow* (feasible slots < slotsNeeded) yet the day as a whole has enough hours to
   * cover the load — i.e. widening the hours would help. Drives the "widen hours" affordance.
   */
  availabilityConstrained: boolean
}

/**
 * Plan the cheapest charge window(s). Pure function — does not mutate `input`.
 *
 * Energy model: the appliance occupies `ceil(energyKwh / powerKw)` whole hourly slots.
 * Every slot but the last draws `powerKw` kWh; the last draws the remainder. Cost is the
 * sum of (slot energy × slot final €/kWh). A partial last slot is what makes "duration
 * longer than the cheap valley" cost honestly more.
 *
 * DST note: on a spring-forward day `prices` carries only 23 hourly rows (one local hour
 * does not exist), and 25 on a fall-back day. The optimizer is agnostic to this — it scans
 * whatever feasible slots it is given and `isClockContiguous` rejects any run with a 1h gap,
 * so a short/long day simply yields fewer/more candidate windows. No special-casing needed.
 */
export function planChargeWindow(input: ChargePlannerInput): ChargePlanResult {
  const energyKwh = input.energyKwh
  const powerKw = input.powerKw
  const earliest = input.earliestHour ?? 0
  const latest = input.latestHour ?? 24
  const timeZone = input.timeZone ?? LISBON_TZ

  if (!(energyKwh > 0) || !(powerKw > 0)) {
    return emptyResult(energyKwh, 0)
  }

  const slotsNeeded = Math.ceil(energyKwh / powerKw)
  const remainderKwh = energyKwh - powerKw * (slotsNeeded - 1) // (0, powerKw]
  const slotEnergies = buildSlotEnergies(slotsNeeded, powerKw, remainderKwh)

  // Every priced hour as a candidate slot (availability ignored). Used both to build the
  // feasible subset below and, when that subset is too small, the whole-day fallback.
  const allSlots: FeasibleSlot[] = input.prices.map((p, index) => ({
    index,
    ts: p.ts,
    eurKwh: p.finalEurKwh,
  }))

  // Feasible slots: 1h slots whose local start hour is within [earliest, latest)
  // AND whose whole hour finishes by `latest`. We require the slot's local start hour h to
  // satisfy earliest <= h and h + 1 <= latest, i.e. h < latest (since slots are 1h).
  const feasible = allSlots.filter((s) => {
    const h = localHour(s.ts, timeZone)
    return h >= earliest && h + 1 <= latest
  })

  if (feasible.length < slotsNeeded) {
    // The availability window can't fit the load. Rather than returning a dead "no window",
    // surface the N cheapest hours of the WHOLE day so the user still gets actionable advice
    // (and a hint to widen their hours). `availabilityConstrained` is true only when the day
    // as a whole DOES have enough hours — i.e. widening would actually help.
    const fallbackCheapest = cheapestInterruptible(allSlots, slotsNeeded, slotEnergies, timeZone)
    return {
      energyKwh,
      slotsNeeded,
      contiguous: null,
      interruptible: null,
      worstContiguous: null,
      savedVsWorstEur: 0,
      interruptibleSavingEur: 0,
      fallbackCheapest,
      availabilityConstrained: fallbackCheapest !== null,
    }
  }

  const { best, worst } = bestAndWorstContiguous(
    feasible,
    slotsNeeded,
    powerKw,
    remainderKwh,
    timeZone,
  )
  const interruptible = cheapestInterruptible(feasible, slotsNeeded, slotEnergies, timeZone)

  const contiguousTotal = best?.totalEur ?? Infinity
  const interruptibleTotal = interruptible?.totalEur ?? Infinity
  const savedVsWorstEur = best && worst ? round6(worst.totalEur - best.totalEur) : 0
  const interruptibleSavingEur =
    interruptible && best ? round6(Math.max(0, contiguousTotal - interruptibleTotal)) : 0

  return {
    energyKwh,
    slotsNeeded,
    contiguous: best,
    interruptible,
    worstContiguous: worst,
    savedVsWorstEur,
    interruptibleSavingEur,
    fallbackCheapest: null,
    availabilityConstrained: false,
  }
}

/** Energy per slot: full power for all but the last, remainder for the last. Index 0..n-1. */
function buildSlotEnergies(slotsNeeded: number, powerKw: number, remainderKwh: number): number[] {
  return Array.from({ length: slotsNeeded }, (_, i) =>
    i < slotsNeeded - 1 ? powerKw : remainderKwh,
  )
}

interface FeasibleSlot {
  index: number
  ts: Date
  eurKwh: number
}

/**
 * Scan every contiguous run of `slotsNeeded` *adjacent* feasible slots (adjacent in the
 * original price array — i.e. consecutive hours with no availability gap between them) and
 * return the cheapest and most expensive by total cost.
 */
function bestAndWorstContiguous(
  feasible: FeasibleSlot[],
  slotsNeeded: number,
  powerKw: number,
  remainderKwh: number,
  timeZone: string,
): { best: ChargeWindow | null; worst: ChargeWindow | null } {
  let best: ChargeWindow | null = null
  let worst: ChargeWindow | null = null

  for (let i = 0; i + slotsNeeded <= feasible.length; i++) {
    const run = feasible.slice(i, i + slotsNeeded)
    // Require the run to be truly contiguous in clock time (no excluded hour in the middle).
    if (!isClockContiguous(run)) continue

    const window = windowFromOrderedSlots(run, powerKw, remainderKwh, timeZone)
    if (best === null || window.totalEur < best.totalEur) best = window
    if (worst === null || window.totalEur > worst.totalEur) worst = window
  }

  return { best, worst }
}

/** True when the run's slots are consecutive hours (each 1h after the previous). */
function isClockContiguous(run: FeasibleSlot[]): boolean {
  for (let i = 1; i < run.length; i++) {
    const prev = run[i - 1]!
    const cur = run[i]!
    if (cur.ts.getTime() - prev.ts.getTime() !== 3600_000) return false
  }
  return true
}

/**
 * Build a window from slots ALREADY in clock order. The remainder (smallest energy chunk)
 * is assigned to the last slot for a contiguous run (the appliance ramps down at the end).
 */
function windowFromOrderedSlots(
  ordered: FeasibleSlot[],
  powerKw: number,
  remainderKwh: number,
  timeZone: string,
): ChargeWindow {
  const slotsNeeded = ordered.length
  const detail: PlanSlot[] = ordered.map((s, i) => {
    const kwh = i < slotsNeeded - 1 ? powerKw : remainderKwh
    return slotDetail(s, kwh, timeZone)
  })
  return assembleWindow(detail, ordered, timeZone)
}

/**
 * Cheapest interruptible set: pick the `slotsNeeded` cheapest feasible slots, then assign
 * the SMALLEST energy chunk (the remainder) to the MOST EXPENSIVE chosen slot and full power
 * to the rest — the cost-minimal assignment of fixed energy chunks to fixed prices. The
 * returned window is reported in clock order for display, but cost is assignment-optimal.
 */
function cheapestInterruptible(
  feasible: FeasibleSlot[],
  slotsNeeded: number,
  slotEnergies: number[],
  timeZone: string,
): ChargeWindow | null {
  if (feasible.length < slotsNeeded) return null

  const byPriceAsc = [...feasible].sort((a, b) => a.eurKwh - b.eurKwh)
  const chosen = byPriceAsc.slice(0, slotsNeeded)

  // Energy chunks sorted DESC so the biggest energy lands on the cheapest slot.
  const energiesDesc = [...slotEnergies].sort((a, b) => b - a)
  // `chosen` is price-ascending → pairing chosen[i] with energiesDesc[i] gives
  // cheapest price × largest energy, i.e. the minimal total cost.
  const energyByIndex = new Map<number, number>()
  chosen.forEach((s, i) => energyByIndex.set(s.index, energiesDesc[i]!))

  const orderedForDisplay = [...chosen].sort((a, b) => a.ts.getTime() - b.ts.getTime())
  const detail = orderedForDisplay.map((s) => slotDetail(s, energyByIndex.get(s.index)!, timeZone))

  return assembleWindow(detail, orderedForDisplay, timeZone)
}

function slotDetail(s: FeasibleSlot, kwh: number, timeZone: string): PlanSlot {
  return {
    ts: s.ts.toISOString(),
    localTime: localHhmm(s.ts, timeZone),
    kwh: round6(kwh),
    eurKwh: round6(s.eurKwh),
    eurCost: round6(s.eurKwh * kwh),
  }
}

/** Assemble a ChargeWindow from per-slot detail + the clock-ordered source slots. */
function assembleWindow(
  detail: PlanSlot[],
  ordered: FeasibleSlot[],
  timeZone: string,
): ChargeWindow {
  const first = ordered[0]!
  const last = ordered[ordered.length - 1]!
  const endTs = new Date(last.ts.getTime() + 3600_000)
  const totalEur = detail.reduce((sum, d) => sum + d.eurCost, 0)
  const totalKwh = detail.reduce((sum, d) => sum + d.kwh, 0)
  return {
    startTs: first.ts.toISOString(),
    endTs: endTs.toISOString(),
    startLocal: localHhmm(first.ts, timeZone),
    endLocal: localHhmm(endTs, timeZone),
    slots: ordered.length,
    avgEurKwh: totalKwh > 0 ? round6(totalEur / totalKwh) : 0,
    totalEur: round6(totalEur),
    detail,
  }
}

function emptyResult(energyKwh: number, slotsNeeded: number): ChargePlanResult {
  return {
    energyKwh,
    slotsNeeded,
    contiguous: null,
    interruptible: null,
    worstContiguous: null,
    savedVsWorstEur: 0,
    interruptibleSavingEur: 0,
    fallbackCheapest: null,
    availabilityConstrained: false,
  }
}

/** Local hour-of-day (0–23) for an instant in a given IANA zone (default Lisbon). */
function localHour(ts: Date, timeZone: string = LISBON_TZ): number {
  return Number(
    new Intl.DateTimeFormat('en-GB', {
      hour: '2-digit',
      hour12: false,
      timeZone,
    }).format(ts),
  )
}

/** Local HH:MM for an instant in a given IANA zone (default Lisbon). */
function localHhmm(ts: Date, timeZone: string = LISBON_TZ): string {
  return new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone,
  }).format(ts)
}

/** Round to 6 dp to kill FP dust without losing cent precision. */
function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6
}
