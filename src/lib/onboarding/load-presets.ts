/**
 * Onboarding load presets — pure, immutable, no I/O.
 *
 * The "light path" lets a user describe ONE primary shiftable load with a few taps
 * (e.g. "I charge an EV, ~40 kWh, 5 days/week, available 22h–07h") WITHOUT uploading
 * an invoice or CSV. This module turns that minimal description into the `ApplianceInput`
 * the planner already consumes — so the very first thing a new user sees is a real
 * cheapest-window recommendation for tomorrow, in euros.
 *
 * Design notes:
 *  - The charge-window optimizer (`charge-planner.ts`) and the DB constraint
 *    `earliest_hour < latest_hour` both model availability as a SINGLE contiguous
 *    local-hour window. It cannot express a wrap-around like 22→07. We therefore
 *    NORMALISE an overnight window to its larger contiguous sub-window (for 22→07
 *    that is 00:00–07:00, 7h, vs 22:00–24:00, 2h). For deep-night EV charging this
 *    keeps the part of the night where OMIE bottoms out (the VAZIO valley) and is a
 *    conservative, honest default the user can widen later in the planner.
 *  - Presets carry sensible PT/ES residential defaults for power and per-run energy
 *    so the math is bill-shaped even before the user types a single number.
 */

import type { ApplianceInput, ApplianceType } from '@/lib/db/appliance-queries'

/** The real, selectable light-path loads (no skip sentinel). The single source of truth. */
export const SELECTABLE_LOAD_PROFILES = ['ev', 'washer', 'dishwasher', 'water_heater'] as const

/** All light-path profile values, including the `'none'` skip sentinel. */
export const LOAD_PROFILES = [...SELECTABLE_LOAD_PROFILES, 'none'] as const
export type LoadProfile = (typeof LOAD_PROFILES)[number]

/** A user may choose a real load, or skip ("none") — skipping persists nothing. */
export type SelectableLoadProfile = (typeof SELECTABLE_LOAD_PROFILES)[number]

/** Coarse availability the UI offers as one-tap chips, mapped to local-hour windows. */
export const AVAILABILITY_PRESETS = ['overnight', 'daytime', 'anytime'] as const
export type AvailabilityPreset = (typeof AVAILABILITY_PRESETS)[number]

/** A contiguous local-hour window [earliestHour, latestHour) with earliest < latest. */
export interface HourWindow {
  earliestHour: number
  latestHour: number
}

/**
 * Coarse availability → a SINGLE contiguous local-hour window the planner can use.
 *
 * `overnight` deliberately resolves to 00:00–08:00 (not a wrap-around 22→08): it is
 * the deep VAZIO valley where day-ahead prices bottom out, and it is the larger,
 * cheaper half of a typical "after dinner until morning" availability. Users who
 * genuinely need the 22:00–24:00 slot can widen the window in the planner.
 */
export const AVAILABILITY_WINDOWS: Record<AvailabilityPreset, HourWindow> = {
  overnight: { earliestHour: 0, latestHour: 8 },
  daytime: { earliestHour: 9, latestHour: 18 },
  anytime: { earliestHour: 0, latestHour: 24 },
}

interface LoadPresetDefaults {
  type: ApplianceType
  /** Default energy delivered per run, kWh. */
  energyKwh: number
  /** Default appliance power draw, kW. */
  powerKw: number
  /** Typical cycle length, minutes (informational only). */
  typicalDurationMin: number
  /** Can the load be paused/resumed to cherry-pick scattered cheap hours? */
  interruptible: boolean
  /** Default coarse availability for this kind of load. */
  defaultAvailability: AvailabilityPreset
  /** Default runs per week (used to project a MONTHLY saving). */
  defaultDaysPerWeek: number
}

/**
 * PT/ES residential defaults per load profile.
 *  - EV: ~7.4 kW single-phase home AC charger; 40 kWh per session is a TVDE-sized top-up.
 *    Interruptible (the car doesn't care if charging pauses), naturally overnight.
 *  - Washer / dishwasher: ~1.0–1.2 kW, one cycle's worth of energy, NOT interruptible
 *    (a wash must run start-to-finish), available across the daytime by default.
 *  - Water heater (termoacumulador): ~1.5 kW, interruptible (reheats fine in cheap slots),
 *    overnight by default.
 */
const PRESETS: Record<SelectableLoadProfile, LoadPresetDefaults> = {
  ev: {
    type: 'ev',
    energyKwh: 40,
    powerKw: 7.4,
    typicalDurationMin: 330,
    interruptible: true,
    defaultAvailability: 'overnight',
    defaultDaysPerWeek: 5,
  },
  washer: {
    type: 'washer',
    energyKwh: 1.0,
    powerKw: 1.0,
    typicalDurationMin: 120,
    interruptible: false,
    defaultAvailability: 'anytime',
    defaultDaysPerWeek: 4,
  },
  dishwasher: {
    type: 'dishwasher',
    energyKwh: 1.2,
    powerKw: 1.2,
    typicalDurationMin: 150,
    interruptible: false,
    defaultAvailability: 'anytime',
    defaultDaysPerWeek: 5,
  },
  water_heater: {
    type: 'water_heater',
    energyKwh: 4.0,
    powerKw: 1.5,
    typicalDurationMin: 160,
    interruptible: true,
    defaultAvailability: 'overnight',
    defaultDaysPerWeek: 7,
  },
}

/** The defaults (energy, power, availability, runs/week) for a load profile. */
export function presetDefaults(profile: SelectableLoadProfile): LoadPresetDefaults {
  return PRESETS[profile]
}

/** What the user can override from the defaults during the light onboarding step. */
export interface LoadDescription {
  profile: SelectableLoadProfile
  /** Optional energy-per-run override, kWh. Falls back to the preset default. */
  energyKwh?: number
  /** Optional availability override. Falls back to the preset default. */
  availability?: AvailabilityPreset
  /** Optional runs-per-week override (1–7). Falls back to the preset default. */
  daysPerWeek?: number
}

const MAX_DAYS_PER_WEEK = 7
const MIN_DAYS_PER_WEEK = 1
const MAX_ENERGY_KWH = 500

/** Clamp helper — keeps user input inside the planner's sane bounds. */
function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/** Resolve runs-per-week from the description, clamped to [1, 7]. */
export function daysPerWeekFor(description: LoadDescription): number {
  const raw = description.daysPerWeek ?? PRESETS[description.profile].defaultDaysPerWeek
  if (!Number.isFinite(raw)) return PRESETS[description.profile].defaultDaysPerWeek
  return clamp(Math.round(raw), MIN_DAYS_PER_WEEK, MAX_DAYS_PER_WEEK)
}

/** Approximate runs PER MONTH from a days/week cadence (4.345 weeks per month). */
export const WEEKS_PER_MONTH = 52 / 12

export function runsPerMonthFor(description: LoadDescription): number {
  return daysPerWeekFor(description) * WEEKS_PER_MONTH
}

/** A human label for the appliance, per profile, in the requested locale-agnostic key. */
const DEFAULT_LABEL_KEY: Record<SelectableLoadProfile, string> = {
  ev: 'ev',
  washer: 'washer',
  dishwasher: 'dishwasher',
  water_heater: 'water_heater',
}

/**
 * Map a light-path load description to the `ApplianceInput` the DB/planner consume.
 *
 * `label` is supplied by the caller (already localised via the appliance type name);
 * everything else is derived from the preset + user overrides. Energy is clamped to a
 * positive, sane value; availability is resolved to a contiguous window the optimizer
 * accepts (earliest < latest always holds).
 */
export function loadDescriptionToAppliance(
  description: LoadDescription,
  label: string,
): ApplianceInput {
  const preset = PRESETS[description.profile]
  const availability = description.availability ?? preset.defaultAvailability
  const window = AVAILABILITY_WINDOWS[availability]

  const energyRaw = description.energyKwh ?? preset.energyKwh
  const energyKwh = clamp(
    Number.isFinite(energyRaw) && energyRaw > 0 ? energyRaw : preset.energyKwh,
    0.1,
    MAX_ENERGY_KWH,
  )

  return {
    label,
    type: preset.type,
    energyKwh,
    powerKw: preset.powerKw,
    typicalDurationMin: preset.typicalDurationMin,
    interruptible: preset.interruptible,
    earliestHour: window.earliestHour,
    latestHour: window.latestHour,
  }
}

/** The i18n key for an appliance type's display label (matches `plan.appliances.types.*`). */
export function labelKeyFor(profile: SelectableLoadProfile): string {
  return DEFAULT_LABEL_KEY[profile]
}

/**
 * Default runs-per-week for ANY appliance type (the planner stores no cadence yet, so the
 * monthly-saving teaser falls back to these). Types without a light-path preset (dryer,
 * pool_pump, home_battery, other) get a reasonable default rather than nothing.
 */
const DEFAULT_DAYS_PER_WEEK_BY_TYPE: Record<ApplianceType, number> = {
  ev: PRESETS.ev.defaultDaysPerWeek,
  washer: PRESETS.washer.defaultDaysPerWeek,
  dishwasher: PRESETS.dishwasher.defaultDaysPerWeek,
  water_heater: PRESETS.water_heater.defaultDaysPerWeek,
  home_battery: 7,
  dryer: 3,
  pool_pump: 7,
  other: 5,
}

export function defaultDaysPerWeekForType(type: ApplianceType): number {
  return DEFAULT_DAYS_PER_WEEK_BY_TYPE[type] ?? 5
}
