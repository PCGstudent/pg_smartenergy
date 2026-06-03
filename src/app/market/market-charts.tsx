'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import {
  LineChart, Line, BarChart, Bar, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine,
} from 'recharts'
import { TrendingDown, TrendingUp, Zap, Clock } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import type { DailyAvg, HourlyAvg, PeriodStats } from '@/lib/db/queries'

interface ZoneData {
  daily: DailyAvg[]
  hourly: HourlyAvg[]
  stats: PeriodStats | null
}

interface Props {
  pt: ZoneData
  es: ZoneData
}

export function MarketCharts({ pt, es }: Props) {
  const t = useTranslations('market')
  const [zone, setZone] = useState<'PT' | 'ES'>('PT')
  const data = zone === 'PT' ? pt : es

  const dailyFormatted = data.daily.map(d => ({
    day: d.day.slice(5), // MM-DD
    price: d.avgEurMwh,
  }))

  const hourlyFormatted = data.hourly.map(h => ({
    hour: `${String(h.hour).padStart(2, '0')}h`,
    price: h.avgEurMwh,
  }))

  const barColor = (price: number) => price < 0 ? '#22d3ee' : price < 50 ? '#4ade80' : price < 100 ? '#facc15' : '#f87171'

  return (
    <div className="space-y-8">
      {/* Zone toggle */}
      <div className="flex gap-2">
        {(['PT', 'ES'] as const).map(z => (
          <button
            key={z}
            onClick={() => setZone(z)}
            className={`flex items-center gap-2 rounded-xl border px-5 py-2.5 text-sm font-medium transition ${
              zone === z
                ? 'border-primary/60 bg-primary/10 text-primary ring-2 ring-primary/30'
                : 'border-border/60 bg-card/40 text-muted-foreground hover:border-border hover:bg-card/60'
            }`}
          >
            <span className="text-base">{z === 'PT' ? '🇵🇹' : '🇪🇸'}</span>
            {z === 'PT' ? t('zonePT') : t('zoneES')}
          </button>
        ))}
      </div>

      {/* Stat cards */}
      {data.stats ? (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <StatCard
            icon={<Zap className="h-4 w-4 text-primary" />}
            label={t('stats.avg')}
            value={`${data.stats.avgEurMwh}`}
            unit={t('stats.unit')}
          />
          <StatCard
            icon={<TrendingDown className="h-4 w-4 text-emerald-400" />}
            label={t('stats.min')}
            value={`${data.stats.minEurMwh}`}
            unit={t('stats.unit')}
            highlight={data.stats.minEurMwh < 0 ? 'negative' : undefined}
          />
          <StatCard
            icon={<TrendingUp className="h-4 w-4 text-red-400" />}
            label={t('stats.max')}
            value={`${data.stats.maxEurMwh}`}
            unit={t('stats.unit')}
          />
          <StatCard
            icon={<Clock className="h-4 w-4 text-cyan-400" />}
            label={t('stats.cheapHours')}
            value={`${data.stats.cheapPct}`}
            unit="%"
            hint={t('stats.cheapHoursHint')}
          />
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">{t('noData')}</p>
      )}

      {/* Daily chart */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('charts.dailyTitle')}</CardTitle>
        </CardHeader>
        <CardContent>
          {dailyFormatted.length > 0 ? (
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={dailyFormatted} margin={{ top: 4, right: 8, bottom: 0, left: -8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#262626" />
                <XAxis dataKey="day" tick={{ fontSize: 11, fill: '#737373' }} tickLine={false} interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 11, fill: '#737373' }} tickLine={false} unit=" €" />
                <Tooltip
                  contentStyle={{ background: '#111', border: '1px solid #262626', borderRadius: 8, fontSize: 12 }}
                  formatter={(v: number) => [`${v} €/MWh`, t('charts.price')]}
                />
                <ReferenceLine y={0} stroke="#525252" strokeDasharray="4 2" />
                <Line
                  type="monotone"
                  dataKey="price"
                  stroke="#a78bfa"
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 4, fill: '#a78bfa' }}
                />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <p className="py-8 text-center text-sm text-muted-foreground">{t('noData')}</p>
          )}
        </CardContent>
      </Card>

      {/* Hourly profile */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('charts.hourlyTitle')}</CardTitle>
          <CardDescription className="text-xs">{t('charts.hourlyHint')}</CardDescription>
        </CardHeader>
        <CardContent>
          {hourlyFormatted.length > 0 ? (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={hourlyFormatted} margin={{ top: 4, right: 8, bottom: 0, left: -8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#262626" />
                <XAxis dataKey="hour" tick={{ fontSize: 10, fill: '#737373' }} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: '#737373' }} tickLine={false} unit=" €" />
                <Tooltip
                  contentStyle={{ background: '#111', border: '1px solid #262626', borderRadius: 8, fontSize: 12 }}
                  formatter={(v: number) => [`${v} €/MWh`, t('charts.price')]}
                />
                <ReferenceLine y={0} stroke="#525252" strokeDasharray="4 2" />
                <Bar dataKey="price" radius={[3, 3, 0, 0]}>
                  {hourlyFormatted.map((entry, i) => (
                    <Cell key={i} fill={barColor(entry.price)} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <p className="py-8 text-center text-sm text-muted-foreground">{t('noData')}</p>
          )}
        </CardContent>
      </Card>

      {/* Negative hours callout */}
      {data.stats && data.stats.negativePct > 0 && (
        <div className="rounded-xl border border-cyan-500/30 bg-cyan-500/5 p-4">
          <p className="text-sm text-cyan-300">
            ⚡ {t('stats.negativeCallout', { pct: data.stats.negativePct })}
          </p>
        </div>
      )}
    </div>
  )
}

function StatCard({
  icon, label, value, unit, hint, highlight,
}: {
  icon: React.ReactNode
  label: string
  value: string
  unit: string
  hint?: string
  highlight?: 'negative'
}) {
  return (
    <Card title={hint}>
      <CardContent className="pt-4">
        <div className="flex items-center gap-2 text-muted-foreground mb-2">
          {icon}
          <span className="text-xs font-medium uppercase tracking-wider">{label}</span>
        </div>
        <p className={`text-2xl font-semibold tabular-nums ${highlight === 'negative' ? 'text-cyan-400' : ''}`}>
          {value}
          <span className="ml-1 text-sm font-normal text-muted-foreground">{unit}</span>
        </p>
      </CardContent>
    </Card>
  )
}
