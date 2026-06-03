'use client'

import { useMemo } from 'react'
import Link from 'next/link'
import { useTranslations, useLocale } from 'next-intl'
import { CalendarOff, Clock4, PiggyBank, Settings2, Sparkles, Sun, Zap } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import type { DayPlan, ApplianceWindow } from '@/lib/pricing/plan-builder'
import type { Appliance } from '@/lib/db/appliance-queries'
import {
  bestSaving,
  euros,
  eurPerKwh,
  isOutsideAvailability,
  primaryAppliance,
  recommendedWindow,
  windowRangeLabel,
} from '@/lib/pricing/plan-format'
import { PlanCurveChart } from '@/components/plan/plan-curve-chart'
import { ApplianceManager } from '@/components/plan/appliance-manager'
import { APPLIANCE_ICONS } from '@/components/plan/appliance-icons'
import { MonthlySavingCard } from '@/components/plan/monthly-saving-card'
import { SavingsLedgerCard } from '@/components/plan/savings-ledger-card'
import type { MonthlySavingSummary } from '@/lib/pricing/plan-monthly'
import type { SavingsSummary } from '@/lib/pricing/savings-summary'

interface Props {
  plan: DayPlan | null
  appliances: Appliance[]
  allAppliances: Appliance[]
  zone: 'PT' | 'ES'
  planDateLabel: string
  /** True when showing TODAY (tomorrow's day-ahead isn't published yet). */
  planningToday: boolean
  tariffMissing: boolean
  monthlySummary: MonthlySavingSummary | null
  savingsSummary: SavingsSummary | null
}

/**
 * Orchestrates the "Hoje & Amanhã" screen: headline best-window card for the primary
 * load, the FINAL-price curve with the recommended window highlighted, the per-appliance
 * window list, and the appliance CRUD manager. Euros only — no €/MWh anywhere.
 */
export function PlanView({
  plan,
  appliances,
  allAppliances,
  zone,
  planDateLabel,
  planningToday,
  tariffMissing,
  monthlySummary,
  savingsSummary,
}: Props) {
  const t = useTranslations('plan')
  const locale = useLocale()
  const numberLocale = locale === 'es' ? 'es-ES' : locale === 'en' ? 'en-GB' : 'pt-PT'

  const primary = useMemo(
    () => (plan ? primaryAppliance(plan.appliances) : null),
    [plan],
  )
  const primaryWindow = primary ? recommendedWindow(primary) : null
  const highlight = primaryWindow
    ? { startTs: primaryWindow.startTs, endTs: primaryWindow.endTs }
    : undefined

  // No prices published yet for tomorrow → graceful empty state.
  if (!plan) {
    return (
      <PricesPending
        zone={zone}
        tariffMissing={tariffMissing}
        appliances={allAppliances}
        savingsSummary={savingsSummary}
      />
    )
  }

  return (
    <div className="space-y-8">
      {/* Showing today (tomorrow's day-ahead not published yet) — tell the user so the
          date label makes sense and they know a fuller plan lands later. */}
      {planningToday ? (
        <div className="rounded-xl border border-primary/25 bg-primary/5 px-4 py-3 text-sm text-muted-foreground">
          {t('todayNote')}
        </div>
      ) : null}

      {/* Cumulative "já poupaste X€" ledger — the realized running total. */}
      {savingsSummary ? <SavingsLedgerCard summary={savingsSummary} /> : null}

      {/* Monthly-saving teaser — the headline a freshly-onboarded user lands on. */}
      {monthlySummary ? <MonthlySavingCard summary={monthlySummary} /> : null}

      {/* Header: the single best window for the primary load. */}
      {primary && primaryWindow ? (
        <BestWindowCard
          appliance={primary}
          numberLocale={numberLocale}
          planDateLabel={planDateLabel}
        />
      ) : appliances.length === 0 ? (
        <NoAppliancesCard />
      ) : (
        <NoWindowCard />
      )}

      {/* FINAL price curve for tomorrow with the recommended window shaded. */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base normal-case tracking-normal text-foreground">
            {t('chart.title', { date: planDateLabel })}
          </CardTitle>
          <CardDescription className="text-xs">
            {t('chart.subtitle')} ·{' '}
            <span className="num">
              {t('chart.range', {
                min: eurPerKwh(plan.cheapestEurKwh, numberLocale),
                max: eurPerKwh(plan.peakEurKwh, numberLocale),
              })}
            </span>
          </CardDescription>
        </CardHeader>
        <CardContent>
          <PlanCurveChart
            curve={plan.curve}
            highlightStartTs={highlight?.startTs}
            highlightEndTs={highlight?.endTs}
            numberLocale={numberLocale}
          />
          <SolarExplainer />
        </CardContent>
      </Card>

      {/* Per-appliance window list. */}
      {plan.appliances.length > 0 ? (
        <section>
          <h2 className="mb-4 text-sm font-medium uppercase tracking-wider text-muted-foreground">
            {t('perAppliance.title')}
          </h2>
          <ul className="space-y-2">
            {plan.appliances.map((a) => (
              <li key={a.applianceId}>
                <ApplianceWindowRow appliance={a} numberLocale={numberLocale} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* CRUD manager. */}
      <ApplianceManager appliances={allAppliances} />
    </div>
  )
}

/** Header hero: the cheapest window for the primary load, € saved front and centre. */
function BestWindowCard({
  appliance,
  numberLocale,
  planDateLabel,
}: {
  appliance: ApplianceWindow
  numberLocale: string
  planDateLabel: string
}) {
  const t = useTranslations('plan')
  const window = recommendedWindow(appliance)
  if (!window) return null
  const saving = bestSaving(appliance)
  const outsideWindow = isOutsideAvailability(appliance)
  const Icon = APPLIANCE_ICONS[appliance.type as keyof typeof APPLIANCE_ICONS] ?? Zap

  return (
    <Card className="glow-electric overflow-hidden">
      <CardContent className="p-6 sm:p-8">
        <div className="flex items-center gap-2 text-sm font-medium uppercase tracking-wider text-primary">
          <Sparkles className="h-4 w-4" />
          {t('best.kicker')}
        </div>

        <div className="mt-4 flex flex-wrap items-end justify-between gap-6">
          <div>
            <div className="flex items-center gap-3">
              <span className="grid h-12 w-12 place-items-center rounded-xl bg-primary/10 ring-1 ring-primary/30">
                <Icon className="h-6 w-6 text-primary" />
              </span>
              <div>
                <p className="text-sm text-muted-foreground">{appliance.label}</p>
                <p className="text-3xl font-semibold tracking-tight sm:text-4xl">
                  {windowRangeLabel(window)}
                </p>
              </div>
            </div>
            <p className="mt-3 max-w-md text-sm text-muted-foreground">
              {outsideWindow
                ? t('best.outsideBody', {
                    count: appliance.plan.slotsNeeded,
                    price: eurPerKwh(window.avgEurKwh, numberLocale),
                    cost: euros(window.totalEur, numberLocale),
                  })
                : t('best.body', {
                    date: planDateLabel,
                    price: eurPerKwh(window.avgEurKwh, numberLocale),
                    cost: euros(window.totalEur, numberLocale),
                  })}
            </p>
            {outsideWindow ? (
              <p className="mt-2 flex items-center gap-1.5 text-xs text-amber-400">
                <Clock4 className="h-3.5 w-3.5" />
                {t('best.widenHint')}
              </p>
            ) : null}
          </div>

          {saving > 0 ? (
            <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 px-5 py-4 text-right">
              <div className="flex items-center justify-end gap-1.5 text-xs font-medium uppercase tracking-wider text-emerald-400">
                <PiggyBank className="h-3.5 w-3.5" />
                {t('best.savingLabel')}
              </div>
              <p className="mt-1 text-2xl font-semibold text-emerald-400 num">
                {euros(saving, numberLocale)}
              </p>
              <p className="text-xs text-muted-foreground">{t('best.savingHint')}</p>
            </div>
          ) : null}
        </div>
      </CardContent>
    </Card>
  )
}

/** One row in the per-appliance list: "Máquina de lavar → 14h–15h · 0,12 €". */
function ApplianceWindowRow({
  appliance,
  numberLocale,
}: {
  appliance: ApplianceWindow
  numberLocale: string
}) {
  const t = useTranslations('plan')
  const window = recommendedWindow(appliance)
  const Icon = APPLIANCE_ICONS[appliance.type as keyof typeof APPLIANCE_ICONS] ?? Zap
  const saving = bestSaving(appliance)
  const outsideWindow = isOutsideAvailability(appliance)

  return (
    <Card>
      <CardContent className="flex flex-wrap items-center justify-between gap-4 py-4">
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-lg bg-secondary">
            <Icon className="h-5 w-5 text-primary" />
          </span>
          <div>
            <div className="font-medium">{appliance.label}</div>
            {window && outsideWindow ? (
              // Availability window too narrow: show the day's N cheapest hours anyway,
              // labelled clearly + a widen-hours affordance (the manager is right below).
              <div className="text-xs">
                <div className="flex items-center gap-1.5 text-amber-400">
                  <Clock4 className="h-3.5 w-3.5" />
                  <span className="num">
                    {t('perAppliance.outsideWindow', {
                      count: appliance.plan.slotsNeeded,
                      range: windowRangeLabel(window),
                      price: eurPerKwh(window.avgEurKwh, numberLocale),
                    })}
                  </span>
                </div>
                <div className="mt-0.5 text-muted-foreground">
                  <span className="num">{euros(window.totalEur, numberLocale)}</span>
                  {' · '}
                  {t('perAppliance.widenHint')}
                </div>
              </div>
            ) : (
              <div className="text-xs text-muted-foreground">
                {window ? (
                  <span className="num">
                    {t('perAppliance.window', {
                      range: windowRangeLabel(window),
                      cost: euros(window.totalEur, numberLocale),
                    })}
                  </span>
                ) : (
                  t('perAppliance.noWindow')
                )}
                {appliance.interruptible &&
                appliance.plan.interruptible &&
                appliance.plan.interruptibleSavingEur > 0 ? (
                  <Badge variant="outline" className="ml-2">
                    {t('perAppliance.splitBadge')}
                  </Badge>
                ) : null}
              </div>
            )}
          </div>
        </div>
        {saving > 0 ? (
          <div className="text-right">
            <div className="text-xs uppercase tracking-wider text-muted-foreground">
              {t('perAppliance.saves')}
            </div>
            <div className="font-semibold text-emerald-400 num">
              {euros(saving, numberLocale)}
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}

function NoAppliancesCard() {
  const t = useTranslations('plan')
  return (
    <Card className="glow-electric">
      <CardContent className="py-10 text-center">
        <Sparkles className="mx-auto mb-3 h-5 w-5 text-primary" />
        <p className="text-lg font-medium">{t('best.noAppliancesTitle')}</p>
        <p className="mt-1 text-sm text-muted-foreground">{t('best.noAppliancesBody')}</p>
      </CardContent>
    </Card>
  )
}

function NoWindowCard() {
  const t = useTranslations('plan')
  return (
    <Card>
      <CardContent className="py-8 text-center text-sm text-muted-foreground">
        {t('best.noWindow')}
      </CardContent>
    </Card>
  )
}

/**
 * Colour legend + "why is midday cheap?" explainer for the final-price curve.
 *
 * The swatch colours mirror `finalBarColor` thresholds so the chart bars and the
 * legend read as one system: cyan = negative/free, green = cheap, red = peak.
 * The solar context is collapsed behind a "porquê?" expander to stay concise.
 */
function SolarExplainer() {
  const t = useTranslations('plan.solar')
  return (
    <div className="mt-4 space-y-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
        <LegendSwatch color="#22d3ee" label={t('legend.negative')} />
        <LegendSwatch color="#4ade80" label={t('legend.cheap')} />
        <LegendSwatch color="#f87171" label={t('legend.peak')} />
      </div>
      <details className="group rounded-lg border border-border/40 bg-background/40 px-3 py-2">
        <summary className="flex cursor-pointer list-none items-center gap-2 text-xs font-medium text-muted-foreground transition hover:text-foreground">
          <Sun className="h-3.5 w-3.5 text-amber-400" />
          {t('summary')}
        </summary>
        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{t('body')}</p>
      </details>
    </div>
  )
}

function LegendSwatch({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span
        aria-hidden
        className="inline-block h-2.5 w-2.5 rounded-sm"
        style={{ backgroundColor: color }}
      />
      {label}
    </span>
  )
}

/** Empty state: tomorrow's day-ahead prices aren't published yet (or no tariff). */
function PricesPending({
  zone,
  tariffMissing,
  appliances,
  savingsSummary,
}: {
  zone: 'PT' | 'ES'
  tariffMissing: boolean
  appliances: Appliance[]
  savingsSummary: SavingsSummary | null
}) {
  const t = useTranslations('plan')
  return (
    <div className="space-y-8">
      {/* Even with no prices yet, the cumulative "já poupaste X€" still stands. */}
      {savingsSummary ? <SavingsLedgerCard summary={savingsSummary} /> : null}

      <Card>
        <CardContent className="py-12 text-center">
          <CalendarOff className="mx-auto mb-3 h-6 w-6 text-muted-foreground" />
          <p className="text-lg font-medium">
            {tariffMissing ? t('pending.tariffTitle') : t('pending.title')}
          </p>
          <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
            {tariffMissing ? t('pending.tariffBody') : t('pending.body')}
          </p>
          {tariffMissing ? (
            <Link
              href="/settings"
              className="mt-4 inline-flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-medium transition hover:bg-secondary"
            >
              <Settings2 className="h-4 w-4" />
              {t('pending.tariffCta')}
            </Link>
          ) : (
            <Link
              href={`/market`}
              className="mt-4 inline-flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-medium transition hover:bg-secondary"
            >
              <Zap className="h-4 w-4" />
              {t('pending.marketCta', { zone })}
            </Link>
          )}
        </CardContent>
      </Card>

      {/* Even with no prices, let the user manage their appliances. */}
      <ApplianceManager appliances={appliances} />
    </div>
  )
}
