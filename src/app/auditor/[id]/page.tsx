import { notFound, redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { getSession } from '@/lib/supabase/auth'
import { createSupabaseServer } from '@/lib/supabase/server'
import { getInvoiceById, getLatestAuditForInvoice } from '@/lib/db/invoice-queries'
import { AuditResult } from '@/components/auditor/audit-result'
import { ProcessingPoll } from './processing'

export const dynamic = 'force-dynamic'

interface Params {
  id: string
}

export default async function AuditDetailPage({
  params,
}: {
  params: Promise<Params>
}) {
  const session = await getSession()
  if (!session) redirect('/signin')

  const [{ id }, supa, t] = await Promise.all([
    params,
    createSupabaseServer(),
    getTranslations('auditor'),
  ])
  const invoice = await getInvoiceById(supa, id)
  if (!invoice) notFound()
  if (invoice.user_id !== session.user.id) notFound() // belt + braces; RLS already enforces

  if (invoice.status === 'pending') {
    return <ProcessingPoll invoiceId={id} />
  }

  if (invoice.status === 'error') {
    const errMsg =
      (invoice.ai_extraction as { error?: string } | null)?.error ?? t('failed.unknownError')
    return (
      <div className="container max-w-2xl py-16 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">{t('failed.title')}</h1>
        <p className="mt-3 text-muted-foreground">{errMsg}</p>
        <p className="mt-6 text-xs text-muted-foreground">{t('failed.tip')}</p>
      </div>
    )
  }

  const audit = await getLatestAuditForInvoice(supa, id)
  if (!audit) {
    // Status says processed but no audit row — shouldn't happen, treat as error.
    return (
      <div className="container max-w-2xl py-16 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">{t('incomplete.title')}</h1>
        <p className="mt-3 text-muted-foreground">{t('incomplete.body')}</p>
      </div>
    )
  }

  return <AuditResult invoice={invoice} audit={audit} />
}
