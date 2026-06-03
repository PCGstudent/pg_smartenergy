'use client'

import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { Upload, CheckCircle2, XCircle, ExternalLink } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { importEredesConsumption } from '@/app/auditor/[id]/actions'

interface Props {
  invoiceId: string
}

export function EredesUpload({ invoiceId }: Props) {
  const t = useTranslations('auditor.eredes')
  const router = useRouter()
  const fileRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const [isPending, startTransition] = useTransition()

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setError(null)
    setDone(false)
    const f = e.target.files?.[0] ?? null
    if (f && !f.name.toLowerCase().endsWith('.csv')) {
      setError(t('errors.csvOnly'))
      return
    }
    setFile(f)
  }

  const onSubmit = () => {
    if (!file) {
      setError(t('errors.pickFirst'))
      return
    }
    const reader = new FileReader()
    reader.onload = (ev) => {
      const text = ev.target?.result as string
      setError(null)
      startTransition(async () => {
        const result = await importEredesConsumption(invoiceId, text)
        if ('error' in result) {
          setError(result.error)
        } else {
          setDone(true)
          setTimeout(() => router.refresh(), 800)
        }
      })
    }
    reader.readAsText(file, 'utf-8')
  }

  return (
    <Card className="mt-8 border-border/60">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">{t('title')}</CardTitle>
        <CardDescription>
          {t('description')}{' '}
          <a
            href="https://www.e-redes.pt/pt-pt/area-cliente"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 underline underline-offset-2"
          >
            e-redes.pt <ExternalLink className="h-3 w-3" />
          </a>
        </CardDescription>
      </CardHeader>

      <CardContent>
        {done ? (
          <div className="flex items-center gap-2 text-sm text-primary">
            <CheckCircle2 className="h-4 w-4" />
            {t('success')}
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-border/60 bg-background/40 px-4 py-2 text-sm hover:border-primary/60 transition">
              <Upload className="h-4 w-4 text-muted-foreground" />
              {file ? file.name : t('chooseFile')}
              <input
                ref={fileRef}
                type="file"
                accept=".csv,text/csv"
                className="sr-only"
                onChange={onFileChange}
                disabled={isPending}
              />
            </label>

            <Button
              size="sm"
              onClick={onSubmit}
              disabled={!file || isPending}
            >
              {isPending ? t('importing') : t('import')}
            </Button>
          </div>
        )}

        {error ? (
          <div className="mt-3 flex items-start gap-2 text-sm text-destructive">
            <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
            {error}
          </div>
        ) : null}

        <p className="mt-3 text-xs text-muted-foreground">{t('hint')}</p>
      </CardContent>
    </Card>
  )
}
