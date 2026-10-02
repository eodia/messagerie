'use client'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { $t } from '@/lib/i18n'
import { AuthFailure, ssoStart } from '@/lib/session'
import { useSession } from '@/lib/store/session'
import { useTitle } from '@/lib/title'
import { cn } from '@/lib/utils'
import { Check, ChevronDown, KeyRound, Loader2 } from 'lucide-react'
import { type FormEvent, useState } from 'react'
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
 * The inbox's sign-in (D19): an e-mail and a password, or the identity provider the
 * server names. At the very first start, nobody can sign in yet: the same screen creates
 * the first supervisor.
 */

export const PASSWORD_MIN = 10

export function sentence(code: string): string {
  switch (code) {
    case 'SIGN_IN_FAILED':
      return $t('Adresse ou mot de passe incorrect.')
    case 'RATE_LIMITED':
      return $t('Trop d’essais : patientez un quart d’heure avant de recommencer.')
    case 'UNREACHABLE':
      return $t('Le serveur de la messagerie ne répond pas.')
    case 'PASSWORD_WEAK':
      return $t('Ce mot de passe ne convient pas : 10 caractères au moins, et pas votre adresse.')
    case 'LINK_INVALID':
      return $t('Ce lien ne vaut plus : il a servi, ou il a expiré. Demandez-en un autre.')
    case 'SETUP_DONE':
      return $t('Le premier superviseur existe déjà : connectez-vous.')
    case 'SSO_FAILED':
      return $t('La connexion par votre fournisseur d’identité a échoué.')
    case 'NOT_AN_AGENT':
      return $t('Ce compte n’est pas celui d’un conseiller actif de la messagerie.')
    default:
      return $t('La connexion a échoué ({code}).', { code })
  }
}

const codeOf = (error: unknown) => (error instanceof AuthFailure ? error.code : 'UNREACHABLE')

/** A refusal, numbered: each new one shakes again. */
type Refusal = { readonly code: string; readonly attempt: number }

export function SignInScreen() {
  const setup = useSession((s) => s.setup)
  useTitle([setup ? $t('Premier lancement') : $t('Connexion')])
  return setup ? <SetUp /> : <SignIn />
}

function SignIn() {
  const sso = useSession((s) => s.sso)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [visible, setVisible] = useState(false)
  const [busy, setBusy] = useState(false)
  const [signedIn, setSignedIn] = useState(false)
  // A refusal the identity provider's return brought: `/connexion?erreur=…`.
  const [error, setError] = useState<Refusal | null>(() => {
    const code = new URLSearchParams(window.location.search).get('erreur')
    return code ? { code, attempt: 1 } : null
  })

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await useSession.getState().signIn(email.trim(), password, async () => {
        setSignedIn(true)
        await pauseOnSuccess()
      })
    } catch (failure) {
      setError((was) => ({ code: codeOf(failure), attempt: (was?.attempt ?? 0) + 1 }))
      setBusy(false)
    }
  }

  const described = error !== null ? 'sign-in-error' : undefined
  const next = window.location.pathname.startsWith('/connexion')
    ? '/'
    : `${window.location.pathname}${window.location.search}`

  return (
    <AuthLayout
      title={$t('Vos clients vous attendent')}
      description={$t('Connectez-vous pour retrouver vos conversations.')}
      footer={
        <details className="group">
          <summary className="flex w-fit cursor-pointer list-none items-center gap-1.5 rounded-sm transition-colors hover:text-foreground [&::-webkit-details-marker]:hidden">
            {$t('Première connexion, mot de passe oublié ?')}
            <ChevronDown
              className="size-3.5 transition-transform duration-200 group-open:rotate-180"
              aria-hidden="true"
            />
          </summary>
          <p className="mt-2 max-w-sm animate-in fade-in slide-in-from-top-1 leading-relaxed duration-300">
            {$t(
              'Un superviseur vous invite depuis « Équipes et conseillers » : il vous transmet un lien où choisir votre mot de passe. Le même lien, renouvelé, sert quand on l’a oublié.',
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
          <Label
            htmlFor="sign-in-password"
            className="text-foreground transition-colors group-focus-within:text-primary"
          >
            {$t('Mot de passe')}
          </Label>
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
            {sentence(error.code)}
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

      {sso && (
        <div className={cn('mt-6 grid gap-2', REVEAL)} style={revealAt(5)}>
          <div className="mb-1 flex items-center gap-3 text-xs text-muted-foreground before:h-px before:flex-1 before:bg-border after:h-px after:flex-1 after:bg-border">
            {$t('ou')}
          </div>
          <Button variant="outline" size="lg" className="w-full" asChild>
            <a href={ssoStart(next)}>
              <KeyRound />
              {$t('Continuer avec {provider}', { provider: sso })}
            </a>
          </Button>
        </div>
      )}
    </AuthLayout>
  )
}

/** The first start: the first supervisor, who invites the others. */
function SetUp() {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<Refusal | null>(null)

  return (
    <AuthLayout
      title={$t('Bienvenue dans la messagerie')}
      description={$t(
        'Premier lancement : créez le compte du premier superviseur. Il invitera les autres conseillers.',
      )}
    >
      <div className="grid gap-5">
        <div className={cn('group grid gap-2', REVEAL)} style={revealAt(0)}>
          <Label htmlFor="setup-name" className="text-foreground">
            {$t('Nom')}
          </Label>
          <Input
            id="setup-name"
            autoComplete="name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            disabled={busy}
            className="h-10"
          />
        </div>
        <div className={cn('group grid gap-2', REVEAL)} style={revealAt(1)}>
          <Label htmlFor="setup-email" className="text-foreground">
            {$t('Adresse e-mail')}
          </Label>
          <Input
            id="setup-email"
            type="email"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            disabled={busy}
            className="h-10"
          />
        </div>
        <ChoosePassword
          order={2}
          email={email}
          action={$t('Créer le compte')}
          disabled={name.trim() === '' || email.trim() === ''}
          error={error}
          onChoose={async (password) => {
            setBusy(true)
            setError(null)
            try {
              await useSession.getState().setUp(name.trim(), email.trim(), password)
            } catch (failure) {
              setError((was) => ({ code: codeOf(failure), attempt: (was?.attempt ?? 0) + 1 }))
              setBusy(false)
            }
          }}
        />
      </div>
    </AuthLayout>
  )
}

/**
 * A new password, typed twice — the first supervisor's, an invited agent's, a forgotten
 * one's. `onChoose` gets it once both agree.
 */
export function ChoosePassword({
  order = 0,
  email,
  action,
  disabled = false,
  error,
  onChoose,
}: {
  readonly order?: number
  readonly email: string | null
  readonly action: string
  readonly disabled?: boolean
  readonly error: Refusal | null
  readonly onChoose: (password: string) => Promise<void>
}) {
  const [next, setNext] = useState('')
  const [again, setAgain] = useState('')
  const [visible, setVisible] = useState(false)
  const [busy, setBusy] = useState(false)
  const mismatch = again !== '' && next !== again
  const short = next !== '' && next.length < PASSWORD_MIN
  const sameAsEmail =
    next !== '' && email !== null && next.toLowerCase() === email.trim().toLowerCase()

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (mismatch || busy || short || sameAsEmail) return
    setBusy(true)
    try {
      await onChoose(next)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={(event) => void submit(event)} className="grid gap-5" aria-busy={busy}>
      <div className={cn('group grid gap-2', REVEAL)} style={revealAt(order)}>
        <Label
          htmlFor="password-next"
          className="text-foreground transition-colors group-focus-within:text-primary"
        >
          {$t('Mot de passe')}
        </Label>
        <PasswordInput
          id="password-next"
          autoComplete="new-password"
          minLength={PASSWORD_MIN}
          value={next}
          onChange={(event) => setNext(event.target.value)}
          visible={visible}
          onVisibleChange={setVisible}
          required
          className="h-10"
        />
        <p
          className={cn(
            'text-xs',
            short || sameAsEmail ? 'text-destructive' : 'text-muted-foreground',
          )}
        >
          {sameAsEmail
            ? $t('Pas votre adresse e-mail.')
            : $t('{count} caractères au moins.', { count: PASSWORD_MIN })}
        </p>
      </div>
      <div className={cn('group grid gap-2', REVEAL)} style={revealAt(order + 1)}>
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
          {sentence(error.code)}
        </FormError>
      )}
      <div className={REVEAL} style={revealAt(order + 2)}>
        <Button
          type="submit"
          size="lg"
          className={cn('mt-1 w-full', PRESSABLE)}
          disabled={disabled || busy || !next || next !== again || short || sameAsEmail}
        >
          {busy && <Loader2 className="animate-spin" aria-hidden="true" />}
          {action}
        </Button>
      </div>
    </form>
  )
}
