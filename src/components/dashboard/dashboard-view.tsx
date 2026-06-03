'use client'

import Link from 'next/link'
import { useMemo } from 'react'
import { useTranslations } from 'next-intl'
import { motion } from 'framer-motion'
import { ArrowRight, Database, Flame, Sparkles, Zap } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { PriceChart } from './price-chart'
import { PriceNow } from './price-now'
import { NextBestAction } from './next-best-action'
import { GoldenHoursList } from './golden-hours-list'
import { AuditSavingsCard } from './audit-savings-card'
import { deriveVolatility, formatCentsOrFree } from '@/lib/pricing/volatility'
import type { LatestUserAudit } from '@/lib/db/invoice-queries'

export interface ScoredHourSerialized {
  ts: string
  priceEurMwh: number
  priceEurKwh: number
  rank: number
  category: 'golden' | 'cheap' | 'normal' | 'expensive' | 'spike' | 'free' | 'negative'
}

/** Action params with Dates serialized to ISO strings for the client boundary. */
export interface ActionParamsSerialized {
  negative?: boolean
  savingsPct?: number
  alternativeTs?: string
  alternativeEurKwh?: number
}

export interface ActionSerialized {
  kind: 'free' | 'cheap' | 'avoid'
  ts: string
  priceEurKwh: number
  /** How the ranking was computed: 'final' allows behavioural advice, 'wholesale' is informational only. */
  basis: 'final' | 'wholesale'
  params: ActionParamsSerialized
}

export function DashboardView({
  zone,
  hours,
  action,
  hasData,
  latestAudit,
  locale,
}: {
  zone: 'PT' | 'ES'
  hours: ScoredHourSerialized[]
  action: ActionSerialized | null
  hasData: boolean
  latestAudit?: LatestUserAudit | null
  locale?: string
}) {
  const stats = useMemo(() => deriveVolatility(hours.map((h) => h.priceEurKwh)), [hours])
  const t = useTranslations('dashboard')
  const tCountry = useTranslations('common.country')

  if (!hasData) {
    return <EmptyState zone={zone} />
  }

  return (
    <div className="container py-10">
      <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
            {t('kicker', { country: tCountry(zone) })}
          </p>
          <h1 className="mt-1 text-4xl font-semibold tracking-tight md:text-5xl">{t('title')}</h1>
        </div>
        <div className="flex gap-1 rounded-lg border border-border/60 bg-card/40 p-1">
          <ZoneToggle current={zone} value="PT" label={tCountry('PT')} />
          <ZoneToggle current={zone} value="ES" label={tCountry('ES')} />
        </div>
      </header>

      {latestAudit ? (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="mb-4"
        >
          <AuditSavingsCard audit={latestAudit} locale={locale ?? 'pt'} />
        </motion.div>
      ) : null}

      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="grid gap-4 lg:grid-cols-3"
      >
        <PriceNow hours={hours} />
        <NextBestAction action={action} />
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Flame className="h-3 w-3" /> {t('volatility.title')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="num text-3xl font-semibold">
              {stats.spreadCents.toFixed(1)}¢
            </div>
            <p className="mt-1 text-xs uppercase tracking-wider text-muted-foreground">
              {t('volatility.spreadSuffix')}
            </p>
            <p className="mt-2 text-sm text-muted-foreground">
              {t('volatility.spreadDetail', {
                low: formatCentsOrFree(stats.minCents, t('golden.free')),
                peak: formatCentsOrFree(stats.maxCents, t('golden.free')),
              })}
            </p>
            <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
              <Stat
                label={t('volatility.lowest')}
                value={formatCentsOrFree(stats.minCents, t('golden.free'))}
                accent="text-primary"
              />
              <Stat
                label={t('volatility.peak')}
                value={formatCentsOrFree(stats.maxCents, t('golden.free'))}
                accent="text-destructive"
              />
            </div>
          </CardContent>
        </Card>
      </motion.div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>{t('chart.title')}</CardTitle>
            <CardDescription>{t('chart.subtitle')}</CardDescription>
          </CardHeader>
          <CardContent>
            <PriceChart hours={hours} />
          </CardContent>
        </Card>
        <GoldenHoursList hours={hours} />
      </div>

      <div className="mt-8 text-xs text-muted-foreground">{t('footnote')}</div>
    </div>
  )
}

function Stat({ label, value, accent }: { label: string; value: string; accent: string }) {
  return (
    <div className="rounded-lg border border-border/40 bg-background/40 p-3">
      <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`num mt-1 text-lg font-semibold ${accent}`}>{value}</div>
    </div>
  )
}

function ZoneToggle({
  current,
  value,
  label,
}: {
  current: 'PT' | 'ES'
  value: 'PT' | 'ES'
  label: string
}) {
  const active = current === value
  return (
    <Link
      href={`/dashboard?zone=${value}`}
      className={`rounded-md px-3 py-1.5 text-sm transition ${
        active
          ? 'bg-primary text-primary-foreground shadow-sm'
          : 'text-muted-foreground hover:text-foreground'
      }`}
    >
      {label}
    </Link>
  )
}

function EmptyState({ zone }: { zone: 'PT' | 'ES' }) {
  const t = useTranslations('dashboard.empty')
  return (
    <div className="container max-w-2xl py-24">
      <Card>
        <CardHeader>
          <Badge className="mb-2 w-fit" variant="muted">
            <Database className="h-3 w-3" /> {t('badge')}
          </Badge>
          <CardTitle className="text-lg normal-case tracking-normal text-foreground">
            <Sparkles className="mr-1 inline h-4 w-4 text-primary" />
            {zone === 'PT' ? t('titlePT') : t('titleES')}
          </CardTitle>
          <CardDescription>{t('description')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <pre className="overflow-x-auto rounded-lg border border-border/60 bg-background/60 p-4 text-xs">
            <code>{`# Trigger today's ingest manually (requires INGEST_SECRET):
curl -X POST $NEXT_PUBLIC_APP_URL/api/ingest/omie \\
  -H "Authorization: Bearer $INGEST_SECRET"

# Or backfill a specific date:
curl -X POST $NEXT_PUBLIC_APP_URL/api/ingest/omie \\
  -H "Authorization: Bearer $INGEST_SECRET" \\
  -H "Content-Type: application/json" \\
  -d '{"date": "2024-05-14"}'`}</code>
          </pre>
          <div className="flex gap-2">
            <Button asChild variant="outline" size="sm">
              <Link href="https://www.omie.es" target="_blank" rel="noreferrer">
                {t('ctaSource')} <ArrowRight className="h-3 w-3" />
              </Link>
            </Button>
            <Button asChild size="sm">
              <Link href="/">
                <Zap className="h-3 w-3" /> {t('ctaHome')}
              </Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

