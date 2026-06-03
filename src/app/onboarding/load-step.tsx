'use client'

import { motion } from 'framer-motion'
import { useTranslations } from 'next-intl'
import { BatteryCharging, CarFront, Droplets, Waves, type LucideIcon } from 'lucide-react'
import { Input } from '@/components/ui/input'
import {
  presetDefaults,
  type AvailabilityPreset,
  type SelectableLoadProfile,
} from '@/lib/onboarding/load-presets'

/** The light-path load profiles offered as one-tap cards (excludes the skip sentinel). */
const PROFILES: Array<{ profile: SelectableLoadProfile; icon: LucideIcon }> = [
  { profile: 'ev', icon: CarFront },
  { profile: 'water_heater', icon: Waves },
  { profile: 'washer', icon: Droplets },
  { profile: 'dishwasher', icon: BatteryCharging },
]

const AVAILABILITY: AvailabilityPreset[] = ['overnight', 'daytime', 'anytime']

export interface LoadDraft {
  profile: SelectableLoadProfile | null
  energyKwh: number | null
  availability: AvailabilityPreset
  daysPerWeek: number
}

interface Props {
  draft: LoadDraft
  onChange: (next: LoadDraft) => void
  disabled?: boolean
}

/**
 * Step 2 of onboarding (frictionless light path): the user describes ONE primary load
 * with a few taps. Picking a profile pre-fills sensible energy/availability/cadence
 * defaults; everything is optional and tweakable. No invoice, no CSV.
 */
export function LoadStep({ draft, onChange, disabled }: Props) {
  const t = useTranslations('onboarding.load')

  const selectProfile = (profile: SelectableLoadProfile) => {
    const d = presetDefaults(profile)
    onChange({
      profile,
      // Pre-fill energy + cadence from the preset so the teaser is immediately real.
      energyKwh: d.energyKwh,
      availability: d.defaultAvailability,
      daysPerWeek: d.defaultDaysPerWeek,
    })
  }

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm font-medium">{t('prompt')}</p>
        <p className="mt-1 text-xs text-muted-foreground">{t('promptHint')}</p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {PROFILES.map(({ profile, icon: Icon }) => {
          const active = draft.profile === profile
          return (
            <motion.button
              key={profile}
              type="button"
              whileHover={{ y: -2 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => selectProfile(profile)}
              disabled={disabled}
              className={`flex items-center gap-3 rounded-xl border p-4 text-left transition ${
                active
                  ? 'border-primary/60 bg-primary/5 ring-2 ring-primary/40'
                  : 'border-border/60 bg-card/40 hover:border-border'
              }`}
            >
              <span
                className={`grid h-10 w-10 shrink-0 place-items-center rounded-lg ${
                  active ? 'bg-primary/15 ring-1 ring-primary/40' : 'bg-secondary'
                }`}
              >
                <Icon className="h-5 w-5 text-primary" />
              </span>
              <span className="text-sm font-medium leading-tight">
                {t(`profiles.${profile}`)}
              </span>
            </motion.button>
          )
        })}
      </div>

      {/* Details only appear once a load is chosen — keeps the first view calm. */}
      {draft.profile ? (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          className="space-y-5 overflow-hidden rounded-xl border border-border/60 bg-card/40 p-4"
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="space-y-1.5">
              <span className="text-xs font-medium text-muted-foreground">
                {t('energyLabel')}
              </span>
              <Input
                type="number"
                inputMode="decimal"
                step="0.5"
                min="0.1"
                max="500"
                value={draft.energyKwh ?? ''}
                placeholder={String(presetDefaults(draft.profile).energyKwh)}
                disabled={disabled}
                onChange={(e) =>
                  onChange({ ...draft, energyKwh: parseEnergy(e.currentTarget.value) })
                }
              />
            </label>

            <label className="space-y-1.5">
              <span className="text-xs font-medium text-muted-foreground">
                {t('daysLabel')}
              </span>
              <Input
                type="number"
                inputMode="numeric"
                step="1"
                min="1"
                max="7"
                value={draft.daysPerWeek}
                disabled={disabled}
                onChange={(e) =>
                  onChange({ ...draft, daysPerWeek: clampDays(e.currentTarget.value) })
                }
              />
            </label>
          </div>

          <div className="space-y-2">
            <span className="text-xs font-medium text-muted-foreground">
              {t('availabilityLabel')}
            </span>
            <div className="grid grid-cols-3 gap-2">
              {AVAILABILITY.map((a) => {
                const active = draft.availability === a
                return (
                  <button
                    key={a}
                    type="button"
                    disabled={disabled}
                    onClick={() => onChange({ ...draft, availability: a })}
                    className={`rounded-lg border px-3 py-2 text-xs font-medium transition ${
                      active
                        ? 'border-primary/60 bg-primary/10 text-foreground'
                        : 'border-border/60 text-muted-foreground hover:border-border'
                    }`}
                  >
                    {t(`availability.${a}`)}
                  </button>
                )
              })}
            </div>
            <p className="text-xs text-muted-foreground">
              {t(`availabilityHint.${draft.availability}`)}
            </p>
          </div>
        </motion.div>
      ) : null}
    </div>
  )
}

/** Parse the energy input → positive number or null (null = use the preset default). */
function parseEnergy(raw: string): number | null {
  const n = parseFloat(raw.replace(',', '.'))
  return Number.isFinite(n) && n > 0 ? n : null
}

/** Clamp the days/week input into [1, 7]; non-numeric falls back to 1. */
function clampDays(raw: string): number {
  const n = parseInt(raw, 10)
  if (Number.isNaN(n)) return 1
  return Math.min(7, Math.max(1, n))
}
