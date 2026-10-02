'use client'

import { Button } from '@/components/ui/button'
import { TooltipProvider } from '@/components/ui/tooltip'
import { configureApi } from '@/lib/api'
import { $t } from '@/lib/i18n'
import { AuthFailure, linkInfo, redeemLink } from '@/lib/session'
import { useTitle } from '@/lib/title'
import type { LinkInfo } from '@chat/contracts'
import { Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { AuthLayout, pauseOnSuccess } from './auth-layout'
import { ChoosePassword, sentence } from './sign-in'

/**
 * A link a supervisor handed over (D19): to join — the invited agent chooses their
 * password —, or to choose a new one. Used once; then the inbox, signed in.
 */
export function Invitation({ apiUrl, token }: { readonly apiUrl: string; readonly token: string }) {
  configureApi(apiUrl)
  // The sign-in's glimpse of the inbox draws its rows, hints included.
  return (
    <TooltipProvider delayDuration={300}>
      <Link token={token} />
    </TooltipProvider>
  )
}

function Link({ token }: { readonly token: string }) {
  const [info, setInfo] = useState<LinkInfo | null>(null)
  const [refused, setRefused] = useState<string | null>(null)
  const [error, setError] = useState<{ code: string; attempt: number } | null>(null)
  useTitle([info?.purpose === 'reset' ? $t('Nouveau mot de passe') : $t('Invitation')])

  useEffect(() => {
    linkInfo(token)
      .then(setInfo)
      .catch((failure: unknown) =>
        setRefused(failure instanceof AuthFailure ? failure.code : 'UNREACHABLE'),
      )
  }, [token])

  if (refused) {
    return (
      <AuthLayout title={$t('Lien inutilisable')} description={sentence(refused)}>
        <Button asChild size="lg" variant="outline" className="w-full">
          <a href="/">{$t('Aller à la connexion')}</a>
        </Button>
      </AuthLayout>
    )
  }
  if (!info) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    )
  }
  return (
    <AuthLayout
      title={
        info.purpose === 'invite'
          ? $t('Bienvenue, {name}', { name: info.name.split(/\s+/)[0] ?? info.name })
          : $t('Nouveau mot de passe')
      }
      description={
        info.purpose === 'invite'
          ? $t('Choisissez votre mot de passe pour rejoindre la messagerie, avec {email}.', {
              email: info.email ?? '—',
            })
          : $t('Choisissez un nouveau mot de passe pour {email}.', { email: info.email ?? '—' })
      }
    >
      <ChoosePassword
        email={info.email}
        action={info.purpose === 'invite' ? $t('Rejoindre la messagerie') : $t('Enregistrer')}
        error={error}
        onChoose={async (password) => {
          try {
            await redeemLink(token, password)
            await pauseOnSuccess()
            window.location.assign('/')
          } catch (failure) {
            setError((was) => ({
              code: failure instanceof AuthFailure ? failure.code : 'UNREACHABLE',
              attempt: (was?.attempt ?? 0) + 1,
            }))
          }
        }}
      />
    </AuthLayout>
  )
}
