'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { retriggerAudit } from '@/app/auditor/[id]/actions'

export function ReauditButton({ invoiceId }: { invoiceId: string }) {
  const t = useTranslations('auditor.reaudit')
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const handleClick = () => {
    setError(null)
    startTransition(async () => {
      const result = await retriggerAudit(invoiceId)
      if ('error' in result) {
        setError(result.error)
      } else {
        router.refresh()
      }
    })
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        variant="outline"
        size="sm"
        onClick={handleClick}
        disabled={isPending}
        className="gap-1.5"
      >
        <RefreshCw className={`h-3 w-3 ${isPending ? 'animate-spin' : ''}`} />
        {isPending ? t('running') : t('label')}
      </Button>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  )
}
