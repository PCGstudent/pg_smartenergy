'use client'

import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { Activity, Sparkles } from 'lucide-react'

interface Hour {
  ts: string
  priceEurKwh: number
  category: string
}

interface ApiResponse {
  zone: 'PT' | 'ES'
  count: number
  hours: Hour[]
}

interface TickerData {
  current: number
  min: number
  max: number
  spreadPct: number
  zone: 'PT' | 'ES'
  freeHours: number
}

/**
 * Lightweight, fail-soft live price ticker for the marketing page.
 * If `/api/prices/today` returns no data (DB empty) the component renders nothing
 * so the landing stays clean before the first ingest.
 */
export function LiveTicker() {
  const [data, setData] = useState<TickerData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const res = await fetch('/api/prices/today?zone=PT', { cache: 'no-store' })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const body: ApiResponse = await res.json()
        if (cancelled) return
        if (!body.hours || body.hours.length === 0) {
          setData(null)
          return
        }
        setData(deriveTicker(body))
      } catch {
        if (!cancelled) setData(null)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    const id = setInterval(load, 60_000)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [])

  if (loading) {
    return <div className="h-24 w-full max-w-xl animate-pulse rounded-2xl bg-card/40" />
  }
  if (!data) return null

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.2 }}
      className="flex w-full max-w-xl items-center justify-between gap-6 rounded-2xl border border-border/60 bg-card/40 p-4 backdrop-blur-sm"
    >
      <div className="flex items-center gap-3">
        <span className="grid h-9 w-9 place-items-center rounded-lg bg-primary/10 text-primary ring-1 ring-primary/30">
          <Activity className="h-4 w-4 animate-pulse-glow" />
        </span>
        <div>
          <div className="text-xs uppercase tracking-wider text-muted-foreground">
            Live · Portugal
          </div>
          <div className="num text-2xl font-semibold tracking-tight">
            {(data.current * 100).toFixed(2)}¢/kWh
          </div>
        </div>
      </div>
      <div className="hidden items-center gap-4 sm:flex">
        <Stat label="Lowest today" value={`${(data.min * 100).toFixed(1)}¢`} accent="text-primary" />
        <Stat label="Spike" value={`${(data.max * 100).toFixed(1)}¢`} accent="text-destructive" />
        {data.freeHours > 0 ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary ring-1 ring-primary/30">
            <Sparkles className="h-3 w-3" />
            {data.freeHours} free hour{data.freeHours === 1 ? '' : 's'}
          </span>
        ) : null}
      </div>
    </motion.div>
  )
}

function Stat({ label, value, accent }: { label: string; value: string; accent: string }) {
  return (
    <div className="text-right">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`num text-sm font-semibold ${accent}`}>{value}</div>
    </div>
  )
}

function deriveTicker(body: ApiResponse): TickerData {
  const now = Date.now()
  const past = body.hours.filter((h) => new Date(h.ts).getTime() <= now)
  const current = past.at(-1) ?? body.hours[0]!
  const prices = body.hours.map((h) => h.priceEurKwh)
  const min = Math.min(...prices)
  const max = Math.max(...prices)
  const spreadPct = max > 0 ? Math.round((1 - min / max) * 100) : 0
  const freeHours = body.hours.filter(
    (h) => h.category === 'free' || h.category === 'negative',
  ).length

  return {
    current: current.priceEurKwh,
    min,
    max,
    spreadPct,
    zone: body.zone,
    freeHours,
  }
}
