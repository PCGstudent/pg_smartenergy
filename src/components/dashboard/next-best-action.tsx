'use client'

import { ArrowDown, AlertTriangle, Sparkles } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { ActionSerialized } from './dashboard-view'

export function NextBestAction({ action }: { action: ActionSerialized | null }) {
  if (!action) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Next best action</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Nothing standing out — prices look flat ahead.
        </CardContent>
      </Card>
    )
  }

  const visual = visualFor(action.kind)
  const time = new Date(action.ts).toLocaleTimeString('pt-PT', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Lisbon',
  })

  return (
    <Card className={visual.glow}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <visual.Icon className="h-3 w-3" />
          Next best action
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className={`text-xl font-semibold leading-tight ${visual.color}`}>
          {action.headline}
        </div>
        <p className="mt-2 text-sm text-muted-foreground">{action.detail}</p>
        <div className="mt-4 flex items-baseline gap-2">
          <span className="text-xs uppercase tracking-wider text-muted-foreground">at</span>
          <span className="num text-2xl font-semibold tracking-tight">{time}</span>
          <span className="text-sm text-muted-foreground">Lisbon</span>
        </div>
      </CardContent>
    </Card>
  )
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
