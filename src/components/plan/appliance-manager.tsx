'use client'

import { useState, useTransition } from 'react'
import { useTranslations } from 'next-intl'
import { Loader2, Pencil, Plus, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
  APPLIANCE_TYPES,
  type Appliance,
  type ApplianceType,
} from '@/lib/db/appliance-queries'
import {
  createAppliance,
  deleteAppliance,
  updateAppliance,
  type CreateApplianceInput,
} from '@/app/plan/actions'
import { APPLIANCE_ICONS } from './appliance-icons'

interface Props {
  appliances: Appliance[]
}

/**
 * CRUD manager for the user's loads. List of cards with edit/delete, plus an
 * inline add/edit form. Server actions revalidate `/plan`, so a successful
 * mutation re-runs the planner and the windows update on the next render.
 */
export function ApplianceManager({ appliances }: Props) {
  const t = useTranslations('plan.appliances')
  const [editing, setEditing] = useState<Appliance | null>(null)
  const [adding, setAdding] = useState(false)

  return (
    <section className="mt-10">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
          {t('title')}
        </h2>
        {!adding && !editing ? (
          <Button variant="outline" size="sm" onClick={() => setAdding(true)}>
            <Plus className="h-3 w-3" />
            {t('add')}
          </Button>
        ) : null}
      </div>

      {adding ? (
        <ApplianceForm
          onClose={() => setAdding(false)}
          onSaved={() => setAdding(false)}
        />
      ) : null}

      {appliances.length === 0 && !adding ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            {t('empty')}
          </CardContent>
        </Card>
      ) : (
        <ul className="space-y-2">
          {appliances.map((a) =>
            editing?.id === a.id ? (
              <li key={a.id}>
                <ApplianceForm
                  appliance={a}
                  onClose={() => setEditing(null)}
                  onSaved={() => setEditing(null)}
                />
              </li>
            ) : (
              <li key={a.id}>
                <ApplianceRow
                  appliance={a}
                  onEdit={() => setEditing(a)}
                />
              </li>
            ),
          )}
        </ul>
      )}
    </section>
  )
}

function ApplianceRow({
  appliance,
  onEdit,
}: {
  appliance: Appliance
  onEdit: () => void
}) {
  const t = useTranslations('plan.appliances')
  const [isPending, startTransition] = useTransition()
  const Icon = APPLIANCE_ICONS[appliance.type]

  const onDelete = () => {
    if (!confirm(t('confirmDelete'))) return
    startTransition(async () => {
      await deleteAppliance(appliance.id)
    })
  }

  const onToggleActive = () => {
    startTransition(async () => {
      await updateAppliance(appliance.id, { active: !appliance.active })
    })
  }

  const window =
    appliance.earliestHour === 0 && appliance.latestHour === 24
      ? null
      : `${appliance.earliestHour}h–${appliance.latestHour}h`

  return (
    <Card>
      <CardContent className="flex flex-wrap items-center justify-between gap-4 py-4">
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-lg bg-secondary">
            <Icon className="h-5 w-5 text-primary" />
          </span>
          <div>
            <div className="flex items-center gap-2 font-medium">
              {appliance.label}
              {!appliance.active ? <Badge variant="muted">{t('paused')}</Badge> : null}
              {appliance.interruptible ? (
                <Badge variant="outline">{t('interruptibleBadge')}</Badge>
              ) : null}
            </div>
            <div className="text-xs text-muted-foreground num">
              {appliance.energyKwh} kWh · {appliance.powerKw} kW
              {window ? ` · ${window}` : ''}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={onToggleActive} disabled={isPending}>
            {appliance.active ? t('pause') : t('resume')}
          </Button>
          <Button variant="outline" size="sm" onClick={onEdit} disabled={isPending}>
            <Pencil className="h-3 w-3" />
          </Button>
          <Button variant="outline" size="sm" onClick={onDelete} disabled={isPending}>
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

function ApplianceForm({
  appliance,
  onClose,
  onSaved,
}: {
  appliance?: Appliance
  onClose: () => void
  onSaved: () => void
}) {
  const t = useTranslations('plan.appliances')
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setError(null)
    const fd = new FormData(e.currentTarget)
    const input = readForm(fd)
    if (input.error) {
      setError(t(input.error))
      return
    }
    startTransition(async () => {
      const result = appliance
        ? await updateAppliance(appliance.id, input.value!)
        : await createAppliance(input.value!)
      if (result?.error) setError(result.error)
      else onSaved()
    })
  }

  return (
    <Card className="border-primary/40">
      <CardContent className="py-5">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium">
              {appliance ? t('editTitle') : t('addTitle')}
            </h3>
            <button
              type="button"
              onClick={onClose}
              className="text-muted-foreground hover:text-foreground"
              aria-label={t('cancel')}
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('label')}>
              <Input
                name="label"
                defaultValue={appliance?.label ?? ''}
                placeholder={t('labelPlaceholder')}
                maxLength={80}
                required
                disabled={isPending}
              />
            </Field>
            <Field label={t('type')}>
              <select
                name="type"
                defaultValue={appliance?.type ?? 'other'}
                disabled={isPending}
                className="flex h-11 w-full rounded-lg border border-border bg-background/60 px-3 py-2 text-sm"
              >
                {APPLIANCE_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {t(`types.${type}`)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t('energyKwh')}>
              <Input
                name="energy_kwh"
                type="number"
                step="0.1"
                min="0.1"
                max="500"
                defaultValue={appliance?.energyKwh ?? ''}
                placeholder="20"
                required
                disabled={isPending}
              />
            </Field>
            <Field label={t('powerKw')}>
              <Input
                name="power_kw"
                type="number"
                step="0.1"
                min="0.1"
                max="50"
                defaultValue={appliance?.powerKw ?? ''}
                placeholder="3.7"
                required
                disabled={isPending}
              />
            </Field>
            <Field label={t('earliestHour')}>
              <Input
                name="earliest_hour"
                type="number"
                step="1"
                min="0"
                max="24"
                defaultValue={appliance?.earliestHour ?? 0}
                disabled={isPending}
              />
            </Field>
            <Field label={t('latestHour')}>
              <Input
                name="latest_hour"
                type="number"
                step="1"
                min="0"
                max="24"
                defaultValue={appliance?.latestHour ?? 24}
                disabled={isPending}
              />
            </Field>
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="interruptible"
              defaultChecked={appliance?.interruptible ?? false}
              disabled={isPending}
              className="h-4 w-4 rounded border-border"
            />
            {t('interruptible')}
          </label>
          <p className="text-xs text-muted-foreground">{t('interruptibleHint')}</p>

          {error ? <p className="text-sm text-destructive">{error}</p> : null}

          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={isPending}>
              {isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
              {appliance ? t('save') : t('create')}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={onClose} disabled={isPending}>
              {t('cancel')}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-muted-foreground">{label}</label>
      {children}
    </div>
  )
}

interface ParsedForm {
  value?: CreateApplianceInput
  error?: string
}

/** Read + lightly validate the form. Deep validation happens server-side via Zod. */
function readForm(fd: FormData): ParsedForm {
  const label = (fd.get('label')?.toString() ?? '').trim()
  const type = (fd.get('type')?.toString() ?? 'other') as ApplianceType
  const energyKwh = num(fd.get('energy_kwh'))
  const powerKw = num(fd.get('power_kw'))
  const earliestHour = int(fd.get('earliest_hour'), 0)
  const latestHour = int(fd.get('latest_hour'), 24)
  const interruptible = fd.get('interruptible') === 'on'

  if (!label) return { error: 'errLabel' }
  if (!(energyKwh > 0)) return { error: 'errEnergy' }
  if (!(powerKw > 0)) return { error: 'errPower' }
  if (earliestHour >= latestHour) return { error: 'errWindow' }

  return {
    value: {
      label,
      type,
      energyKwh,
      powerKw,
      typicalDurationMin: null,
      interruptible,
      earliestHour,
      latestHour,
    },
  }
}

function num(v: FormDataEntryValue | null): number {
  return parseFloat((v?.toString() ?? '').replace(',', '.'))
}

function int(v: FormDataEntryValue | null, fallback: number): number {
  const n = parseInt(v?.toString() ?? '', 10)
  return Number.isNaN(n) ? fallback : n
}
