import { redirect } from 'next/navigation'
import { Sparkles } from 'lucide-react'
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
  const session = await getSession()
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
              Welcome to Voltwise
            </CardTitle>
            <CardDescription>
              One question and you&apos;re in. Pick the country your meter is in — we&apos;ll
              configure the right OMIE zone, tariff catalog, and grid operator.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <OnboardingForm next={next ?? '/dashboard'} />
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
