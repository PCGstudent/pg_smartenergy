'use client'

import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { Bell, FileText, Globe2, LogOut, User2 } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { LanguageSwitcher } from '@/components/layout/language-switcher'

export interface UserMenuProps {
  email: string
  country: 'PT' | 'ES' | null
}

export function UserMenu({ email, country }: UserMenuProps) {
  const t = useTranslations()
  const flag = country === 'ES' ? '🇪🇸' : country === 'PT' ? '🇵🇹' : null

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex items-center gap-2 rounded-lg border border-border/60 bg-card/40 px-2.5 py-1.5 text-sm transition hover:border-border hover:bg-secondary"
          aria-label={t('userMenu.trigger')}
        >
          <span className="grid h-6 w-6 place-items-center rounded-md bg-primary/10 text-primary ring-1 ring-primary/30">
            <User2 className="h-3 w-3" />
          </span>
          <span className="hidden max-w-[10rem] truncate text-muted-foreground sm:inline">
            {email}
          </span>
          {flag ? <span className="text-base leading-none">{flag}</span> : null}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>{t('common.signedIn')}</DropdownMenuLabel>
        <DropdownMenuItem disabled className="opacity-100">
          <User2 className="h-3 w-3 text-muted-foreground" />
          <span className="truncate">{email}</span>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/dashboard">
            <Globe2 className="h-3 w-3" />
            {t('common.dashboard')}
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/auditor">
            <FileText className="h-3 w-3" />
            {t('common.auditor')}
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/alerts">
            <Bell className="h-3 w-3" />
            {t('common.alerts')}
          </Link>
        </DropdownMenuItem>
        <LanguageSwitcher />
        <DropdownMenuSeparator />
        <form action="/auth/signout" method="POST">
          <DropdownMenuItem asChild>
            <button
              type="submit"
              className="w-full cursor-pointer text-left text-destructive focus:text-destructive"
            >
              <LogOut className="h-3 w-3" />
              {t('common.signOut')}
            </button>
          </DropdownMenuItem>
        </form>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
