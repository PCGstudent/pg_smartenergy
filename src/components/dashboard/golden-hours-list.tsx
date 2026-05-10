'use client'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import type { ScoredHourSerialized } from './dashboard-view'

export function GoldenHoursList({ hours }: { hours: ScoredHourSerialized[] }) {
  const now = Date.now()
  const upcoming = hours.filter((h) => new Date(h.ts).getTime() > now)

  const golden = upcoming.filter((h) => h.category === 'golden' || h.category === 'free' || h.category === 'negative')
  const spikes = upcoming.filter((h) => h.category === 'spike')

  return (
    <Card>
      <CardHeader>
        <CardTitle>Plan your day</CardTitle>
        <CardDescription>Use the green windows. Skip the red ones.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <Section title="Golden hours" empty="No standout cheap windows in the next 30h.">
          {golden.slice(0, 4).map((h) => (
            <Row key={h.ts} hour={h} variant="golden" />
          ))}
          {golden.length === 0 ? <Empty>No standout cheap windows in the next 30h.</Empty> : null}
        </Section>
        <Section title="Avoid these hours" empty="No spikes ahead.">
          {spikes.slice(0, 3).map((h) => (
            <Row key={h.ts} hour={h} variant="spike" />
          ))}
          {spikes.length === 0 ? <Empty>No spikes ahead.</Empty> : null}
        </Section>
      </CardContent>
    </Card>
  )
}

function Section({ title, children }: { title: string; empty: string; children: React.ReactNode }) {
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

function Row({ hour, variant }: { hour: ScoredHourSerialized; variant: 'golden' | 'spike' }) {
  const d = new Date(hour.ts)
  const time = d.toLocaleTimeString('pt-PT', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Lisbon',
  })
  const day = d.toLocaleDateString('pt-PT', { weekday: 'short', timeZone: 'Europe/Lisbon' })
  const cents = (hour.priceEurKwh * 100).toFixed(2)
  const isToday = isSameLisbonDay(d, new Date())

  return (
    <li className="flex items-center justify-between rounded-lg border border-border/40 bg-background/40 px-3 py-2 text-sm">
      <div className="flex items-center gap-2">
        <span className="num font-semibold">{time}</span>
        <span className="text-xs text-muted-foreground">{isToday ? 'today' : day}</span>
      </div>
      <Badge variant={variant === 'golden' ? 'default' : 'spike'}>
        {variant === 'golden' && hour.category === 'free' ? 'FREE' : `${cents}¢/kWh`}
      </Badge>
    </li>
  )
}

function isSameLisbonDay(a: Date, b: Date): boolean {
  const fmt = (d: Date) =>
    d.toLocaleDateString('pt-PT', { timeZone: 'Europe/Lisbon', year: 'numeric', month: '2-digit', day: '2-digit' })
  return fmt(a) === fmt(b)
}
