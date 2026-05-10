'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import type { ScoredHourSerialized } from './dashboard-view'

export function PriceNow({ hours }: { hours: ScoredHourSerialized[] }) {
  const now = Date.now()
  // Pick the hour whose start is closest to now, but not in the future.
  const current = pickCurrentHour(hours, now)

  if (!current) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Right now</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">No live price yet.</CardContent>
      </Card>
    )
  }

  const cents = current.priceEurKwh * 100
  const tone = toneFor(current.category)

  return (
    <Card className={tone.glow}>
      <CardHeader>
        <CardTitle>Right now</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex items-baseline gap-2">
          <span className={`num text-5xl font-semibold tracking-tight ${tone.color}`}>
            {cents.toFixed(2)}¢
          </span>
          <span className="text-sm text-muted-foreground">/kWh</span>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Badge variant={tone.badge}>{tone.label}</Badge>
          <Badge variant="muted">€{current.priceEurMwh.toFixed(2)}/MWh</Badge>
        </div>
        <p className="mt-4 text-sm text-muted-foreground">{tone.advice}</p>
      </CardContent>
    </Card>
  )
}

function pickCurrentHour(hours: ScoredHourSerialized[], now: number): ScoredHourSerialized | null {
  const past = hours.filter((h) => new Date(h.ts).getTime() <= now)
  if (past.length === 0) return hours[0] ?? null
  return past[past.length - 1]!
}

type Tone = {
  color: string
  glow: string
  badge: 'default' | 'gold' | 'spike' | 'muted'
  label: string
  advice: string
}

function toneFor(category: string): Tone {
  switch (category) {
    case 'free':
    case 'negative':
      return {
        color: 'text-primary',
        glow: 'glow-electric',
        badge: 'default',
        label: 'Free energy',
        advice: 'Run everything you can. The grid is paying you to consume.',
      }
    case 'golden':
      return {
        color: 'text-primary',
        glow: 'glow-electric',
        badge: 'default',
        label: 'Golden hour',
        advice: 'Cheapest window of the day. Start the dishwasher and EV charge now.',
      }
    case 'cheap':
      return {
        color: 'text-foreground',
        glow: '',
        badge: 'default',
        label: 'Cheap',
        advice: 'Comfortable price. Use freely.',
      }
    case 'spike':
      return {
        color: 'text-destructive',
        glow: 'glow-spike',
        badge: 'spike',
        label: 'Price spike',
        advice: 'Avoid heavy appliances. Wait for the next golden hour.',
      }
    case 'expensive':
      return {
        color: 'text-destructive',
        glow: '',
        badge: 'spike',
        label: 'Expensive',
        advice: 'Higher than average. Defer non-urgent loads.',
      }
    default:
      return {
        color: 'text-foreground',
        glow: '',
        badge: 'muted',
        label: 'Normal',
        advice: 'Average pricing. Nothing to optimize right now.',
      }
  }
}
