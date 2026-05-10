'use client'

import Link from 'next/link'
import { motion } from 'framer-motion'
import { ArrowRight, FileText, Sparkles } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { AuditRow, InvoiceRow } from '@/lib/db/invoice-queries'

interface ComparisonDetail {
  tariff_id: string
  tariff_name: string
  tariff_provider: string
  tariff_type: string
  alternative_total_eur: number
  savings_eur: number
  savings_pct: number
  breakdown: {
    energyEur: number
    fixedEur: number
    ieEur: number
    csaEur: number
    ivaEur: number
    totalEur: number
    totalKwh: number
    monthsInPeriod: number
  }
}

interface Detail {
  extraction: {
    provider: string
    country: 'PT' | 'ES'
    periodStart: string
    periodEnd: string
    totalKwh: number
    totalAmountEur: number
    tariffName: string | null
    tariffType: string
    confidence: number
  }
  consumption_source: 'invoice' | 'synthetic'
  comparisons: ComparisonDetail[]
}

export function AuditResult({ invoice, audit }: { invoice: InvoiceRow; audit: AuditRow }) {
  const t = useTranslations('auditor.result')
  const locale = useLocale()
  const fmt = (n: number) => formatEur(n, locale)

  const detail = audit.detail as unknown as Detail
  const baseline = Number(audit.baseline_cost_eur)
  const projected = Number(audit.projected_cost_eur)
  const savings = Number(audit.savings_eur)
  const savingsPct = Number(audit.savings_pct)
  const annualSavings = savings * (12 / Math.max(1, detail.comparisons[0]?.breakdown?.monthsInPeriod ?? 1))

  const isWin = savings > 0
  const headlineColor = isWin ? 'text-primary' : 'text-muted-foreground'
  const glow = isWin ? 'glow-electric' : ''

  return (
    <div className="container max-w-4xl py-12">
      <Link
        href="/auditor"
        className="mb-6 inline-flex items-center gap-2 text-sm text-muted-foreground transition hover:text-foreground"
      >
        {t('back')}
      </Link>

      {/* Hero */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className={`rounded-3xl border border-border/60 bg-gradient-to-br from-card/80 to-card/30 p-10 ${glow}`}
      >
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <Badge variant="muted">
            <FileText className="h-3 w-3" />
            {detail.extraction.provider}
          </Badge>
          <Badge variant="muted">
            {detail.extraction.periodStart} → {detail.extraction.periodEnd}
          </Badge>
          <Badge variant="muted">{detail.extraction.totalKwh.toFixed(0)} kWh</Badge>
          {detail.consumption_source === 'synthetic' ? (
            <Badge variant="muted">{t('syntheticBadge')}</Badge>
          ) : (
            <Badge variant="default">{t('realDataBadge')}</Badge>
          )}
        </div>

        <h1 className="mt-6 text-balance text-4xl font-semibold tracking-tight md:text-5xl">
          {isWin ? (
            <>
              {t('winHeadlinePrefix')}
              <span className="gradient-text-electric">{fmt(savings)}</span>
              {t('winHeadlineSuffix')}
            </>
          ) : (
            <>{t('loseHeadline')}</>
          )}
        </h1>

        <div className="mt-10 grid gap-6 md:grid-cols-2">
          <div className="rounded-2xl border border-border/40 bg-background/40 p-6">
            <div className="text-xs uppercase tracking-wider text-muted-foreground">
              {t('youPaid')}
            </div>
            <div className="num mt-2 text-4xl font-semibold tracking-tight">
              {fmt(baseline)}
            </div>
            <div className="mt-1 text-sm text-muted-foreground">
              {detail.extraction.tariffName ?? t('currentTariff')}
            </div>
          </div>
          <div className="rounded-2xl border border-primary/40 bg-primary/5 p-6">
            <div className="text-xs uppercase tracking-wider text-muted-foreground">
              {t('youdHavePaid')}
            </div>
            <div className={`num mt-2 text-4xl font-semibold tracking-tight ${headlineColor}`}>
              {fmt(projected)}
            </div>
            <div className="mt-1 text-sm text-muted-foreground">
              {detail.comparisons[0]
                ? `${detail.comparisons[0].tariff_provider} · ${detail.comparisons[0].tariff_name}`
                : '—'}
            </div>
          </div>
        </div>

        {isWin ? (
          <div className="mt-8 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-border/40 bg-background/40 p-5">
            <div>
              <div className="text-xs uppercase tracking-wider text-muted-foreground">
                {t('annualSavings')}
              </div>
              <div className="num mt-1 text-2xl font-semibold tracking-tight text-primary">
                {fmt(annualSavings)} {t('annualSuffix', { pct: savingsPct.toFixed(1) })}
              </div>
            </div>
            <Button asChild>
              <Link
                href={`https://www.google.com/search?q=${encodeURIComponent(
                  `${detail.comparisons[0]?.tariff_provider} ${detail.comparisons[0]?.tariff_name} contratar`,
                )}`}
                target="_blank"
                rel="noreferrer"
              >
                <Sparkles className="h-3 w-3" /> {t('switchCta')}
                <ArrowRight className="h-3 w-3" />
              </Link>
            </Button>
          </div>
        ) : null}
      </motion.div>

      {/* All comparisons */}
      <Card className="mt-8">
        <CardHeader>
          <CardTitle>{t('allAlternatives')}</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border/60 text-xs uppercase tracking-wider text-muted-foreground">
                <th className="px-4 py-3 text-left">{t('table.tariff')}</th>
                <th className="px-4 py-3 text-left">{t('table.type')}</th>
                <th className="num px-4 py-3 text-right">{t('table.energy')}</th>
                <th className="num px-4 py-3 text-right">{t('table.fixed')}</th>
                <th className="num px-4 py-3 text-right">{t('table.taxes')}</th>
                <th className="num px-4 py-3 text-right">{t('table.total')}</th>
                <th className="num px-4 py-3 text-right">{t('table.diff')}</th>
              </tr>
            </thead>
            <tbody>
              {detail.comparisons.map((c) => {
                const diff = c.savings_eur
                const positive = diff > 0
                return (
                  <tr key={c.tariff_id} className="border-b border-border/40 last:border-0">
                    <td className="px-4 py-3">
                      <div className="font-medium">{c.tariff_provider}</div>
                      <div className="text-xs text-muted-foreground">{c.tariff_name}</div>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{c.tariff_type}</td>
                    <td className="num px-4 py-3 text-right">{fmt(c.breakdown.energyEur)}</td>
                    <td className="num px-4 py-3 text-right text-muted-foreground">
                      {fmt(c.breakdown.fixedEur)}
                    </td>
                    <td className="num px-4 py-3 text-right text-muted-foreground">
                      {fmt(c.breakdown.ivaEur + c.breakdown.ieEur + c.breakdown.csaEur)}
                    </td>
                    <td className="num px-4 py-3 text-right font-semibold">
                      {fmt(c.alternative_total_eur)}
                    </td>
                    <td
                      className={`num px-4 py-3 text-right font-semibold ${
                        positive ? 'text-primary' : 'text-destructive'
                      }`}
                    >
                      {positive ? '−' : '+'}
                      {fmt(Math.abs(diff))}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <p className="mt-6 text-xs text-muted-foreground">
        {t('footnote')}{' '}
        {detail.extraction.confidence < 0.8 ? (
          <span className="text-destructive">
            {t('lowConfidence', {
              percent: (detail.extraction.confidence * 100).toFixed(0),
            })}
          </span>
        ) : null}{' '}
        {t('storedAt')}{' '}
        <span className="font-mono">{invoice.storage_path.slice(0, 12)}…</span>.
      </p>
    </div>
  )
}

function formatEur(n: number, locale: string): string {
  const tag = locale === 'es' ? 'es-ES' : 'pt-PT'
  return new Intl.NumberFormat(tag, {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n)
}
