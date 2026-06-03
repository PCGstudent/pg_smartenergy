'use client'

import { useLocale, useTranslations } from 'next-intl'
import { Sun } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { formatCentsOrFree } from '@/lib/pricing/volatility'
import type { ScoredHourSerialized } from './dashboard-view'

/** Map the active app locale to a BCP-47 tag for Intl date/time formatting. */
function dateLocale(locale: string): string {
  return locale === 'es' ? 'es-ES' : locale === 'en' ? 'en-GB' : 'pt-PT'
}

export function GoldenHoursList({ hours }: { hours: ScoredHourSerialized[] }) {
  const t = useTranslations('dashboard.golden')
  const tSolar = useTranslations('dashboard.solar')
  const locale = useLocale()
  const now = Date.now()
  const upcoming = hours.filter((h) => new Date(h.ts).getTime() > now)

  const golden = upcoming.filter(
    (h) => h.category === 'golden' || h.category === 'free' || h.category === 'negative',
  )
  const spikes = upcoming.filter((h) => h.category === 'spike')

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
        <CardDescription>{t('subtitle')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <Section title={t('goldenTitle')}>
          {golden.slice(0, 4).map((h) => (
            <Row key={h.ts} hour={h} variant="golden" locale={locale} t={t} />
          ))}
          {golden.length === 0 ? <Empty>{t('goldenEmpty')}</Empty> : null}
        </Section>
        <Section title={t('avoidTitle')}>
          {spikes.slice(0, 3).map((h) => (
            <Row key={h.ts} hour={h} variant="spike" locale={locale} t={t} />
          ))}
          {spikes.length === 0 ? <Empty>{t('spikesEmpty')}</Empty> : null}
        </Section>

        {/* Solar explainer: why daytime is the cheap window (and sometimes negative). */}
        <details className="group rounded-lg border border-border/40 bg-background/40 px-3 py-2">
          <summary className="flex cursor-pointer list-none items-center gap-2 text-xs font-medium text-muted-foreground transition hover:text-foreground">
            <Sun className="h-3.5 w-3.5 text-amber-400" />
            {tSolar('summary')}
          </summary>
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{tSolar('body')}</p>
        </details>
      </CardContent>
    </Card>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
        {title}
      </div>
      <ul className="space-y-1.5">{children}</ul>
    </div>
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return <li className="text-xs text-muted-foreground">{children}</li>
}

function Row({
  hour,
  variant,
  locale,
  t,
}: {
  hour: ScoredHourSerialized
  variant: 'golden' | 'spike'
  locale: string
  t: (key: string) => string
}) {
  const tag = dateLocale(locale)
  const d = new Date(hour.ts)
  const time = d.toLocaleTimeString(tag, {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Lisbon',
  })
  const day = d.toLocaleDateString(tag, { weekday: 'short', timeZone: 'Europe/Lisbon' })
  const centsValue = hour.priceEurKwh * 100
  const isToday = isSameLisbonDay(d, new Date())

  // Golden rows collapse free/negative/near-zero prices to the "FREE" label so a
  // tiny negative final price never renders as an ugly "-0.00¢/kWh". Spikes are
  // always high-positive, so they keep the numeric ¢/kWh figure.
  const free = t('free')
  const formatted = formatCentsOrFree(centsValue, free)
  const label =
    variant === 'golden'
      ? formatted === free
        ? free
        : `${formatted}/kWh`
      : `${centsValue < 0.005 ? '0' : centsValue.toFixed(2)}¢/kWh`

  return (
    <li className="flex items-center justify-between rounded-lg border border-border/40 bg-background/40 px-3 py-2 text-sm">
      <div className="flex items-center gap-2">
        <span className="num font-semibold">{time}</span>
        <span className="text-xs text-muted-foreground">{isToday ? t('today') : day}</span>
      </div>
      <Badge variant={variant === 'golden' ? 'default' : 'spike'}>{label}</Badge>
    </li>
  )
}

function isSameLisbonDay(a: Date, b: Date): boolean {
  const fmt = (d: Date) =>
    d.toLocaleDateString('pt-PT', {
      timeZone: 'Europe/Lisbon',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
  return fmt(a) === fmt(b)
}
