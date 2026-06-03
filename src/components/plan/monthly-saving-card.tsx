'use client'

import { useLocale, useTranslations } from 'next-intl'
import { CalendarRange, PiggyBank } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { euros } from '@/lib/pricing/plan-format'
import type { MonthlySavingSummary } from '@/lib/pricing/plan-monthly'

interface Props {
  summary: MonthlySavingSummary
}

/**
 * Monthly-saving teaser for the planner — the headline a freshly-onboarded user sees:
 * "let us time your EV and you save ~X €/month", in euros on the FINAL price. Shown only
 * when the projected saving is meaningful (the page gates on a small floor).
 */
export function MonthlySavingCard({ summary }: Props) {
  const t = useTranslations('plan.monthly')
  const locale = useLocale()
  const numberLocale = locale === 'es' ? 'es-ES' : locale === 'en' ? 'en-GB' : 'pt-PT'
  const runs = Math.round(summary.runsPerMonth)

  return (
    <Card className="glow-electric overflow-hidden border-emerald-500/30">
      <CardContent className="flex flex-wrap items-center justify-between gap-6 p-6 sm:p-8">
        <div>
          <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-emerald-400">
            <CalendarRange className="h-4 w-4" />
            {t('kicker')}
          </div>
          <p className="mt-3 text-4xl font-semibold tracking-tight text-emerald-400 num sm:text-5xl">
            {euros(summary.monthlySavingEur, numberLocale)}
            <span className="ml-2 align-baseline text-base font-normal text-muted-foreground">
              {t('perMonth')}
            </span>
          </p>
          <p className="mt-3 max-w-md text-sm text-muted-foreground">
            {t('body', {
              appliance: summary.applianceLabel,
              perRun: euros(summary.savingPerRunEur, numberLocale),
              runs,
            })}
          </p>
        </div>
        <div className="grid h-16 w-16 shrink-0 place-items-center rounded-2xl bg-emerald-500/10 ring-1 ring-emerald-500/30">
          <PiggyBank className="h-8 w-8 text-emerald-400" />
        </div>
      </CardContent>
    </Card>
  )
}
