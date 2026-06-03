'use client'

import { useState, useTransition } from 'react'
import { useTranslations } from 'next-intl'
import { Check, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { saveSettings } from './actions'

interface Props {
  defaultDisplayName: string | null
  defaultCountry: 'PT' | 'ES' | null
  defaultContractedKva: number | null
  defaultWhatsappE164: string | null
}

export function SettingsForm({
  defaultDisplayName,
  defaultCountry,
  defaultContractedKva,
  defaultWhatsappE164,
}: Props) {
  const t = useTranslations('settings')
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setError(null)
    setSaved(false)
    const formData = new FormData(e.currentTarget)
    startTransition(async () => {
      const result = await saveSettings(formData)
      if (result?.error) {
        setError(result.error)
      } else {
        setSaved(true)
        setTimeout(() => setSaved(false), 3000)
      }
    })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Display name */}
      <div className="space-y-2">
        <label htmlFor="display_name" className="text-sm font-medium">{t('displayName')}</label>
        <Input
          id="display_name"
          name="display_name"
          defaultValue={defaultDisplayName ?? ''}
          placeholder={t('displayNamePlaceholder')}
          maxLength={80}
          disabled={isPending}
        />
      </div>

      {/* Country */}
      <div className="space-y-2">
        <label className="text-sm font-medium">{t('country')}</label>
        <div className="grid grid-cols-2 gap-3">
          {(['PT', 'ES'] as const).map((c) => (
            <label
              key={c}
              className={`flex cursor-pointer items-center gap-3 rounded-xl border p-4 transition ${
                defaultCountry === c
                  ? 'border-primary/60 bg-primary/5 ring-2 ring-primary/40'
                  : 'border-border/60 bg-card/40 hover:border-border'
              }`}
            >
              <input
                type="radio"
                name="country"
                value={c}
                defaultChecked={defaultCountry === c}
                className="sr-only"
                disabled={isPending}
              />
              <span className="text-2xl">{c === 'PT' ? '🇵🇹' : '🇪🇸'}</span>
              <span className="font-medium">{c === 'PT' ? 'Portugal' : 'España'}</span>
            </label>
          ))}
        </div>
      </div>

      {/* Contracted kVA */}
      <div className="space-y-2">
        <label htmlFor="contracted_kva" className="text-sm font-medium">{t('contractedKva')}</label>
        <Input
          id="contracted_kva"
          name="contracted_kva"
          type="number"
          step="0.01"
          min="0.1"
          max="100"
          defaultValue={defaultContractedKva ?? ''}
          placeholder="6.9"
          disabled={isPending}
        />
        <p className="text-xs text-muted-foreground">{t('contractedKvaHint')}</p>
      </div>

      {/* WhatsApp number (E.164) — unlocks the WhatsApp alert channel. */}
      <div className="space-y-2">
        <label htmlFor="whatsapp_e164" className="text-sm font-medium">{t('whatsapp')}</label>
        <Input
          id="whatsapp_e164"
          name="whatsapp_e164"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          defaultValue={defaultWhatsappE164 ?? ''}
          placeholder={t('whatsappPlaceholder')}
          maxLength={20}
          disabled={isPending}
        />
        <p className="text-xs text-muted-foreground">{t('whatsappHint')}</p>
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <Button type="submit" disabled={isPending} className="w-full">
        {isPending ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            {t('saving')}
          </>
        ) : saved ? (
          <>
            <Check className="h-4 w-4" />
            {t('saved')}
          </>
        ) : (
          t('save')
        )}
      </Button>
    </form>
  )
}
