/**
 * DAILY alert runner — orchestration for the once-a-day ANCHOR engine.
 *
 * Runs after tomorrow's day-ahead prices land (~12:45). Per user with active alerts it:
 *   1. builds TOMORROW's FINAL-price plan (OMIE + tariff markup + hourly TAR + taxes)
 *      via the SAME `buildDayPlan` the planner page uses (so the message matches the UI),
 *   2. decides the anchor / free / spike messages on the FINAL curve (`decideDaily`),
 *   3. renders each in the user's locale (euros only), and
 *   4. delivers on the user's channels and records an `alert_events` row per attempt.
 *
 * Idempotent: a per-(user, kind) "already sent for tomorrow" guard keyed on the target
 * local date means a re-run (Inngest retry, manual replay) sends nothing twice.
 *
 * Delivery is injected (`DailyAlertDelivery`) so tests exercise the decision + message
 * content with a fake recorder and never touch push / WhatsApp.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { createSupabaseService } from '@/lib/supabase/server'
import { getPricesInRange, type Zone } from '@/lib/db/queries'
import { listActiveAppliancesForUser, type Appliance } from '@/lib/db/appliance-queries'
import {
  insertAlertEvent,
  listActiveAlertsWithProfile,
  recentAlertEvents,
  setProfilePushSubscription,
  type AlertWithProfile,
} from '@/lib/db/alert-queries'
import { resolvePlanTariff } from '@/lib/pricing/plan-tariff'
import { buildDayPlan, type PlanAppliance, type PlanTariff } from '@/lib/pricing/plan-builder'
import { computeDailySaving } from '@/lib/pricing/savings-ledger'
import { upsertDailySaving } from '@/lib/db/savings-queries'
import { tomorrowWindow } from '@/lib/pricing/day-window'
import { decideDaily, type DailyDecision, type DailyDecisionKind } from './daily-decision'
import { buildDailyMessage, type DailyMessage } from './daily-messages'
import { createDailyTranslator, resolveMessageLocale } from './daily-i18n'
import {
  createDefaultDelivery,
  type DailyAlertDelivery,
  type DeliveryResult,
  type DeliveryTarget,
} from './daily-delivery'
import type { AlertType } from './evaluator'

/** Don't re-send the same daily kind to a user within this many hours (one run/day). */
const DAILY_COOLDOWN_HOURS = 12

/**
 * Max delivery attempts (sent OR failed/skipped) for one kind+targetDate inside the cooldown
 * before we stop retrying. Caps retry noise for a persistently-misconfigured channel (e.g. a
 * push subscription that keeps 410-ing) so Inngest retries / the cron don't spam alert_events.
 */
const DAILY_MAX_ATTEMPTS = 3

export interface DailyRunSummary {
  /** Active alert rows considered. */
  alerts: number
  /** Distinct users with at least one active alert + a usable country. */
  users: number
  /** Decisions produced across all users (anchor + free + spike that qualified). */
  decisions: number
  /** Messages handed to a channel successfully. */
  delivered: number
  /** Attempts skipped (cooldown / no plan / no channel target). */
  skipped: number
  /** Delivery attempts that failed. */
  failed: number
}

export interface DailyRunOptions {
  /** Reference instant; "tomorrow" is the next local day from here. Default: now. */
  now?: Date
  /** Injected delivery (tests pass a fake). Default: real push + WhatsApp. */
  delivery?: DailyAlertDelivery
  /** Injected Supabase client (tests pass a stub). Default: service-role client. */
  client?: SupabaseClient
}

/**
 * Run the daily anchor for every active-alert user. Pure orchestration over injected
 * I/O — safe to call from an Inngest cron, the CLI script, or a test.
 */
export async function runDailyAnchors(options: DailyRunOptions = {}): Promise<DailyRunSummary> {
  const now = options.now ?? new Date()
  const client = options.client ?? createSupabaseService()
  const delivery = options.delivery ?? createDefaultDelivery()

  const alerts = await listActiveAlertsWithProfile(client)
  const summary: DailyRunSummary = {
    alerts: alerts.length,
    users: 0,
    decisions: 0,
    delivered: 0,
    skipped: 0,
    failed: 0,
  }
  if (alerts.length === 0) return summary

  const users = groupByUser(alerts)
  summary.users = users.length

  // Amortize the price fetch: one window per country, shared across that country's users.
  const pricesByCountry = await loadPricesByCountry(client, users, now)

  for (const user of users) {
    const result = await processUser(client, delivery, user, pricesByCountry, now)
    summary.decisions += result.decisions
    summary.delivered += result.delivered
    summary.skipped += result.skipped
    summary.failed += result.failed
  }

  return summary
}

/** A user's aggregated alert state: their rows + shared profile fields. */
interface UserAlerts {
  userId: string
  country: Zone
  locale: string | null
  pushSubscription: AlertWithProfile['profile']['push_subscription']
  whatsappE164: string | null
  alerts: AlertWithProfile[]
}

/** Collapse alert rows into one entry per user (alerts share a single profile). */
function groupByUser(alerts: AlertWithProfile[]): UserAlerts[] {
  const byUser = new Map<string, UserAlerts>()
  for (const a of alerts) {
    const country = a.profile?.country
    if (country !== 'PT' && country !== 'ES') continue
    const existing = byUser.get(a.user_id)
    if (existing) {
      existing.alerts.push(a)
      continue
    }
    byUser.set(a.user_id, {
      userId: a.user_id,
      country,
      locale: a.profile.locale,
      pushSubscription: a.profile.push_subscription,
      whatsappE164: a.profile.whatsapp_e164,
      alerts: [a],
    })
  }
  return [...byUser.values()]
}

/** Tomorrow's wholesale prices per country (narrowed to the builder's input shape). */
type CountryPrices = Map<Zone, { ts: Date; priceEurMwh: number }[]>

async function loadPricesByCountry(
  client: SupabaseClient,
  users: UserAlerts[],
  now: Date,
): Promise<CountryPrices> {
  const countries = new Set<Zone>(users.map((u) => u.country))
  const out: CountryPrices = new Map()
  for (const country of countries) {
    const timeZone = zoneTimeZone(country)
    const window = tomorrowWindow(now, timeZone)
    const rows = await getPricesInRange(country, window.startUtc, window.endUtc).catch(() => [])
    out.set(
      country,
      rows.map((r) => ({ ts: r.ts as Date, priceEurMwh: Number(r.priceEurMwh) })),
    )
  }
  return out
}

interface UserResult {
  decisions: number
  delivered: number
  skipped: number
  failed: number
}

async function processUser(
  client: SupabaseClient,
  delivery: DailyAlertDelivery,
  user: UserAlerts,
  pricesByCountry: CountryPrices,
  now: Date,
): Promise<UserResult> {
  const out: UserResult = { decisions: 0, delivered: 0, skipped: 0, failed: 0 }

  const prices = pricesByCountry.get(user.country) ?? []
  if (prices.length === 0) return out // tomorrow's prices not published yet → nothing to say.

  const timeZone = zoneTimeZone(user.country)
  const tariff = await resolvePlanTariff(client, user.userId, user.country).catch(() => null)
  const planTariff = usableTariff(tariff)
  if (!planTariff) return out // no indexed tariff → a flat curve gives no honest advice.

  const appliances = await listActiveAppliancesForUser(client, user.userId).catch(
    () => [] as Appliance[],
  )

  // LIMITATION: TAR cycle is hardcoded 'simples'. A bi/tri-horário user's FINAL curve is
  // therefore computed with the flat simples TAR (~0.0607 €/kWh) instead of their actual
  // VAZIO/FORA_VAZIO split, slightly mispricing off-peak hours (errs toward under-estimating
  // off-peak TAR). Correct fix: read the user's cycle from their profile/tariff and pass it
  // here. Tracked for a follow-up; the anchor direction stays right because the OMIE-driven
  // valley dominates the hour-to-hour shape.
  const plan = buildDayPlan({
    prices,
    tariff: planTariff,
    appliances: appliances.map(toPlanAppliance),
    cycle: 'simples',
    counting: 'diario',
    timeZone,
  })

  // Persist the day's realized "€ saved" into the ledger (the cumulative stickiness
  // figure on /plan + /dashboard). Idempotent per (user, planned-date) so a re-run /
  // retry overwrites rather than double-counts. Best-effort: a ledger write failure must
  // never abort alert delivery, so we swallow it (the upsert itself logs nothing).
  await recordDailySaving(client, user, plan, appliances, now)

  const subscribedTypes = distinctTypes(user.alerts)
  const decisions = decideDaily({ plan, subscribedTypes })
  out.decisions = decisions.length
  if (decisions.length === 0) return out

  const localeKey = resolveMessageLocale(user.locale)
  const t = await createDailyTranslator(localeKey)
  const targetDate = tomorrowWindow(now, timeZone).localDate

  // Resolve the user's email ONLY when an email channel is actually in play (avoids an
  // admin lookup per user otherwise). Email lives on auth.users, not profiles.
  const emailCtx = userWantsEmail(user.alerts)
    ? {
        email: await resolveUserEmail(client, user.userId),
        ctaLabel: t('emailCta'),
        footnote: t('emailFootnote'),
      }
    : null

  for (const decision of decisions) {
    const owner = ownerAlert(user.alerts, decision.kind)
    if (!owner) {
      out.skipped++
      continue
    }
    const message = buildDailyMessage(decision, t, localeKey)
    const channels = channelsFor(user.alerts, decision.kind)
    const r = await deliverDecision(
      client,
      delivery,
      user,
      owner,
      decision,
      message,
      channels,
      targetDate,
      now,
      emailCtx,
    )
    out.delivered += r.delivered
    out.skipped += r.skipped
    out.failed += r.failed
  }

  return out
}

/** Localized email context resolved once per user when an email channel is requested. */
interface EmailContext {
  email: string | null
  ctaLabel: string
  footnote: string
}

/** True when any of the user's alerts routes to the email channel. */
function userWantsEmail(alerts: AlertWithProfile[]): boolean {
  return alerts.some((a) => a.channels.includes('email'))
}

/**
 * Look up a user's email from auth.users via the service-role admin API. Returns null on
 * any failure (missing key, user not found) so a missing email degrades to a skip, never
 * a thrown run. Only called when an email channel is actually requested.
 */
async function resolveUserEmail(client: SupabaseClient, userId: string): Promise<string | null> {
  try {
    const { data, error } = await client.auth.admin.getUserById(userId)
    if (error) return null
    return data.user?.email ?? null
  } catch {
    return null
  }
}

interface DeliverResult {
  delivered: number
  skipped: number
  failed: number
}

/**
 * Deliver ONE decision to a user across its channels, with a per-(kind) daily cooldown,
 * recording an `alert_events` row per attempt. The cooldown is checked once per decision
 * (not per channel) so a user gets each kind at most once per day across all channels.
 */
async function deliverDecision(
  client: SupabaseClient,
  delivery: DailyAlertDelivery,
  user: UserAlerts,
  owner: AlertWithProfile,
  decision: DailyDecision,
  message: DailyMessage,
  channels: string[],
  targetDate: string,
  now: Date,
  emailCtx: EmailContext | null,
): Promise<DeliverResult> {
  const out: DeliverResult = { delivered: 0, skipped: 0, failed: 0 }

  if (await alreadySentToday(client, owner.id, decision.kind, targetDate, now)) {
    out.skipped += channels.length
    return out
  }

  for (const channel of channels) {
    const target: DeliveryTarget = {
      url: '/plan',
      tag: `daily-${decision.kind}-${targetDate}`,
      pushSubscription: user.pushSubscription,
      whatsappE164: user.whatsappE164,
      email: emailCtx?.email ?? null,
      emailCtaLabel: emailCtx?.ctaLabel,
      emailFootnote: emailCtx?.footnote,
    }
    let result: DeliveryResult
    if (channel === 'push') {
      result = await delivery.sendPush(message, target)
    } else if (channel === 'whatsapp') {
      result = await delivery.sendWhatsApp(message, target)
    } else if (channel === 'email') {
      result = await delivery.sendEmail(message, target)
    } else {
      await recordEvent(client, owner.id, user.userId, channel, 'skipped', {
        kind: decision.kind,
        target_date: targetDate,
        reason: 'unknown_channel',
      })
      out.skipped++
      continue
    }

    if (result.subscriptionExpired) {
      await setProfilePushSubscription(client, user.userId, null).catch(() => {})
    }

    if (result.delivered) {
      await recordEvent(client, owner.id, user.userId, channel, 'sent', {
        kind: decision.kind,
        target_date: targetDate,
        title: message.title,
        body: message.body,
        ...decisionPayload(decision),
      })
      out.delivered++
    } else {
      await recordEvent(client, owner.id, user.userId, channel, 'failed', {
        kind: decision.kind,
        target_date: targetDate,
        error: result.error ?? 'unknown_error',
      })
      out.failed++
    }
  }

  return out
}

/**
 * True when this kind+targetDate is already "handled" within the daily cooldown — either
 * because it was SENT, or because we've already burned DAILY_MAX_ATTEMPTS tries on it. The
 * `target_date` payload match makes the guard robust to clock drift across a retry: the same
 * tomorrow never double-sends even if `now` shifts slightly.
 *
 * The guard is keyed on `alertId` (the owner alert's id). That is correct because
 * `channelsFor` aggregates EVERY channel for a given kind under that single owner alert, so
 * all of a kind's events are recorded against this one id. If channel routing is ever changed
 * to record events under different alert rows per channel, this idempotency key must be
 * revisited (otherwise a second channel could bypass the cooldown).
 */
async function alreadySentToday(
  client: SupabaseClient,
  alertId: string,
  kind: DailyDecisionKind,
  targetDate: string,
  now: Date,
): Promise<boolean> {
  const since = new Date(now.getTime() - DAILY_COOLDOWN_HOURS * 3600 * 1000)
  const recent = await recentAlertEvents(client, alertId, since.toISOString()).catch(() => [])
  const forThisKind = recent.filter(
    (e) => e.payload?.kind === kind && e.payload?.target_date === targetDate,
  )
  // Already delivered → done. Otherwise, stop once we've burned the attempt budget on
  // failed/skipped tries so a broken channel can't re-trigger every hour.
  if (forThisKind.some((e) => e.status === 'sent')) return true
  return forThisKind.length >= DAILY_MAX_ATTEMPTS
}

function recordEvent(
  client: SupabaseClient,
  alertId: string,
  userId: string,
  channel: string,
  status: 'sent' | 'failed' | 'skipped',
  payload: Record<string, unknown>,
): Promise<void> {
  return insertAlertEvent(client, {
    alert_id: alertId,
    user_id: userId,
    channel,
    payload,
    status,
  }).catch(() => {
    // Never let an audit-trail write failure abort the run.
  })
}

/**
 * Compute + upsert the planned day's realized € saving for a user (the cumulative
 * "já poupaste X€" figure). Keyed on (user, planned local date) for idempotency. Wholly
 * best-effort: any failure (compute or DB) is swallowed so it can never abort the user's
 * alert delivery — the ledger is a side-benefit, not part of the alert contract.
 */
async function recordDailySaving(
  client: SupabaseClient,
  user: UserAlerts,
  plan: ReturnType<typeof buildDayPlan>,
  appliances: Appliance[],
  now: Date,
): Promise<void> {
  try {
    const timeZone = zoneTimeZone(user.country)
    const targetDate = tomorrowWindow(now, timeZone).localDate
    const saving = computeDailySaving(plan, appliances, timeZone)
    await upsertDailySaving(client, {
      user_id: user.userId,
      date: targetDate,
      estimated_saving_eur: saving.totalEur,
      breakdown: saving.breakdown,
    })
  } catch {
    // Ledger is non-critical; never let it break the run.
  }
}

/** The distinct alert types a user is subscribed to. */
function distinctTypes(alerts: AlertWithProfile[]): AlertType[] {
  return [...new Set(alerts.map((a) => a.type))]
}

/** The first alert row whose type maps to `kind` — owns the recorded event (valid FK). */
function ownerAlert(alerts: AlertWithProfile[], kind: DailyDecisionKind): AlertWithProfile | null {
  return alerts.find((a) => kindForType(a.type) === kind) ?? null
}

/** Union of channels across every alert row that maps to `kind` (deduped). */
function channelsFor(alerts: AlertWithProfile[], kind: DailyDecisionKind): string[] {
  const set = new Set<string>()
  for (const a of alerts) {
    if (kindForType(a.type) !== kind) continue
    const channels = a.channels.length > 0 ? a.channels : ['push']
    for (const c of channels) set.add(c)
  }
  return [...set]
}

/** Same mapping `daily-decision` uses, kept here for owner/channel grouping. */
function kindForType(type: AlertType): DailyDecisionKind {
  switch (type) {
    case 'cheap_hour':
      return 'anchor'
    case 'free_energy':
    case 'negative':
      return 'free'
    case 'spike':
      return 'spike'
  }
}

/**
 * Only a tariff whose FINAL curve actually TRACKS OMIE hour-to-hour is worth advising on.
 * That is `indexed`, plus `dual` when its formula carries `markup_eur_mwh` — `tariff-math`'s
 * `applyFormulaPerKwh` evaluates such a dual as an indexed curve, so the daily anchor is
 * honest for dual-tariff ES users too. A flat tariff (`fixed`, or a `dual` with only a fixed
 * sub-formula) gives the same price every hour → no valley to nudge, so we skip it.
 */
function usableTariff(tariff: PlanTariff | null): PlanTariff | null {
  if (!tariff) return null
  if (tariff.type === 'indexed') return tariff
  if (tariff.type === 'dual' && hasIndexedMarkup(tariff)) return tariff
  return null
}

/** True when a tariff's formula carries a numeric `markup_eur_mwh` (an OMIE-tracking curve). */
function hasIndexedMarkup(tariff: PlanTariff): boolean {
  const formula = tariff.formula as { markup_eur_mwh?: unknown } | null | undefined
  return typeof formula?.markup_eur_mwh === 'number'
}

/** Selected decision fields worth persisting on the event for later analytics. */
function decisionPayload(decision: DailyDecision): Record<string, unknown> {
  if (decision.kind === 'anchor') {
    return {
      window_start: decision.startTs,
      window_end: decision.endTs,
      avg_eur_kwh: decision.avgEurKwh,
      saved_eur: decision.savedEur,
    }
  }
  return {
    block_start: decision.block.startTs,
    block_end: decision.block.endTs,
    min_eur_kwh: decision.block.minEurKwh,
    max_eur_kwh: decision.block.maxEurKwh,
  }
}

function toPlanAppliance(a: Appliance): PlanAppliance {
  return {
    id: a.id,
    label: a.label,
    type: a.type,
    energyKwh: a.energyKwh,
    powerKw: a.powerKw,
    interruptible: a.interruptible,
    earliestHour: a.earliestHour,
    latestHour: a.latestHour,
  }
}

function zoneTimeZone(zone: Zone): string {
  return zone === 'ES' ? 'Europe/Madrid' : 'Europe/Lisbon'
}
