'use client'

import { ArrowDown, AlertTriangle, Sparkles } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { ActionSerialized } from './dashboard-view'

const LISBON_TZ = 'Europe/Lisbon'

export function NextBestAction({ action }: { action: ActionSerialized | null }) {
  const t = useTranslations('dashboard.action')

  if (!action) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t('title')}</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">{t('empty')}</CardContent>
      </Card>
    )
  }

  const visual = visualFor(action.kind)
  const time = formatHour(action.ts)
  const { headline, detail } = copyFor(action, t)

  return (
    <Card className={visual.glow}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <visual.Icon className="h-3 w-3" />
          {t('title')}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className={`text-xl font-semibold leading-tight ${visual.color}`}>{headline}</div>
        <p className="mt-2 text-sm text-muted-foreground">{detail}</p>
        <div className="mt-4 flex items-baseline gap-2">
          <span className="text-xs uppercase tracking-wider text-muted-foreground">{t('at')}</span>
          <span className="num text-2xl font-semibold tracking-tight">{time}</span>
          <span className="text-sm text-muted-foreground">{t('zone')}</span>
        </div>
      </CardContent>
    </Card>
  )
}

type Translate = ReturnType<typeof useTranslations>

/**
 * Build the localized headline + detail from a structured action.
 *
 * PRODUCT RULE #2: behavioural advice ("run your washer/dryer/EV") is ONLY shown when the
 * action was ranked on the final customer price (`basis === 'final'`). For wholesale-only
 * ranking (the public oracle without a known tariff) we show an informational detail with
 * no behavioural instruction, because the wholesale ordering may not match the real bill.
 */
function copyFor(action: ActionSerialized, t: Translate): { headline: string; detail: string } {
  const cents = formatCents(action.priceEurKwh)
  const isFinal = action.basis === 'final'

  if (action.kind === 'free') {
    const headline = action.params.negative ? t('free.headlineNegative') : t('free.headline')
    const detail = isFinal
      ? t('free.detailFinal', { cents })
      : t('free.detailWholesale', { cents })
    return { headline, detail }
  }

  if (action.kind === 'avoid') {
    const altTime = action.params.alternativeTs ? formatHour(action.params.alternativeTs) : ''
    const altCents =
      action.params.alternativeEurKwh != null ? formatCents(action.params.alternativeEurKwh) : ''
    return {
      headline: t('avoid.headline', { time: formatHour(action.ts) }),
      detail: t('avoid.detail', { cents, altTime, altCents }),
    }
  }

  // 'cheap'
  const pct = Math.max(0, action.params.savingsPct ?? 0)
  const detail = isFinal
    ? t('cheap.detailFinal', { cents, pct })
    : t('cheap.detailWholesale', { cents, pct })
  return {
    headline: t('cheap.headline', { time: formatHour(action.ts) }),
    detail,
  }
}

function visualFor(kind: 'free' | 'cheap' | 'avoid') {
  if (kind === 'free') {
    return { Icon: Sparkles, color: 'text-primary', glow: 'glow-electric' }
  }
  if (kind === 'avoid') {
    return { Icon: AlertTriangle, color: 'text-destructive', glow: 'glow-spike' }
  }
  return { Icon: ArrowDown, color: 'text-primary', glow: '' }
}

function formatHour(iso: string): string {
  return new Date(iso).toLocaleTimeString('pt-PT', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: LISBON_TZ,
  })
}

function formatCents(eurKwh: number): string {
  const cents = eurKwh * 100
  // Avoid the "-0.00¢" artifact on free/negative hours — show a clean 0.
  return `${cents < 0.005 ? '0' : cents.toFixed(2)}¢/kWh`
}
