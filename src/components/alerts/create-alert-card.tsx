'use client'

import { useState, useTransition } from 'react'
import { motion } from 'framer-motion'
import { ArrowRight, Loader2, Plus, Sparkles } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { createAlert, type CreateAlertInput } from '@/app/alerts/actions'

type AlertType = CreateAlertInput['type']

const TYPE_CONFIG: { code: AlertType; needsThreshold: boolean }[] = [
  { code: 'free_energy', needsThreshold: false },
  { code: 'negative', needsThreshold: false },
  { code: 'cheap_hour', needsThreshold: true },
  { code: 'spike', needsThreshold: true },
]

export function CreateAlertCard({ country }: { country: 'PT' | 'ES' }) {
  const t = useTranslations('alerts.create')
  const tCountry = useTranslations('common.country')
  const [type, setType] = useState<AlertType>('free_energy')
  const [thresholdEurMwh, setThresholdEurMwh] = useState<string>('50')
  const [channels, setChannels] = useState<{ push: boolean; whatsapp: boolean }>({
    push: true,
    whatsapp: false,
  })
  const [quietStart, setQuietStart] = useState<string>('23')
  const [quietEnd, setQuietEnd] = useState<string>('7')
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const meta = TYPE_CONFIG.find((tc) => tc.code === type)!

  const onSubmit = () => {
    setError(null)
    const picked: ('push' | 'whatsapp')[] = []
    if (channels.push) picked.push('push')
    if (channels.whatsapp) picked.push('whatsapp')
    if (picked.length === 0) {
      setError(t('errors.pickChannel'))
      return
    }

    const threshold = meta.needsThreshold ? Number(thresholdEurMwh) : null
    if (meta.needsThreshold && (Number.isNaN(threshold!) || threshold! < -200 || threshold! > 1000)) {
      setError(t('errors.thresholdRange'))
      return
    }

    const qs = Number(quietStart)
    const qe = Number(quietEnd)
    const schedule =
      Number.isFinite(qs) && Number.isFinite(qe) && qs >= 0 && qs < 24 && qe >= 0 && qe < 24
        ? { quietStartHour: qs, quietEndHour: qe }
        : null

    startTransition(async () => {
      const result = await createAlert({
        type,
        thresholdEurMwh: threshold,
        channels: picked,
        schedule,
      })
      if (result.error) setError(result.error)
    })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Plus className="h-3 w-3" />
          {t('title')}
        </CardTitle>
        <CardDescription>
          {t('description', { country: tCountry(country) })}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div>
          <Label>{t('labels.type')}</Label>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {TYPE_CONFIG.map((tc) => {
              const active = type === tc.code
              return (
                <motion.button
                  key={tc.code}
                  type="button"
                  whileHover={{ y: -1 }}
                  whileTap={{ scale: 0.99 }}
                  onClick={() => setType(tc.code)}
                  className={`rounded-xl border p-4 text-left transition ${
                    active
                      ? 'border-primary/60 bg-primary/5 ring-2 ring-primary/40'
                      : 'border-border/60 bg-card/40 hover:border-border'
                  }`}
                  disabled={isPending}
                >
                  <div className="flex items-center gap-2 text-sm font-medium">
                    {active ? <Sparkles className="h-3 w-3 text-primary" /> : null}
                    {t(`types.${tc.code}.label`)}
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {t(`types.${tc.code}.description`)}
                  </p>
                </motion.button>
              )
            })}
          </div>
        </div>

        {meta.needsThreshold ? (
          <div>
            <Label>
              {t('labels.thresholdPrefix')}
              <span className="num">€/MWh</span>
              {t('labels.thresholdSuffix')} ·{' '}
              <span className="text-xs text-muted-foreground">
                {t('labels.thresholdHint', { value: (Number(thresholdEurMwh) / 10).toFixed(2) })}
              </span>
            </Label>
            <Input
              type="number"
              inputMode="decimal"
              value={thresholdEurMwh}
              onChange={(e) => setThresholdEurMwh(e.target.value)}
              disabled={isPending}
              className="mt-2 max-w-xs"
            />
          </div>
        ) : null}

        <div>
          <Label>{t('labels.channels')}</Label>
          <div className="mt-2 flex flex-wrap gap-2">
            <ChannelChip
              label={t('channels.push')}
              active={channels.push}
              onClick={() => setChannels((c) => ({ ...c, push: !c.push }))}
              disabled={isPending}
            />
            <ChannelChip
              label={t('channels.whatsapp')}
              active={channels.whatsapp}
              onClick={() => setChannels((c) => ({ ...c, whatsapp: !c.whatsapp }))}
              disabled={isPending}
              hint={t('channels.whatsappHint')}
            />
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label>
              {t('labels.quietStart')} ·{' '}
              <span className="text-xs text-muted-foreground">{t('labels.localTime')}</span>
            </Label>
            <Input
              type="number"
              min={0}
              max={23}
              value={quietStart}
              onChange={(e) => setQuietStart(e.target.value)}
              disabled={isPending}
              className="mt-2"
            />
          </div>
          <div>
            <Label>{t('labels.quietEnd')}</Label>
            <Input
              type="number"
              min={0}
              max={23}
              value={quietEnd}
              onChange={(e) => setQuietEnd(e.target.value)}
              disabled={isPending}
              className="mt-2"
            />
          </div>
        </div>

        {error ? <p className="text-sm text-destructive">{error}</p> : null}

        <Button onClick={onSubmit} disabled={isPending} size="lg" className="w-full">
          {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
          {isPending ? t('submitSaving') : t('submitIdle')}
        </Button>
      </CardContent>
    </Card>
  )
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
      {children}
    </div>
  )
}

function ChannelChip({
  label,
  active,
  onClick,
  disabled,
  hint,
}: {
  label: string
  active: boolean
  onClick: () => void
  disabled?: boolean
  hint?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs transition ${
        active
          ? 'border-primary/60 bg-primary/10 text-primary'
          : 'border-border/60 bg-card/40 text-muted-foreground hover:text-foreground'
      }`}
    >
      <span
        className={`grid h-3 w-3 place-items-center rounded-full text-[8px] ${
          active ? 'bg-primary text-primary-foreground' : 'border border-border'
        }`}
      >
        {active ? '✓' : ''}
      </span>
      {label}
      {hint ? <span className="text-[10px] opacity-60">{hint}</span> : null}
    </button>
  )
}
