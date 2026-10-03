'use client'

import { afterMenus } from '@/components/inbox/assign-picker'
import { initials } from '@/components/inbox/labels'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { $t } from '@/lib/i18n'
import { AuthFailure, changePassword } from '@/lib/session'
import { useSpeech } from '@/lib/speech'
import { useAlertSettings } from '@/lib/store/alert-settings'
import { useInbox } from '@/lib/store/inbox'
import { useSession } from '@/lib/store/session'
import { type ThemePreference, useTheme } from '@/lib/theme'
import { cn } from '@/lib/utils'
import {
  BellRing,
  ChevronsUpDown,
  Headphones,
  KeyRound,
  LogOut,
  Mail,
  Monitor,
  Moon,
  Smartphone,
  Sun,
  Volume2,
} from 'lucide-react'
import { useState } from 'react'
import { PasswordStrength } from './password-strength'
import { PASSWORD_MIN, sentence } from './sign-in'

type Presence = 'available' | 'away'

/**
 * Who is signed in (D19), whether they take new conversations, the alerts and the theme,
 * their password; opens upwards.
 */
export function UserMenu({ collapsed }: { readonly collapsed: boolean }) {
  const signedIn = useSession((s) => s.agent !== null)
  const [changing, setChanging] = useState(false)
  const me = useInbox((s) => s.me)
  const {
    sound,
    desktop,
    permission,
    push,
    emailAvailable,
    email,
    address,
    setSound,
    setDesktop,
    setPush,
    setEmail,
  } = useAlertSettings()
  const audioMode = useSpeech((s) => s.audioMode)
  const setAudioMode = useSpeech((s) => s.setAudioMode)
  const preference = useTheme((s) => s.preference)
  const setPreference = useTheme((s) => s.setPreference)
  const [presence, setPresence] = useState<Presence>('available')

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            'flex w-full items-center gap-2.5 rounded-lg p-1.5 text-left transition-colors hover:bg-sidebar-accent data-[state=open]:bg-sidebar-accent',
            collapsed && 'justify-center',
          )}
        >
          <span className="relative flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
            {me ? initials(me.name) : ''}
            <span
              className={cn(
                'absolute right-0 bottom-0 size-2.5 rounded-full ring-2 ring-sidebar',
                presence === 'available' ? 'bg-emerald-500' : 'bg-amber-500',
              )}
            />
          </span>
          {!collapsed && (
            <>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{me?.name ?? '…'}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {me?.role === 'supervisor' ? $t('Superviseur') : $t('Conseiller')}
                </span>
              </span>
              <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" />
            </>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="w-64">
        <DropdownMenuLabel>{$t('Disponibilité')}</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={presence}
          onValueChange={(value) => setPresence(value as Presence)}
        >
          <DropdownMenuRadioItem value="available">
            <span className="size-2 rounded-full bg-emerald-500" />
            {$t('Disponible')}
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="away">
            <span className="size-2 rounded-full bg-amber-500" />
            {$t('Absent : aucune nouvelle conversation')}
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>{$t('Alertes')}</DropdownMenuLabel>
        {/* A toggle keeps the menu open: the agent sees what they just changed. */}
        <DropdownMenuCheckboxItem
          checked={sound}
          onCheckedChange={(on) => setSound(on === true)}
          onSelect={(event) => event.preventDefault()}
        >
          <Volume2 />
          {$t('Son à chaque nouveau message')}
        </DropdownMenuCheckboxItem>
        <DropdownMenuCheckboxItem
          checked={desktop}
          disabled={permission === 'denied' || permission === 'unsupported'}
          onCheckedChange={(on) => void setDesktop(on === true)}
          onSelect={(event) => event.preventDefault()}
        >
          <BellRing />
          {permission === 'denied'
            ? $t('Notifications bloquées par le navigateur')
            : $t('Notifications du bureau')}
        </DropdownMenuCheckboxItem>
        {push !== 'unsupported' && (
          <DropdownMenuCheckboxItem
            checked={push === 'on'}
            disabled={push === 'install' || push === 'denied'}
            onCheckedChange={(on) => void setPush(on === true)}
            onSelect={(event) => event.preventDefault()}
            className="items-start"
          >
            <Smartphone className="mt-0.5" />
            <span>
              {$t('Sur cet appareil, inbox fermée')}
              <span className="block text-xs text-muted-foreground">
                {push === 'install'
                  ? $t(
                      'Ajoutez d’abord l’inbox à l’écran d’accueil : « Partager », puis « Sur l’écran d’accueil ».',
                    )
                  : push === 'denied'
                    ? $t('Notifications bloquées par le navigateur')
                    : $t('Ce qui reste non lu quinze secondes, sur ce téléphone ou cet ordinateur')}
              </span>
            </span>
          </DropdownMenuCheckboxItem>
        )}
        {emailAvailable && (
          <DropdownMenuCheckboxItem
            checked={email}
            disabled={address === null}
            onCheckedChange={(on) => void setEmail(on === true)}
            onSelect={(event) => event.preventDefault()}
            className="items-start"
          >
            <Mail className="mt-0.5" />
            <span>
              {$t('Par e-mail')}
              <span className="block text-xs text-muted-foreground">
                {address
                  ? $t('Ce qui reste non lu dix minutes, à {address}', { address })
                  : $t('Votre fiche n’a pas d’adresse e-mail')}
              </span>
            </span>
          </DropdownMenuCheckboxItem>
        )}
        <DropdownMenuCheckboxItem
          checked={audioMode}
          onCheckedChange={(on) => setAudioMode(on === true)}
          onSelect={(event) => event.preventDefault()}
          className="items-start"
        >
          <Headphones className="mt-0.5" />
          <span>
            {$t('Mode audio')}
            <span className="block text-xs text-muted-foreground">
              {$t('Les messages lus à voix haute, les nouveaux du visiteur dès qu’ils arrivent')}
            </span>
          </span>
        </DropdownMenuCheckboxItem>
        <DropdownMenuSeparator />
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            {preference === 'system' ? <Monitor /> : preference === 'dark' ? <Moon /> : <Sun />}
            {$t('Apparence')}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-48">
            <DropdownMenuRadioGroup
              value={preference}
              onValueChange={(value) => setPreference(value as ThemePreference)}
            >
              <DropdownMenuRadioItem value="system">
                <Monitor />
                {$t('Suivre le système')}
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="light">
                <Sun />
                {$t('Clair')}
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="dark">
                <Moon />
                {$t('Sombre')}
              </DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        {signedIn && (
          <>
            <DropdownMenuItem onSelect={() => afterMenus(() => setChanging(true))}>
              <KeyRound />
              {$t('Changer mon mot de passe')}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => void useSession.getState().signOut()}>
              <LogOut />
              {$t('Se déconnecter')}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
      <PasswordDialog open={changing} onOpenChange={setChanging} />
    </DropdownMenu>
  )
}

/** One's own password: the current one, and the new one twice. Every other session ends. */
function PasswordDialog({
  open,
  onOpenChange,
}: {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
}) {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [again, setAgain] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const ready = current !== '' && next.length >= PASSWORD_MIN && next === again && !busy

  async function save() {
    setBusy(true)
    setError(null)
    try {
      await changePassword({ current, next })
      setDone(true)
    } catch (failure) {
      setError(sentence(failure instanceof AuthFailure ? failure.code : 'UNREACHABLE'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        onOpenChange(value)
        if (!value) {
          setCurrent('')
          setNext('')
          setAgain('')
          setError(null)
          setDone(false)
        }
      }}
    >
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{$t('Changer mon mot de passe')}</DialogTitle>
          <DialogDescription>
            {done
              ? $t('C’est fait. Vos autres sessions sont fermées.')
              : $t('{count} caractères au moins. Vos autres sessions seront fermées.', {
                  count: PASSWORD_MIN,
                })}
          </DialogDescription>
        </DialogHeader>
        {!done && (
          <div className="grid gap-3">
            <Input
              type="password"
              autoComplete="current-password"
              placeholder={$t('Mot de passe actuel')}
              value={current}
              onChange={(event) => setCurrent(event.target.value)}
            />
            <Input
              type="password"
              autoComplete="new-password"
              placeholder={$t('Nouveau mot de passe')}
              value={next}
              onChange={(event) => setNext(event.target.value)}
            />
            <PasswordStrength password={next} min={PASSWORD_MIN} />
            <Input
              type="password"
              autoComplete="new-password"
              placeholder={$t('Le même, une seconde fois')}
              value={again}
              onChange={(event) => setAgain(event.target.value)}
              aria-invalid={again !== '' && again !== next}
            />
            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>
        )}
        <DialogFooter>
          {done ? (
            <Button onClick={() => onOpenChange(false)}>{$t('Fermer')}</Button>
          ) : (
            <>
              <Button variant="ghost" onClick={() => onOpenChange(false)}>
                {$t('Annuler')}
              </Button>
              <Button disabled={!ready} onClick={() => void save()}>
                {$t('Enregistrer')}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
