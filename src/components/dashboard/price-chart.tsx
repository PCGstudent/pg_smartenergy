'use client'

import { useMemo } from 'react'
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { ScoredHourSerialized } from './dashboard-view'

export function PriceChart({ hours }: { hours: ScoredHourSerialized[] }) {
  const data = useMemo(
    () =>
      hours.map((h) => {
        const d = new Date(h.ts)
        return {
          ts: d.getTime(),
          label: d.toLocaleTimeString('pt-PT', {
            hour: '2-digit',
            minute: '2-digit',
            timeZone: 'Europe/Lisbon',
          }),
          cents: h.priceEurKwh * 100,
          category: h.category,
        }
      }),
    [hours],
  )

  const now = Date.now()

  return (
    <div className="h-72 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 10, right: 0, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="electric" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="hsl(142 70% 55%)" stopOpacity={0.6} />
              <stop offset="100%" stopColor="hsl(142 70% 55%)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="hsl(220 14% 14%)" strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="label"
            stroke="hsl(220 9% 60%)"
            fontSize={11}
            tickLine={false}
            axisLine={false}
            interval="preserveStartEnd"
            minTickGap={32}
          />
          <YAxis
            stroke="hsl(220 9% 60%)"
            fontSize={11}
            tickLine={false}
            axisLine={false}
            width={48}
            tickFormatter={(v) => `${(v as number).toFixed(0)}¢`}
          />
          <Tooltip
            cursor={{ stroke: 'hsl(220 14% 30%)' }}
            contentStyle={{
              background: 'hsl(220 14% 7%)',
              border: '1px solid hsl(220 14% 14%)',
              borderRadius: 12,
              fontSize: 12,
            }}
            labelStyle={{ color: 'hsl(220 9% 60%)' }}
            formatter={(value: number, _name, item) => {
              const cat = (item as unknown as { payload: { category: string } }).payload.category
              return [`${value.toFixed(2)}¢/kWh`, labelFor(cat)]
            }}
          />
          <ReferenceLine x={closestLabel(data, now)} stroke="hsl(0 0% 100% / 0.3)" strokeDasharray="3 3" />
          <Area
            type="monotone"
            dataKey="cents"
            stroke="hsl(142 70% 55%)"
            strokeWidth={2}
            fill="url(#electric)"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}

function labelFor(category: string): string {
  switch (category) {
    case 'golden':
      return 'Golden hour'
    case 'free':
      return 'Free energy'
    case 'negative':
      return 'Negative price'
    case 'spike':
      return 'Spike'
    case 'expensive':
      return 'Expensive'
    case 'cheap':
      return 'Cheap'
    default:
      return 'Normal'
  }
}

function closestLabel(data: { ts: number; label: string }[], now: number): string | undefined {
  if (data.length === 0) return undefined
  let best = data[0]!
  let bestDelta = Math.abs(best.ts - now)
  for (const d of data) {
    const delta = Math.abs(d.ts - now)
    if (delta < bestDelta) {
      best = d
      bestDelta = delta
    }
  }
  return best.label
}
