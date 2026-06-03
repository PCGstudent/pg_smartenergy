import { Suspense } from 'react'
import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { ArrowLeft, Sparkles } from 'lucide-react'
import { SignInForm } from '@/components/auth/sign-in-form'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export const dynamic = 'force-dynamic'

export default async function SignInPage() {
  const t = await getTranslations('signin')

  return (
    <div className="container flex min-h-[calc(100vh-4rem)] items-center justify-center py-12">
      <div className="w-full max-w-md">
        <Link
          href="/"
          className="mb-6 inline-flex items-center gap-2 text-sm text-muted-foreground transition hover:text-foreground"
        >
          <ArrowLeft className="h-3 w-3" /> {t('back')}
        </Link>
        <Card className="glow-electric">
          <CardHeader className="space-y-2">
            <div className="mb-1 grid h-10 w-10 place-items-center rounded-lg bg-primary/10 ring-1 ring-primary/30">
              <Sparkles className="h-4 w-4 text-primary" />
            </div>
            <CardTitle className="text-base normal-case tracking-normal text-foreground">
              {t('title')}
            </CardTitle>
            <CardDescription>{t('subtitle')}</CardDescription>
          </CardHeader>
          <CardContent>
            <Suspense fallback={<div className="h-32 animate-pulse rounded-lg bg-muted" />}>
              <SignInForm />
            </Suspense>
            <p className="mt-6 text-xs text-muted-foreground">{t('privacy')}</p>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
