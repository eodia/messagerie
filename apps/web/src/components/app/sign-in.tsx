'use client'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { SignInFailure, type SsoProvider, ssoProviders } from '@/lib/basedb-session'
import { $t } from '@/lib/i18n'
import { PRODUCT_NAME } from '@/lib/product'
import { useSession } from '@/lib/store/session'
import { KeyRound, LoaderCircle, MessagesSquare } from 'lucide-react'
import { type FormEvent, type ReactNode, useEffect, useState } from 'react'

/**
 * The inbox's sign-in — with basedb's account: the form signs in to basedb itself, whose
 * session the inbox then shares. One account, one session, for both. An account basedb
 * created with a temporary password chooses its own here, as basedb's interface asks.
 */

function sentence(failure: SignInFailure): string {
  switch (failure.code) {
    case 'CREDENTIALS_INVALID':
      return $t('Adresse ou mot de passe incorrect.')
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

function Frame({
  title,
  subtitle,
  children,
  footer,
}: {
  readonly title: string
  readonly subtitle: string
  readonly children: ReactNode
  readonly footer?: ReactNode
}) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/40 px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <span className="flex size-11 items-center justify-center rounded-xl bg-primary/10 ring-1 ring-primary/10 ring-inset">
            <MessagesSquare
              className="size-5"
              style={{ color: 'color-mix(in oklab, var(--primary) 65%, var(--foreground))' }}
            />
          </span>
          <div>
            <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
          </div>
        </div>
        <div className="rounded-xl border bg-background p-6 shadow-xs">{children}</div>
        {footer && <p className="mt-4 text-center text-xs text-muted-foreground">{footer}</p>}
      </div>
    </div>
  )
}

function Field({
  id,
  label,
  aside,
  ...input
}: {
  readonly id: string
  readonly label: string
  readonly aside?: ReactNode
} & React.ComponentProps<typeof Input>) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label htmlFor={id} className="text-foreground">
          {label}
        </Label>
        {aside}
      </div>
      <Input id={id} required {...input} />
    </div>
  )
}

export function SignInScreen({ basedbUrl }: { readonly basedbUrl: string }) {
  const status = useSession((s) => s.status)
  return status === 'must-change' ? <ChoosePassword /> : <SignIn basedbUrl={basedbUrl} />
}

function SignIn({ basedbUrl }: { readonly basedbUrl: string }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<SignInFailure | null>(null)
  const [providers, setProviders] = useState<SsoProvider[]>([])

  useEffect(() => {
    ssoProviders()
      .then(setProviders)
      .catch(() => {})
  }, [])

  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await useSession.getState().signIn(email.trim(), password)
    } catch (failure) {
      setError(failureOf(failure))
      setBusy(false)
    }
  }

  return (
    <Frame
      title={$t('Connexion à {name}', { name: PRODUCT_NAME })}
      subtitle={$t('Avec votre compte basedb : une seule connexion pour les deux.')}
      footer={$t('Pas encore de compte ? Un administrateur vous invite depuis basedb.')}
    >
      <form onSubmit={(event) => void submit(event)} className="space-y-4">
        <Field
          id="sign-in-email"
          label={$t('Adresse e-mail')}
          type="email"
          autoComplete="username"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
        <Field
          id="sign-in-password"
          label={$t('Mot de passe')}
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          aside={
            <a
              href={basedbUrl}
              target="_blank"
              rel="noreferrer"
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              {$t('Oublié ?')}
            </a>
          }
        />
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {sentence(error)}
          </p>
        )}
        <Button type="submit" className="w-full" disabled={busy || !email || !password}>
          {busy && <LoaderCircle className="animate-spin" />}
          {$t('Se connecter')}
        </Button>
      </form>

      {providers.length > 0 && (
        <>
          <div className="my-5 flex items-center gap-3 text-xs text-muted-foreground">
            <span className="h-px flex-1 bg-border" />
            {$t('ou')}
            <span className="h-px flex-1 bg-border" />
          </div>
          <div className="space-y-2">
            {providers.map((provider) => (
              <Button key={provider.slug} variant="outline" className="w-full" asChild>
                <a href={provider.href}>
                  <KeyRound />
                  {$t('Continuer avec {provider}', { provider: provider.label })}
                </a>
              </Button>
            ))}
          </div>
        </>
      )}
    </Frame>
  )
}

function ChoosePassword() {
  const needsCurrent = useSession((s) => s.needsCurrent)
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [again, setAgain] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<SignInFailure | null>(null)
  const mismatch = again !== '' && next !== again

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (mismatch) return
    setBusy(true)
    setError(null)
    try {
      await useSession.getState().choosePassword(next, needsCurrent ? current : undefined)
    } catch (failure) {
      setError(failureOf(failure))
      setBusy(false)
    }
  }

  return (
    <Frame
      title={$t('Choisissez votre mot de passe')}
      subtitle={$t(
        'Votre compte a un mot de passe temporaire : choisissez le vôtre, 8 caractères au moins. Il vaudra aussi pour basedb.',
      )}
    >
      <form onSubmit={(event) => void submit(event)} className="space-y-4">
        {needsCurrent && (
          <Field
            id="password-current"
            label={$t('Mot de passe temporaire')}
            type="password"
            autoComplete="current-password"
            value={current}
            onChange={(event) => setCurrent(event.target.value)}
          />
        )}
        <Field
          id="password-next"
          label={$t('Nouveau mot de passe')}
          type="password"
          autoComplete="new-password"
          minLength={8}
          value={next}
          onChange={(event) => setNext(event.target.value)}
        />
        <Field
          id="password-again"
          label={$t('Le même, une seconde fois')}
          type="password"
          autoComplete="new-password"
          value={again}
          onChange={(event) => setAgain(event.target.value)}
          aria-invalid={mismatch}
        />
        {mismatch && (
          <p className="text-sm text-destructive">{$t('Les deux saisies diffèrent.')}</p>
        )}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {sentence(error)}
          </p>
        )}
        <Button
          type="submit"
          className="w-full"
          disabled={busy || !next || next !== again || (needsCurrent && !current)}
        >
          {busy && <LoaderCircle className="animate-spin" />}
          {$t('Enregistrer et continuer')}
        </Button>
      </form>
    </Frame>
  )
}
