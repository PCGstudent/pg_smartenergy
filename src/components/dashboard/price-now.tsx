'use client'

import { useTranslations } from 'next-intl'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import type { ScoredHourSerialized } from './dashboard-view'

export function PriceNow({ hours }: { hours: ScoredHourSerialized[] }) {
  const t = useTranslations('dashboard.priceNow')
  const tTones = useTranslations('dashboard.tones')
  const now = Date.now()
  // Pick the hour whose start is closest to now, but not in the future.
  const current = pickCurrentHour(hours, now)

  if (!current) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t('title')}</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">{t('noPrice')}</CardContent>
      </Card>
    )
  }

  const cents = current.priceEurKwh * 100
  // Avoid the "-0.00¢" artifact: anything that rounds to zero (or is negative) shows a clean 0.
  // The "free energy" tone/badge already communicates the negative-price meaning.
  const centsLabel = cents < 0.005 ? '0' : cents.toFixed(2)
  const tone = toneFor(current.category)

  return (
    <Card className={tone.glow}>
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex items-baseline gap-2">
          <span className={`num text-5xl font-semibold tracking-tight ${tone.color}`}>
            {centsLabel}¢
          </span>
          <span className="text-sm text-muted-foreground">{t('perKwh')}</span>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Badge variant={tone.badge}>{tTones(`${tone.key}.label`)}</Badge>
        </div>
        <p className="mt-4 text-sm text-muted-foreground">{tTones(`${tone.key}.advice`)}</p>
      </CardContent>
    </Card>
  )
}

function pickCurrentHour(hours: ScoredHourSerialized[], now: number): ScoredHourSerialized | null {
  const past = hours.filter((h) => new Date(h.ts).getTime() <= now)
  if (past.length === 0) return hours[0] ?? null
  return past[past.length - 1]!
}

type ToneKey = 'free' | 'golden' | 'cheap' | 'spike' | 'expensive' | 'normal'

type Tone = {
  key: ToneKey
  color: string
  glow: string
  badge: 'default' | 'gold' | 'spike' | 'muted'
}

/**
 * Maps a price category to its visual tone (colour/glow/badge variant) and the
 * i18n key under `dashboard.tones`. Label and advice copy are resolved by the
 * caller via next-intl so this stays a pure, locale-agnostic function.
 */
function toneFor(category: string): Tone {
  switch (category) {
    case 'free':
    case 'negative':
      return { key: 'free', color: 'text-primary', glow: 'glow-electric', badge: 'default' }
    case 'golden':
      return { key: 'golden', color: 'text-primary', glow: 'glow-electric', badge: 'default' }
    case 'cheap':
      return { key: 'cheap', color: 'text-foreground', glow: '', badge: 'default' }
    case 'spike':
      return { key: 'spike', color: 'text-destructive', glow: 'glow-spike', badge: 'spike' }
    case 'expensive':
      return { key: 'expensive', color: 'text-destructive', glow: '', badge: 'spike' }
    default:
      return { key: 'normal', color: 'text-foreground', glow: '', badge: 'muted' }
  }
}
