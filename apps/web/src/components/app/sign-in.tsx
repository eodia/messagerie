'use client'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { SignInFailure, type SsoProvider, ssoProviders } from '@/lib/basedb-session'
import { $t } from '@/lib/i18n'
import { useSession } from '@/lib/store/session'
import { cn } from '@/lib/utils'
import { Check, ChevronDown, KeyRound, Loader2 } from 'lucide-react'
import { type FormEvent, useEffect, useState } from 'react'
import {
  AuthLayout,
  FormError,
  PRESSABLE,
  PasswordInput,
  REVEAL,
  pauseOnSuccess,
  revealAt,
} from './auth-layout'

/**
 * The inbox's sign-in — with basedb's account, on basedb's sign-in screen dressed for the
 * chat: the form signs in to basedb itself, whose session the inbox then shares. One
 * account, one session, for both. An account basedb created with a temporary password
 * chooses its own here, as basedb's interface asks.
 */

function sentence(failure: SignInFailure): string {
  switch (failure.code) {
    case 'CREDENTIALS_INVALID':
      return $t('Identifiants incorrects, ou compte indisponible.')
    case 'RATE_LIMIT_EXCEEDED':
      return $t('Trop d’essais : patientez une minute avant de recommencer.')
    case 'UNREACHABLE':
      return $t('basedb ne répond pas : vérifiez qu’il est démarré.')
    case 'PASSWORD_POLICY_VIOLATION':
      switch (failure.reason) {
        case 'trop_court':
          return $t('Trop court : 8 caractères au moins.')
        case 'trop_long':
          return $t('Trop long : 256 caractères au plus.')
        case 'trop_courant':
          return $t('Ce mot de passe est trop courant : choisissez-en un autre.')
        case 'ressemble_a_identite':
          return $t('Il ressemble trop à votre adresse ou à votre nom.')
        default:
          return $t('basedb refuse ce mot de passe.')
      }
    default:
      return $t('basedb a refusé ({code}).', { code: failure.code })
  }
}

const failureOf = (error: unknown) =>
  error instanceof SignInFailure ? error : new SignInFailure('UNREACHABLE')

/** A refusal, numbered: each new one shakes again. */
type Refusal = { readonly failure: SignInFailure; readonly attempt: number }

export function SignInScreen({ basedbUrl }: { readonly basedbUrl: string }) {
  const status = useSession((s) => s.status)
  return status === 'must-change' ? <ChoosePassword /> : <SignIn basedbUrl={basedbUrl} />
}

function SignIn({ basedbUrl }: { readonly basedbUrl: string }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [visible, setVisible] = useState(false)
  const [busy, setBusy] = useState(false)
  const [signedIn, setSignedIn] = useState(false)
  const [error, setError] = useState<Refusal | null>(null)

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const session = useSession.getState()
      await session.signIn(email.trim(), password, async () => {
        setSignedIn(true)
        await pauseOnSuccess()
      })
    } catch (failure) {
      setError((was) => ({ failure: failureOf(failure), attempt: (was?.attempt ?? 0) + 1 }))
      setBusy(false)
    }
  }

  const described = error !== null ? 'sign-in-error' : undefined

  return (
    <AuthLayout
      title={$t('Vos clients vous attendent')}
      description={$t('Connectez-vous avec votre compte basedb pour retrouver vos conversations.')}
      footer={
        <details className="group">
          <summary className="flex w-fit cursor-pointer list-none items-center gap-1.5 rounded-sm transition-colors hover:text-foreground [&::-webkit-details-marker]:hidden">
            {$t('Première connexion ?')}
            <ChevronDown
              className="size-3.5 transition-transform duration-200 group-open:rotate-180"
              aria-hidden="true"
            />
          </summary>
          <p className="mt-2 max-w-sm animate-in fade-in slide-in-from-top-1 leading-relaxed duration-300">
            {$t(
              'Un administrateur crée votre compte dans basedb, vous ajoute aux « Conseillers » et vous transmet un mot de passe temporaire : vous choisirez le vôtre ici, à la première connexion.',
            )}
          </p>
        </details>
      }
    >
      <form onSubmit={(event) => void submit(event)} className="grid gap-5" aria-busy={busy}>
        <div className={cn('group grid gap-2', REVEAL)} style={revealAt(0)}>
          <Label
            htmlFor="sign-in-email"
            className="text-foreground transition-colors group-focus-within:text-primary"
          >
            {$t('Adresse e-mail')}
          </Label>
          <Input
            id="sign-in-email"
            name="email"
            type="email"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            placeholder={$t('vous@entreprise.fr')}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
            disabled={busy}
            aria-describedby={described}
            className="h-10"
          />
        </div>

        <div className={cn('group grid gap-2', REVEAL)} style={revealAt(1)}>
          <div className="flex items-baseline justify-between gap-2">
            <Label
              htmlFor="sign-in-password"
              className="text-foreground transition-colors group-focus-within:text-primary"
            >
              {$t('Mot de passe')}
            </Label>
            <a
              href={basedbUrl}
              target="_blank"
              rel="noreferrer"
              className="rounded-sm text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            >
              {$t('Mot de passe oublié ?')}
            </a>
          </div>
          <PasswordInput
            id="sign-in-password"
            name="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            visible={visible}
            onVisibleChange={setVisible}
            required
            disabled={busy}
            aria-describedby={described}
            className="h-10"
          />
        </div>

        {error !== null && (
          <FormError key={error.attempt} id="sign-in-error">
            {sentence(error.failure)}
          </FormError>
        )}

        <div className={REVEAL} style={revealAt(2)}>
          <Button
            type="submit"
            size="lg"
            className={cn('mt-1 w-full', PRESSABLE)}
            disabled={busy || email === '' || password === ''}
          >
            {signedIn ? (
              <Check className="animate-in zoom-in-50 duration-200" aria-hidden="true" />
            ) : (
              busy && <Loader2 className="animate-spin" aria-hidden="true" />
            )}
            <span aria-live="polite">
              {signedIn ? $t('Connecté') : busy ? $t('Connexion…') : $t('Se connecter')}
            </span>
          </Button>
        </div>
      </form>

      <SsoButtons />
    </AuthLayout>
  )
}

/**
 * « Continuer avec … » — basedb's providers, where the inbox shares basedb's address: basedb
 * only sends a sign-in back to an address of its own. Nothing when there are none.
 */
function SsoButtons() {
  const [providers, setProviders] = useState<SsoProvider[]>([])
  useEffect(() => {
    ssoProviders()
      .then(setProviders)
      .catch(() => {})
  }, [])
  if (providers.length === 0) return null
  return (
    <div className={cn('mt-6 grid gap-2', REVEAL)} style={revealAt(5)}>
      <div className="mb-1 flex items-center gap-3 text-xs text-muted-foreground before:h-px before:flex-1 before:bg-border after:h-px after:flex-1 after:bg-border">
        {$t('ou')}
      </div>
      {providers.map((provider) => (
        <Button key={provider.slug} variant="outline" size="lg" className="w-full" asChild>
          <a href={provider.href}>
            <KeyRound />
            {$t('Continuer avec {provider}', { provider: provider.label })}
          </a>
        </Button>
      ))}
    </div>
  )
}

function ChoosePassword() {
  const needsCurrent = useSession((s) => s.needsCurrent)
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [again, setAgain] = useState('')
  const [visible, setVisible] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<Refusal | null>(null)
  const mismatch = again !== '' && next !== again

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (mismatch || busy) return
    setBusy(true)
    setError(null)
    try {
      await useSession.getState().choosePassword(next, needsCurrent ? current : undefined)
    } catch (failure) {
      setError((was) => ({ failure: failureOf(failure), attempt: (was?.attempt ?? 0) + 1 }))
      setBusy(false)
    }
  }

  return (
    <AuthLayout
      title={$t('Choisissez votre mot de passe')}
      description={$t(
        'Votre compte a un mot de passe temporaire : choisissez le vôtre, 8 caractères au moins. Il vaudra aussi pour basedb.',
      )}
    >
      <form onSubmit={(event) => void submit(event)} className="grid gap-5" aria-busy={busy}>
        {needsCurrent && (
          <div className={cn('group grid gap-2', REVEAL)} style={revealAt(0)}>
            <Label htmlFor="password-current" className="text-foreground">
              {$t('Mot de passe temporaire')}
            </Label>
            <PasswordInput
              id="password-current"
              autoComplete="current-password"
              value={current}
              onChange={(event) => setCurrent(event.target.value)}
              visible={visible}
              onVisibleChange={setVisible}
              required
              className="h-10"
            />
          </div>
        )}
        <div className={cn('group grid gap-2', REVEAL)} style={revealAt(1)}>
          <Label
            htmlFor="password-next"
            className="text-foreground transition-colors group-focus-within:text-primary"
          >
            {$t('Nouveau mot de passe')}
          </Label>
          <PasswordInput
            id="password-next"
            autoComplete="new-password"
            minLength={8}
            value={next}
            onChange={(event) => setNext(event.target.value)}
            visible={visible}
            onVisibleChange={setVisible}
            required
            className="h-10"
          />
        </div>
        <div className={cn('group grid gap-2', REVEAL)} style={revealAt(2)}>
          <Label
            htmlFor="password-again"
            className="text-foreground transition-colors group-focus-within:text-primary"
          >
            {$t('Le même, une seconde fois')}
          </Label>
          <Input
            id="password-again"
            type={visible ? 'text' : 'password'}
            autoComplete="new-password"
            value={again}
            onChange={(event) => setAgain(event.target.value)}
            aria-invalid={mismatch}
            required
            className="h-10"
          />
          {mismatch && (
            <p className="text-xs text-destructive">{$t('Les deux saisies diffèrent.')}</p>
          )}
        </div>
        {error !== null && (
          <FormError key={error.attempt} id="password-error">
            {sentence(error.failure)}
          </FormError>
        )}
        <div className={REVEAL} style={revealAt(3)}>
          <Button
            type="submit"
            size="lg"
            className={cn('mt-1 w-full', PRESSABLE)}
            disabled={busy || !next || next !== again || (needsCurrent && !current)}
          >
            {busy && <Loader2 className="animate-spin" aria-hidden="true" />}
            {$t('Enregistrer et continuer')}
          </Button>
        </div>
      </form>
    </AuthLayout>
  )
}
