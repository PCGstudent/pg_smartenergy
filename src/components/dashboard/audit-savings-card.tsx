'use client'

import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { ArrowRight, TrendingDown, TrendingUp } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { LatestUserAudit } from '@/lib/db/invoice-queries'

interface Props {
  audit: LatestUserAudit
  locale: string
}

function formatEur(value: number, locale: string) {
  const intlLocale = locale === 'en' ? 'en-GB' : locale === 'es' ? 'es-ES' : 'pt-PT'
  return new Intl.NumberFormat(intlLocale, {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)
}

export function AuditSavingsCard({ audit, locale }: Props) {
  const t = useTranslations('dashboard.auditCard')

  const hasSavings = audit.savingsEur >= 1
  const savingsPositive = audit.savingsEur > 0

  return (
    <Card className={hasSavings ? 'glow-electric' : ''}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            {t('kicker')}
          </p>
          {audit.periodStart && audit.periodEnd ? (
            <Badge variant="muted" className="text-xs">
              {audit.periodStart} → {audit.periodEnd}
            </Badge>
          ) : null}
        </div>
        <CardTitle className="flex items-center gap-2 text-base font-medium normal-case tracking-normal">
          {savingsPositive ? (
            <TrendingDown className="h-4 w-4 text-primary" />
          ) : (
            <TrendingUp className="h-4 w-4 text-destructive" />
          )}
          {audit.provider ?? '—'}
        </CardTitle>
      </CardHeader>

      <CardContent className="space-y-4">
        {hasSavings ? (
          <>
            <div>
              <p className="text-xs text-muted-foreground">{t('saving')}</p>
              <div className="flex items-baseline gap-1">
                <span className="num text-3xl font-semibold text-primary">
                  {formatEur(audit.savingsEur, locale)}
                </span>
                <span className="text-sm text-muted-foreground">{t('perPeriod')}</span>
                <Badge variant="default" className="ml-1">
                  {audit.savingsPct.toFixed(0)}%
                </Badge>
              </div>
            </div>

            {audit.alternativeTariffProvider ? (
              <p className="text-sm text-muted-foreground">
                {t('switchTo')}{' '}
                <span className="font-medium text-foreground">
                  {audit.alternativeTariffProvider} {audit.alternativeTariffName}
                </span>
              </p>
            ) : null}
          </>
        ) : (
          <p className="text-sm text-muted-foreground">{t('noSavings')}</p>
        )}

        <Button asChild variant="outline" size="sm" className="w-full">
          <Link href={`/auditor/${audit.invoiceId}`}>
            {t('viewAudit')} <ArrowRight className="h-3 w-3" />
          </Link>
        </Button>
      </CardContent>
    </Card>
  )
}
