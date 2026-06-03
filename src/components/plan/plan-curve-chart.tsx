'use client'

import { useMemo } from 'react'
import { useTranslations } from 'next-intl'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ReferenceArea,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { CurvePoint } from '@/lib/pricing/plan-builder'
import { finalBarColor } from '@/lib/pricing/plan-format'

interface Props {
  curve: CurvePoint[]
  /** UTC ISO bounds of the window to highlight (recommended charging slot). */
  highlightStartTs?: string
  highlightEndTs?: string
  /** Locale for the price tooltip number formatting. */
  numberLocale: string
}

/**
 * Tomorrow's FINAL customer-price curve as a coloured bar chart (€/kWh).
 *
 * Reuses the market chart's visual language (same green/amber/red thresholds, dark
 * grid, rounded bars) but on the HONEST final price, not wholesale €/MWh. The
 * recommended window is shaded with a ReferenceArea so the eye lands on it instantly.
 */
export function PlanCurveChart({
  curve,
  highlightStartTs,
  highlightEndTs,
  numberLocale,
}: Props) {
  const t = useTranslations('plan')

  const data = useMemo(
    () =>
      curve.map((c) => ({
        label: c.localTime.slice(0, 2) + 'h',
        ts: c.ts,
        // €/kWh shown in cents on the axis for readability (7.6 ¢ vs 0.076).
        cents: round1(c.finalEurKwh * 100),
        finalEurKwh: c.finalEurKwh,
      })),
    [curve],
  )

  const highlight = useMemo(
    () => highlightRange(data, highlightStartTs, highlightEndTs),
    [data, highlightStartTs, highlightEndTs],
  )

  if (data.length === 0) return null

  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: -8 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#262626" />
        <XAxis
          dataKey="label"
          tick={{ fontSize: 10, fill: '#737373' }}
          tickLine={false}
          interval={1}
        />
        <YAxis tick={{ fontSize: 11, fill: '#737373' }} tickLine={false} unit="¢" />
        <Tooltip
          contentStyle={{
            background: '#111',
            border: '1px solid #262626',
            borderRadius: 8,
            fontSize: 12,
          }}
          formatter={(_v: number, _n: string, item: { payload?: { finalEurKwh: number } }) => {
            const eurKwh = item.payload?.finalEurKwh ?? 0
            return [formatEurKwh(eurKwh, numberLocale), t('chart.finalPrice')]
          }}
          labelFormatter={(l: string) => `${l}`}
        />
        {highlight ? (
          <ReferenceArea
            x1={highlight.x1}
            x2={highlight.x2}
            fill="#a78bfa"
            fillOpacity={0.16}
            stroke="#a78bfa"
            strokeOpacity={0.4}
            strokeDasharray="3 3"
          />
        ) : null}
        <Bar dataKey="cents" radius={[3, 3, 0, 0]}>
          {data.map((entry) => (
            <Cell key={entry.ts} fill={finalBarColor(entry.finalEurKwh)} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}

interface ChartPoint {
  label: string
  ts: string
}

/** Map the highlight UTC window onto the chart's category x-axis labels. */
function highlightRange(
  data: ChartPoint[],
  startTs?: string,
  endTs?: string,
): { x1: string; x2: string } | null {
  if (!startTs || !endTs) return null
  const startMs = new Date(startTs).getTime()
  const endMs = new Date(endTs).getTime()
  const inRange = data.filter((d) => {
    const ms = new Date(d.ts).getTime()
    return ms >= startMs && ms < endMs
  })
  if (inRange.length === 0) return null
  return { x1: inRange[0]!.label, x2: inRange[inRange.length - 1]!.label }
}

function round1(n: number): number {
  return Math.round(n * 10) / 10
}

function formatEurKwh(value: number, locale: string): string {
  const n = new Intl.NumberFormat(locale, {
    minimumFractionDigits: 3,
    maximumFractionDigits: 3,
  }).format(value)
  return `${n} €/kWh`
}
