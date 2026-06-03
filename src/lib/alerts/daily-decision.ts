/**
 * DAILY alert decision engine — pure, immutable, no I/O, fully unit-testable.
 *
 * This is the once-a-day ANCHOR engine (distinct from `evaluator.ts`, which is the
 * hourly Smart Guard working on raw wholesale €/MWh). It runs after tomorrow's
 * day-ahead prices land (~12:45) and decides which of three messages a user should
 * get for TOMORROW:
 *
 *   1. `anchor`  — "tomorrow's charging window": the user's primary load's cheapest
 *                  FINAL-price window + € saved, straight from the `charge-planner`
 *                  optimum (via the already-built `DayPlan`).
 *   2. `free`    — "free / near-free energy": tomorrow has FINAL hours at/below a
 *                  near-zero threshold (or negative — the strongest signal).
 *   3. `spike`   — "price spike to avoid": tomorrow has an expensive contiguous block.
 *
 * PRODUCT RULE (non-negotiable): every threshold and figure here is on the FINAL
 * customer price (OMIE + tariff markup + hourly TAR + taxes) in €/kWh — NEVER raw
 * OMIE €/MWh. A "cheap window" on raw OMIE alone is dishonest vs the real bill, so
 * this module only ever sees the resolved FINAL curve.
 *
 * Output is a list of serializable `DailyDecision`s carrying the RAW numbers (times,
 * €/kWh, € totals). Copy lives in `daily-messages.ts`; delivery in `daily-delivery.ts`.
 */

import type { CurvePoint, DayPlan } from '@/lib/pricing/plan-builder'
import { primaryAppliance, recommendedWindow, bestSaving } from '@/lib/pricing/plan-format'
import type { AlertType } from './evaluator'

/** Near-zero FINAL price (€/kWh) at/below which we call energy "near-free" tomorrow. */
export const FREE_FINAL_EUR_KWH = 0.02
/** A FINAL price (€/kWh) above which an hour is "expensive" for the spike block. */
export const SPIKE_FINAL_EUR_KWH = 0.25
/** Minimum € saved by the anchor window before we bother messaging it. */
export const ANCHOR_MIN_SAVING_EUR = 0.1
/** Minimum contiguous hours of expensive prices to call it a "spike block". */
export const SPIKE_MIN_HOURS = 2

/** The three daily message kinds this engine can emit. */
export type DailyDecisionKind = 'anchor' | 'free' | 'spike'

/** Maps each user-subscribed `AlertType` to the daily kind it should trigger. */
const TYPE_TO_KIND: Record<AlertType, DailyDecisionKind> = {
  cheap_hour: 'anchor',
  free_energy: 'free',
  negative: 'free',
  spike: 'spike',
}

/** A contiguous local-hour block of the FINAL curve (used for free + spike). */
export interface CurveBlock {
  /** Start hour start, UTC ISO. */
  startTs: string
  /** End of the last hour, UTC ISO (start + 1h). */
  endTs: string
  /** Local HH:MM of the first hour (zone passed to the builder). */
  startLocal: string
  /** Local HH:MM of the end of the last hour. */
  endLocal: string
  /** Number of contiguous hours in the block. */
  hours: number
  /** Cheapest FINAL €/kWh in the block (the headline for `free`). */
  minEurKwh: number
  /** Most expensive FINAL €/kWh in the block (the headline for `spike`). */
  maxEurKwh: number
  /** Mean FINAL €/kWh across the block. */
  avgEurKwh: number
}

/** The anchor recommendation: the primary load's cheapest window + € saved. */
export interface AnchorDecision {
  kind: 'anchor'
  applianceLabel: string
  applianceType: string
  /** Local window label parts (e.g. start "02:00", end "08:00"). */
  startLocal: string
  endLocal: string
  startTs: string
  endTs: string
  /** Energy-weighted average FINAL €/kWh of the window. */
  avgEurKwh: number
  /** Total € cost of charging in the window. */
  totalEur: number
  /** € saved versus the worst feasible window of the same shape. */
  savedEur: number
}

/** The free / near-free decision. `negative` is true when any hour is < 0 €/kWh. */
export interface FreeDecision {
  kind: 'free'
  /** The cheapest contiguous near-free block. */
  block: CurveBlock
  /** True when at least one hour in the block is strictly below 0 €/kWh. */
  negative: boolean
}

/** The price-spike decision — the most expensive contiguous block to avoid. */
export interface SpikeDecision {
  kind: 'spike'
  block: CurveBlock
}

export type DailyDecision = AnchorDecision | FreeDecision | SpikeDecision

export interface DecideDailyInput {
  /** The built day plan for TOMORROW (FINAL curve + per-appliance windows). */
  plan: DayPlan
  /** The distinct alert types the user is subscribed to (drives which kinds we emit). */
  subscribedTypes: AlertType[]
}

/**
 * Decide every daily message a user should receive for tomorrow, on the FINAL curve.
 *
 * Pure — does not mutate inputs. Returns an empty array when nothing is worth saying
 * (e.g. a flat day with no valley, no spike, and no meaningful charge saving). The
 * runner picks the single most useful message to actually send; this returns all
 * that qualify so the runner (and tests) can reason about the full decision set.
 */
export function decideDaily(input: DecideDailyInput): DailyDecision[] {
  const kinds = wantedKinds(input.subscribedTypes)
  const out: DailyDecision[] = []

  if (kinds.has('anchor')) {
    const anchor = decideAnchor(input.plan)
    if (anchor) out.push(anchor)
  }
  if (kinds.has('free')) {
    const free = decideFree(input.plan.curve)
    if (free) out.push(free)
  }
  if (kinds.has('spike')) {
    const spike = decideSpike(input.plan.curve)
    if (spike) out.push(spike)
  }

  return out
}

/** The set of daily kinds implied by a user's subscribed alert types. */
function wantedKinds(types: AlertType[]): Set<DailyDecisionKind> {
  const kinds = new Set<DailyDecisionKind>()
  for (const t of types) kinds.add(TYPE_TO_KIND[t])
  return kinds
}

/**
 * The anchor: the primary appliance's recommended window + € saved. Returns null when
 * there is no appliance, no feasible window, or the saving is below ANCHOR_MIN_SAVING_EUR
 * (charging is already cheap whenever you plug in — nothing to nudge).
 */
export function decideAnchor(plan: DayPlan): AnchorDecision | null {
  const primary = primaryAppliance(plan.appliances)
  if (!primary) return null

  const window = recommendedWindow(primary)
  if (!window) return null

  const savedEur = bestSaving(primary)
  if (savedEur < ANCHOR_MIN_SAVING_EUR) return null

  return {
    kind: 'anchor',
    applianceLabel: primary.label,
    applianceType: primary.type,
    startLocal: window.startLocal,
    endLocal: window.endLocal,
    startTs: window.startTs,
    endTs: window.endTs,
    avgEurKwh: window.avgEurKwh,
    totalEur: window.totalEur,
    savedEur: round2(savedEur),
  }
}

/**
 * Free / near-free: the CHEAPEST contiguous block whose every hour is at/below
 * FREE_FINAL_EUR_KWH. Returns null when no such block exists. `negative` flags a block
 * containing a sub-zero hour (the grid pays you — the strongest version of the message).
 */
export function decideFree(curve: CurvePoint[]): FreeDecision | null {
  const blocks = contiguousBlocks(curve, (p) => p.finalEurKwh <= FREE_FINAL_EUR_KWH)
  if (blocks.length === 0) return null

  // Cheapest block = lowest min FINAL price; ties broken by longer duration.
  const best = blocks.reduce((a, b) =>
    b.block.minEurKwh < a.block.minEurKwh ||
    (b.block.minEurKwh === a.block.minEurKwh && b.block.hours > a.block.hours)
      ? b
      : a,
  )

  return { kind: 'free', block: best.block, negative: best.hasNegative }
}

/**
 * Price spike: the most EXPENSIVE contiguous block of at least SPIKE_MIN_HOURS hours
 * all above SPIKE_FINAL_EUR_KWH. Returns null when tomorrow has no such block. We require
 * a multi-hour block so a single pricey hour doesn't cry wolf — the message is "avoid
 * heavy use across this window".
 */
export function decideSpike(curve: CurvePoint[]): SpikeDecision | null {
  const blocks = contiguousBlocks(curve, (p) => p.finalEurKwh > SPIKE_FINAL_EUR_KWH).filter(
    (b) => b.block.hours >= SPIKE_MIN_HOURS,
  )
  if (blocks.length === 0) return null

  // Most expensive block = highest peak FINAL price; ties broken by longer duration.
  const worst = blocks.reduce((a, b) =>
    b.block.maxEurKwh > a.block.maxEurKwh ||
    (b.block.maxEurKwh === a.block.maxEurKwh && b.block.hours > a.block.hours)
      ? b
      : a,
  )

  return { kind: 'spike', block: worst.block }
}

interface BlockWithFlags {
  block: CurveBlock
  hasNegative: boolean
}

/**
 * Split the (time-sorted) curve into maximal runs of consecutive hours matching `pred`.
 * "Consecutive" = each hour starts exactly 1h after the previous (no gap), so a missing
 * hour breaks the block. Each run is summarised into a `CurveBlock`.
 */
function contiguousBlocks(
  curve: CurvePoint[],
  pred: (p: CurvePoint) => boolean,
): BlockWithFlags[] {
  const sorted = [...curve].sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts))
  const out: BlockWithFlags[] = []
  let run: CurvePoint[] = []

  const flush = () => {
    if (run.length > 0) out.push(summarise(run))
    run = []
  }

  for (const p of sorted) {
    if (!pred(p)) {
      flush()
      continue
    }
    const prev = run[run.length - 1]
    if (prev && Date.parse(p.ts) - Date.parse(prev.ts) !== 3600_000) {
      // Matches the predicate but isn't clock-adjacent to the open run → start a new run.
      flush()
    }
    run.push(p)
  }
  flush()

  return out
}

/** Summarise a non-empty contiguous run of hours into a CurveBlock (+ negative flag). */
function summarise(run: CurvePoint[]): BlockWithFlags {
  const first = run[0]!
  const last = run[run.length - 1]!
  const endTs = new Date(Date.parse(last.ts) + 3600_000)
  const finals = run.map((p) => p.finalEurKwh)
  const sum = finals.reduce((s, v) => s + v, 0)

  return {
    block: {
      startTs: first.ts,
      endTs: endTs.toISOString(),
      startLocal: first.localTime,
      endLocal: endLocalLabel(last),
      hours: run.length,
      minEurKwh: round6(Math.min(...finals)),
      maxEurKwh: round6(Math.max(...finals)),
      avgEurKwh: round6(sum / run.length),
    },
    hasNegative: finals.some((v) => v < 0),
  }
}

/**
 * Local HH:MM for the END of a block, derived from the last hour's local label + 1h
 * (e.g. last hour "07:00" → end "08:00"), staying in the same 24h wall-clock the curve
 * already uses, with a clean "24:00" for an end at local midnight.
 *
 * Minutes are hardcoded ':00': the data model is strictly hourly (every market_prices row
 * starts on the hour). Deriving minutes from the last point would risk an invalid "24:30"
 * if a future sub-hourly source ever landed — the hour math below assumes whole hours.
 */
function endLocalLabel(lastPoint: CurvePoint): string {
  const endHour = (lastPoint.localHour + 1) % 24
  const labelHour = endHour === 0 ? 24 : endHour
  return `${pad2(labelHour)}:00`
}

function pad2(n: number): string {
  return n.toString().padStart(2, '0')
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6
}
