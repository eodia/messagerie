'use client'

import { PasswordInput } from '@/components/app/auth-layout'
import { CopyButton } from '@/components/app/copy-button'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { SignInFailure, elevate } from '@/lib/basedb-session'
import { $t } from '@/lib/i18n'
import { messageFor } from '@/lib/messages'
import { KeyRound, LoaderCircle, ShieldCheck } from 'lucide-react'
import { type ReactNode, useId, useState } from 'react'
import { codeOf } from '../kit/data'

/**
 * An action on an account — an invitation, a new password — in three steps when basedb asks
 * for them: the form, the supervisor's own password (basedb wants it again before an
 * account is created or reset), and the temporary password, shown this once to hand over.
 */
export function AccountDialog({
  title,
  description,
  action,
  run,
  ready = true,
  children,
  onClose,
  done,
}: {
  readonly title: string
  readonly description: string
  /** The button that runs it: « Inviter », « Générer »… */
  readonly action: string
  /** The temporary password, or null when there is none to hand over. */
  readonly run: () => Promise<string | null>
  readonly ready?: boolean
  readonly children?: ReactNode
  readonly onClose: () => void
  /** What the last step says, besides the password. */
  readonly done: (password: string | null) => ReactNode
}) {
  const [step, setStep] = useState<'form' | 'password' | 'done'>('form')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [password, setPassword] = useState('')
  const [visible, setVisible] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  const passwordId = useId()

  async function attempt() {
    setBusy(true)
    setError(null)
    try {
      setResult(await run())
      setStep('done')
    } catch (failure) {
      const code = codeOf(failure)
      if (code === 'ELEVATION_REQUIRED') setStep('password')
      else setError(messageFor(code))
    } finally {
      setBusy(false)
    }
  }

  async function confirm() {
    setBusy(true)
    setError(null)
    try {
      await elevate(password)
      setPassword('')
    } catch (failure) {
      setBusy(false)
      setError(
        failure instanceof SignInFailure && failure.code === 'CREDENTIALS_INVALID'
          ? $t('Mot de passe incorrect.')
          : messageFor(codeOf(failure)),
      )
      return
    }
    await attempt()
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md gap-0 p-0">
        <DialogHeader className="px-6 pt-6 pb-4">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <form
          onSubmit={(event) => {
            event.preventDefault()
            if (step === 'form') void attempt()
            else if (step === 'password') void confirm()
            else onClose()
          }}
        >
          <div className="space-y-4 px-6 pb-5">
            {step === 'form' && children}

            {step === 'password' && (
              <div className="space-y-3">
                <div className="flex items-start gap-2.5 rounded-lg border bg-muted/40 px-3 py-2.5 text-xs text-muted-foreground">
                  <ShieldCheck className="mt-0.5 size-4 shrink-0 text-foreground" />
                  {$t(
                    'Une action sur les comptes : confirmez votre mot de passe. Il ne sera pas redemandé pendant quelques minutes.',
                  )}
                </div>
                <div className="space-y-2">
                  <Label htmlFor={passwordId} className="text-foreground">
                    {$t('Votre mot de passe')}
                  </Label>
                  <PasswordInput
                    id={passwordId}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    visible={visible}
                    onVisibleChange={setVisible}
                    autoComplete="current-password"
                    autoFocus
                  />
                </div>
              </div>
            )}

            {step === 'done' && (
              <div className="space-y-4">
                {result && (
                  <div className="space-y-2">
                    <div className="flex items-center gap-1.5 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
                      <KeyRound className="size-3.5" />
                      {$t('Mot de passe temporaire')}
                    </div>
                    <div className="flex items-center gap-2 rounded-lg border bg-muted/40 py-2 pr-2 pl-3">
                      <code className="min-w-0 flex-1 truncate font-mono text-base tracking-wider">
                        {result}
                      </code>
                      <CopyButton text={result} label={$t('Copier le mot de passe')}>
                        {$t('Copier')}
                      </CopyButton>
                    </div>
                    <p className="text-xs text-amber-700 dark:text-amber-400">
                      {$t(
                        'Il ne s’affichera plus : transmettez-le maintenant, par un autre canal que l’adresse.',
                      )}
                    </p>
                  </div>
                )}
                {done(result)}
              </div>
            )}

            {error && <p className="animate-shake text-sm text-destructive">{error}</p>}
          </div>

          <DialogFooter className="border-t px-6 py-3">
            {step !== 'done' && (
              <Button type="button" variant="ghost" size="sm" onClick={onClose}>
                {$t('Annuler')}
              </Button>
            )}
            <Button
              type="submit"
              size="sm"
              className="gap-1.5"
              disabled={busy || (step === 'form' && !ready) || (step === 'password' && !password)}
            >
              {busy && <LoaderCircle className="size-3.5 animate-spin" />}
              {step === 'form' ? action : step === 'password' ? $t('Confirmer') : $t('Terminé')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/**
 * basedb asks the supervisor's password again — a role given, an account changed: the
 * password, then what was being done, done again.
 */
export function ElevateDialog({
  onDone,
  onClose,
}: {
  readonly onDone: () => void
  readonly onClose: () => void
}) {
  const [password, setPassword] = useState('')
  const [visible, setVisible] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const id = useId()

  async function confirm() {
    setBusy(true)
    setError(null)
    try {
      await elevate(password)
      onDone()
    } catch (failure) {
      setError(
        failure instanceof SignInFailure && failure.code === 'CREDENTIALS_INVALID'
          ? $t('Mot de passe incorrect.')
          : messageFor(codeOf(failure)),
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-sm gap-0 p-0">
        <DialogHeader className="px-6 pt-6 pb-4">
          <DialogTitle>{$t('Confirmez votre mot de passe')}</DialogTitle>
          <DialogDescription>
            {$t('Ce changement touche aux droits d’un compte : basedb demande votre mot de passe.')}
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(event) => {
            event.preventDefault()
            void confirm()
          }}
        >
          <div className="space-y-2 px-6 pb-5">
            <Label htmlFor={id} className="text-foreground">
              {$t('Votre mot de passe')}
            </Label>
            <PasswordInput
              id={id}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              visible={visible}
              onVisibleChange={setVisible}
              autoComplete="current-password"
              autoFocus
            />
            {error && <p className="animate-shake text-sm text-destructive">{error}</p>}
          </div>
          <DialogFooter className="border-t px-6 py-3">
            <Button type="button" variant="ghost" size="sm" onClick={onClose}>
              {$t('Annuler')}
            </Button>
            <Button type="submit" size="sm" className="gap-1.5" disabled={busy || !password}>
              {busy && <LoaderCircle className="size-3.5 animate-spin" />}
              {$t('Confirmer et enregistrer')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
