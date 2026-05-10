'use client'

import { useCallback, useState, useTransition } from 'react'
import { motion } from 'framer-motion'
import { FileText, Loader2, Upload } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { createSupabaseBrowser } from '@/lib/supabase/client'
import { createAudit } from './actions'

const MAX_BYTES = 10 * 1024 * 1024 // 10 MB

export function UploadForm({ userId }: { userId: string }) {
  const t = useTranslations('auditor.upload')
  const [file, setFile] = useState<File | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [progress, setProgress] = useState<'idle' | 'uploading' | 'finalizing'>('idle')
  const [isPending, startTransition] = useTransition()
  const [dragActive, setDragActive] = useState(false)

  const onPick = useCallback(
    (picked: File | null) => {
      setError(null)
      if (!picked) return
      if (picked.type !== 'application/pdf' && !picked.name.toLowerCase().endsWith('.pdf')) {
        setError(t('errors.pdfOnly'))
        return
      }
      if (picked.size > MAX_BYTES) {
        setError(t('errors.tooLarge'))
        return
      }
      setFile(picked)
    },
    [t],
  )

  const onSubmit = () => {
    if (!file) {
      setError(t('errors.pickFirst'))
      return
    }
    setError(null)
    startTransition(async () => {
      try {
        setProgress('uploading')
        const tempId = crypto.randomUUID()
        const storagePath = `${userId}/${tempId}.pdf`
        const supabase = createSupabaseBrowser()
        const { error: upErr } = await supabase.storage.from('invoices').upload(storagePath, file, {
          contentType: 'application/pdf',
          upsert: false,
        })
        if (upErr) throw new Error(upErr.message)

        setProgress('finalizing')
        const result = await createAudit({ storagePath })
        if (result?.error) throw new Error(result.error)
        // createAudit redirects on success; we shouldn't reach here normally.
      } catch (err) {
        setProgress('idle')
        setError(err instanceof Error ? err.message : t('errors.uploadFailed'))
      }
    })
  }

  return (
    <div className="space-y-4">
      <motion.label
        htmlFor="invoice-file"
        onDragOver={(e) => {
          e.preventDefault()
          setDragActive(true)
        }}
        onDragLeave={() => setDragActive(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragActive(false)
          onPick(e.dataTransfer.files?.[0] ?? null)
        }}
        whileHover={{ scale: 1.005 }}
        className={`flex cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed p-10 text-center transition ${
          dragActive
            ? 'border-primary/60 bg-primary/5'
            : file
              ? 'border-primary/40 bg-primary/5'
              : 'border-border/60 bg-background/40 hover:border-border'
        }`}
      >
        <input
          id="invoice-file"
          type="file"
          accept="application/pdf"
          className="hidden"
          onChange={(e) => onPick(e.target.files?.[0] ?? null)}
          disabled={isPending}
        />
        <span className="grid h-12 w-12 place-items-center rounded-xl bg-primary/10 text-primary ring-1 ring-primary/30">
          {file ? <FileText className="h-5 w-5" /> : <Upload className="h-5 w-5" />}
        </span>
        {file ? (
          <div>
            <div className="font-medium">{file.name}</div>
            <div className="text-xs text-muted-foreground">
              {(file.size / 1024).toFixed(0)} KB · {file.type || 'application/pdf'}
            </div>
          </div>
        ) : (
          <div>
            <div className="font-medium">{t('dropHere')}</div>
            <div className="text-xs text-muted-foreground">{t('orClick')}</div>
          </div>
        )}
      </motion.label>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <Button onClick={onSubmit} disabled={isPending || !file} size="lg" className="w-full">
        {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
        {progress === 'uploading'
          ? t('buttonUploading')
          : progress === 'finalizing'
            ? t('buttonFinalizing')
            : t('buttonIdle')}
      </Button>

      <p className="text-xs text-muted-foreground">{t('privacy')}</p>
    </div>
  )
}
