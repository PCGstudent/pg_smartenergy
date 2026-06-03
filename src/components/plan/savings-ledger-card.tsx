'use client'

import { useLocale, useTranslations } from 'next-intl'
import { PiggyBank, TrendingUp } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { euros } from '@/lib/pricing/plan-format'
import type { SavingsSummary } from '@/lib/pricing/savings-summary'

interface Props {
  summary: SavingsSummary
}

/**
 * The cumulative "já poupaste X€" ledger card — the stickiness figure. Shows the
 * month-to-date saving headline (with the day count) plus the year-to-date total, in
 * euros on the FINAL price. Distinct from the forward-looking MonthlySavingCard (a
 * projection): this is the REALIZED running total the daily runner has accumulated.
 */
export function SavingsLedgerCard({ summary }: Props) {
  const t = useTranslations('plan.ledger')
  const locale = useLocale()
  const numberLocale = locale === 'es' ? 'es-ES' : locale === 'en' ? 'en-GB' : 'pt-PT'

  return (
    <Card className="overflow-hidden border-emerald-500/30 bg-emerald-500/5">
      <CardContent className="flex flex-wrap items-center justify-between gap-6 p-6 sm:p-8">
        <div>
          <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-emerald-400">
            <PiggyBank className="h-4 w-4" />
            {t('kicker')}
          </div>
          <p className="mt-3 text-4xl font-semibold tracking-tight text-emerald-400 num sm:text-5xl">
            {euros(summary.monthEur, numberLocale)}
            <span className="ml-2 align-baseline text-base font-normal text-muted-foreground">
              {t('thisMonth')}
            </span>
          </p>
          <p className="mt-3 max-w-md text-sm text-muted-foreground">
            {t('body', { days: summary.monthDays })}
          </p>
        </div>
        <div className="rounded-xl border border-emerald-500/20 bg-background/40 px-5 py-4 text-right">
          <div className="flex items-center justify-end gap-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            <TrendingUp className="h-3.5 w-3.5" />
            {t('thisYear')}
          </div>
          <p className="mt-1 text-2xl font-semibold text-emerald-400 num">
            {euros(summary.yearEur, numberLocale)}
          </p>
        </div>
      </CardContent>
    </Card>
  )
}
