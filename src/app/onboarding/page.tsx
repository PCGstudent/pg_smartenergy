import { redirect } from 'next/navigation'
import { Sparkles } from 'lucide-react'
import { getTranslations } from 'next-intl/server'
import { getSession } from '@/lib/supabase/auth'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { OnboardingForm } from './onboarding-form'

export const dynamic = 'force-dynamic'

interface SearchParams {
  next?: string
}

export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const [session, t] = await Promise.all([
    getSession(),
    getTranslations('onboarding'),
  ])
  // Middleware should have caught this, but belt + suspenders.
  if (!session) redirect('/signin?next=/onboarding')

  // Already onboarded? Skip to wherever they were headed.
  if (session.profile?.onboardedAt) {
    const { next } = await searchParams
    redirect(next ?? '/dashboard')
  }

  const { next } = await searchParams

  return (
    <div className="container flex min-h-[calc(100vh-4rem)] items-center justify-center py-12">
      <div className="w-full max-w-xl">
        <Card className="glow-electric">
          <CardHeader className="space-y-2">
            <div className="mb-1 grid h-10 w-10 place-items-center rounded-lg bg-primary/10 ring-1 ring-primary/30">
              <Sparkles className="h-4 w-4 text-primary" />
            </div>
            <CardTitle className="text-base normal-case tracking-normal text-foreground">
              {t('title')}
            </CardTitle>
            <CardDescription>{t('description')}</CardDescription>
          </CardHeader>
          <CardContent>
            <OnboardingForm next={next ?? '/dashboard'} />
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
