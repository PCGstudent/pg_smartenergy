import { redirect } from 'next/navigation'
import { Settings2 } from 'lucide-react'
import { getTranslations } from 'next-intl/server'
import { getSession } from '@/lib/supabase/auth'
import { createSupabaseServer } from '@/lib/supabase/server'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { SettingsForm } from './settings-form'

export const dynamic = 'force-dynamic'

export default async function SettingsPage() {
  const session = await getSession()
  if (!session) redirect('/signin?next=/settings')

  const [t, supa] = await Promise.all([
    getTranslations('settings'),
    createSupabaseServer(),
  ])

  const { data: profile } = await supa
    .from('profiles')
    .select('display_name, country, contracted_kva, whatsapp_e164')
    .eq('id', session.user.id)
    .maybeSingle()

  return (
    <div className="container max-w-xl py-12">
      <header className="mb-8">
        <p className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
          {t('kicker')}
        </p>
        <h1 className="mt-1 flex items-center gap-2 text-4xl font-semibold tracking-tight">
          <Settings2 className="h-7 w-7 text-primary" />
          {t('title')}
        </h1>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="text-base normal-case tracking-normal text-foreground">
            {session.user.email}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <SettingsForm
            defaultDisplayName={(profile?.display_name as string | null) ?? null}
            defaultCountry={(profile?.country as 'PT' | 'ES' | null) ?? null}
            defaultContractedKva={
              profile?.contracted_kva != null ? Number(profile.contracted_kva) : null
            }
            defaultWhatsappE164={(profile?.whatsapp_e164 as string | null) ?? null}
          />
        </CardContent>
      </Card>
    </div>
  )
}
