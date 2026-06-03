'use client'

import { useTransition } from 'react'
import { motion } from 'framer-motion'
import { Pause, Play, Trash2 } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { eurMwhToCentsKwh } from '@/lib/utils'
import { deleteAlert, updateAlert } from '@/app/alerts/actions'
import type { AlertRecord } from '@/lib/db/alert-queries'

const TYPE_META: Record<AlertRecord['type'], { icon: string }> = {
  free_energy: { icon: '⚡' },
  negative: { icon: '💸' },
  cheap_hour: { icon: '🟢' },
  spike: { icon: '🔴' },
}

export function AlertList({ alerts }: { alerts: AlertRecord[] }) {
  return (
    <ul className="space-y-2">
      {alerts.map((a, i) => (
        <motion.li
          key={a.id}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: i * 0.04 }}
        >
          <AlertRow alert={a} />
        </motion.li>
      ))}
    </ul>
  )
}

function AlertRow({ alert }: { alert: AlertRecord }) {
  const t = useTranslations('alerts.list')
  const [isPending, startTransition] = useTransition()
  const meta = TYPE_META[alert.type]
  const threshold = alert.threshold_eur_mwh == null ? null : Number(alert.threshold_eur_mwh)

  const onTogglePause = () => {
    startTransition(async () => {
      await updateAlert(alert.id, { active: !alert.active })
    })
  }

  const onDelete = () => {
    if (!confirm(t('confirmDelete'))) return
    startTransition(async () => {
      await deleteAlert(alert.id)
    })
  }

  return (
    <Card>
      <CardContent className="flex flex-wrap items-center justify-between gap-4 py-4">
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-lg bg-secondary text-lg">
            {meta.icon}
          </span>
          <div>
            <div className="flex items-center gap-2 font-medium">
              {t(`types.${alert.type}`)}
              {!alert.active ? <Badge variant="muted">{t('paused')}</Badge> : null}
            </div>
            <div className="text-xs text-muted-foreground">
              {threshold != null ? (
                <>
                  {t('thresholdLabel')}{' '}
                  <span className="num">{fmtCentsKwh(eurMwhToCentsKwh(threshold))}¢/kWh</span> ·{' '}
                </>
              ) : null}
              {t('channelsLabel')} {alert.channels.join(', ') || '—'}
              {alert.schedule?.quietStartHour != null && alert.schedule?.quietEndHour != null ? (
                <>
                  {' · '}
                  {t('quietPrefix')} {pad(alert.schedule.quietStartHour)}:00–{pad(alert.schedule.quietEndHour)}:00
                </>
              ) : null}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={onTogglePause} disabled={isPending}>
            {alert.active ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
            {alert.active ? t('pause') : t('resume')}
          </Button>
          <Button variant="outline" size="sm" onClick={onDelete} disabled={isPending}>
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

function pad(n: number): string {
  return n.toString().padStart(2, '0')
}

/** ¢/kWh with at most one decimal, trimming a trailing ".0" (e.g. 5, 5.5). */
function fmtCentsKwh(centsKwh: number): string {
  return Number(centsKwh.toFixed(1)).toString()
}
