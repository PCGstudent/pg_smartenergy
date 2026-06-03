import { redirect } from 'next/navigation'
import { CalendarClock } from 'lucide-react'
import { getLocale, getTranslations } from 'next-intl/server'
import { getSession } from '@/lib/supabase/auth'
import { createSupabaseServer } from '@/lib/supabase/server'
import { getPricesInRange, type Zone } from '@/lib/db/queries'
import { listAppliancesForUser, type Appliance } from '@/lib/db/appliance-queries'
import { buildDayPlan, type PlanAppliance } from '@/lib/pricing/plan-builder'
import { buildMonthlySavingSummary } from '@/lib/pricing/plan-monthly'
import { loadSavingsSummary } from '@/lib/pricing/savings-summary'
import { tomorrowWindow } from '@/lib/pricing/day-window'
import { resolvePlanTariff } from '@/lib/pricing/plan-tariff'
import { PlanView } from './plan-view'

/** Only surface the monthly teaser when the projected saving clears ~1 €/month. */
const MONTHLY_SAVING_FLOOR_EUR = 1

export const dynamic = 'force-dynamic'

/**
 * "Hoje & Amanhã" — the prospective planner.
 *
 * Loads tomorrow's day-ahead OMIE prices for the user's zone, builds the FINAL
 * customer-price curve (OMIE + tariff markup + hourly TAR + taxes), and maps each
 * of the user's appliances to its cheapest window. Everything user-facing is in €.
 * Graceful empty state when tomorrow's prices aren't published yet (~12:45 daily).
 */
export default async function PlanPage() {
  const session = await getSession()
  if (!session) redirect('/signin?next=/plan')
  if (!session.profile?.onboardedAt) redirect('/onboarding?next=/plan')

  const zone: Zone = session.profile?.country === 'ES' ? 'ES' : 'PT'
  const timeZone = zone === 'ES' ? 'Europe/Madrid' : 'Europe/Lisbon'

  const [supa, t, locale] = await Promise.all([
    createSupabaseServer(),
    getTranslations('plan'),
    getLocale(),
  ])

  // Prospective window: tomorrow's full LOCAL day → UTC bounds.
  const planWindow = tomorrowWindow(new Date(), timeZone)
  // getPricesInRange's upper bound is EXCLUSIVE, so passing `endUtc` (the next day's
  // 00:00) naturally excludes that row — no off-by-one workaround needed.

  const [prices, appliances, tariff, savingsSummary] = await Promise.all([
    getPricesInRange(zone, planWindow.startUtc, planWindow.endUtc).catch(() => []),
    listAppliancesForUser(supa, session.user.id).catch(() => [] as Appliance[]),
    resolvePlanTariff(supa, session.user.id, zone).catch(() => null),
    loadSavingsSummary(supa, session.user.id, timeZone).catch(() => null),
  ])

  const activeAppliances = appliances.filter((a) => a.active)
  const hasPrices = prices.length > 0

  // The planner only gives HONEST advice on a curve that varies hour-to-hour, i.e. an
  // INDEXED tariff. A fixed tariff flattens the FINAL price so every window is identical
  // and "cheapest window" advice is meaningless — treat it as "configure your tariff"
  // (route to /settings) instead of showing a misleadingly flat recommendation. This also
  // covers the last-resort fixed fallback in `resolvePlanTariff` for a fresh ES user whose
  // catalog has no indexed plan yet.
  const planTariff = tariff?.type === 'indexed' ? tariff : null
  const tariffMissing = hasPrices && !planTariff

  // Only build the plan when we have prices AND an indexed tariff to price them with.
  const plan = hasPrices && planTariff
    ? buildDayPlan({
        prices: prices.map((p) => ({ ts: p.ts, priceEurMwh: p.priceEurMwh })),
        tariff: planTariff,
        appliances: activeAppliances.map(toPlanAppliance),
        // TAR cycle is not yet stored on the profile — default to 'simples'.
        // (Threaded once profiles persist the customer's ciclo; see followups.)
        cycle: 'simples',
        counting: 'diario',
        timeZone,
      })
    : null

  // Monthly-saving teaser for the primary load (the first thing a new user lands on).
  const monthlyRaw = buildMonthlySavingSummary(plan, activeAppliances, timeZone)
  const monthlySummary =
    monthlyRaw && monthlyRaw.monthlySavingEur >= MONTHLY_SAVING_FLOOR_EUR ? monthlyRaw : null

  const dateLocale = locale === 'es' ? 'es-ES' : locale === 'en' ? 'en-GB' : 'pt-PT'
  // Lock the formatted date to the user's zone so the label always matches the
  // planned local day, independent of the server process timezone.
  const planDateLabel = new Intl.DateTimeFormat(dateLocale, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone,
  }).format(new Date(`${planWindow.localDate}T12:00:00Z`))

  return (
    <div className="container max-w-4xl py-12">
      <header className="mb-8">
        <p className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
          {t('kicker')}
        </p>
        <h1 className="mt-1 flex items-center gap-3 text-4xl font-semibold tracking-tight md:text-5xl">
          <CalendarClock className="h-8 w-8 text-primary" />
          {t('title')}
        </h1>
        <p className="mt-3 max-w-2xl text-muted-foreground">{t('subtitle')}</p>
      </header>

      <PlanView
        plan={plan}
        appliances={activeAppliances}
        allAppliances={appliances}
        zone={zone}
        planDateLabel={planDateLabel}
        tariffMissing={tariffMissing}
        monthlySummary={monthlySummary}
        savingsSummary={savingsSummary}
      />
    </div>
  )
}

/** Decoded appliance → planner input shape. */
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
