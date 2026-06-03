import { BarChart2 } from 'lucide-react'
import { getTranslations } from 'next-intl/server'
import {
  getMarketDailyAverages,
  getMarketHourlyProfile,
  getMarketPeriodStats,
} from '@/lib/db/queries'
import { MarketCharts } from './market-charts'

export const dynamic = 'force-dynamic'

/**
 * Resolve an aggregate query, logging (not hiding) failures. The page must still
 * render if one chart's data is unavailable, but a silent empty result used to
 * mask real SQL bugs (e.g. the hourly-profile GROUP BY regression) — so we log
 * the cause server-side and fall back to `empty`.
 */
async function safeQuery<T>(label: string, p: Promise<T>, empty: T): Promise<T> {
  try {
    return await p
  } catch (err) {
    console.error(`[market] ${label} query failed:`, err)
    return empty
  }
}

export default async function MarketPage() {
  const t = await getTranslations('market')

  const [ptDaily, esDaily, ptHourly, esHourly, ptStats, esStats] = await Promise.all([
    safeQuery('daily PT', getMarketDailyAverages('PT', 90), []),
    safeQuery('daily ES', getMarketDailyAverages('ES', 90), []),
    safeQuery('hourly PT', getMarketHourlyProfile('PT', 30, 'Europe/Lisbon'), []),
    safeQuery('hourly ES', getMarketHourlyProfile('ES', 30, 'Europe/Madrid'), []),
    safeQuery('stats PT', getMarketPeriodStats('PT', 30), null),
    safeQuery('stats ES', getMarketPeriodStats('ES', 30), null),
  ])

  return (
    <div className="container max-w-4xl py-12">
      <header className="mb-8">
        <p className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
          {t('kicker')}
        </p>
        <h1 className="mt-1 flex items-center gap-3 text-4xl font-semibold tracking-tight md:text-5xl">
          <BarChart2 className="h-8 w-8 text-primary" />
          {t('title')}
        </h1>
        <p className="mt-3 max-w-2xl text-muted-foreground">{t('subtitle')}</p>
        <p className="mt-2 max-w-2xl text-xs text-muted-foreground/80">{t('finalPriceNote')}</p>
      </header>

      <MarketCharts
        pt={{ daily: ptDaily, hourly: ptHourly, stats: ptStats }}
        es={{ daily: esDaily, hourly: esHourly, stats: esStats }}
      />
    </div>
  )
}
