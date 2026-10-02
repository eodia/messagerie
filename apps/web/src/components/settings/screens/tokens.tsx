'use client'

import { Chip } from '@/components/app/chip'
import { CopyButton } from '@/components/app/copy-button'
import { InboxGlyph } from '@/components/app/look'
import { ScreenHeader, Slash } from '@/components/app/screen-header'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Segmented } from '@/components/ui/segmented'
import { ApiFailure, api, apiAddress } from '@/lib/api'
import { $t, $tp, intlLocale } from '@/lib/i18n'
import { messageFor } from '@/lib/messages'
import { useInbox } from '@/lib/store/inbox'
import { useTitle } from '@/lib/title'
import { cn } from '@/lib/utils'
import type { ApiToken, CreatedToken, TokenAccess, TokenSurface } from '@chat/contracts'
import { BookOpen, Bot, Eye, KeyRound, LoaderCircle, PenLine, Plus, Terminal } from 'lucide-react'
import Link from 'next/link'
import { type ReactNode, useEffect, useState } from 'react'
import { CardChoice, Field, FormSection, ToggleField } from '../kit/controls'

/**
 * The tokens of the public API and the MCP server (D16) — basedb's integration tokens, for
 * the chat. A supervisor makes one for a program or an agent: what it is for, where it is
 * taken (REST, MCP), its rights (read, or read and write — never delete), its inboxes, how
 * long it lives. Its secret is shown once, with what to paste where; then only its prefix.
 */

const VALIDITY = ['never', '30', '90', '180', '365'] as const
type Validity = (typeof VALIDITY)[number]

const dateOf = (iso: string) =>
  new Date(iso).toLocaleDateString(intlLocale(), {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })

const dead = (t: ApiToken, now: number) =>
  t.revokedAt !== null || (t.expiresAt !== null && new Date(t.expiresAt).getTime() <= now)

export function TokensScreen() {
  useTitle([$t('API et MCP')])
  const [tokens, setTokens] = useState<ApiToken[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [revoking, setRevoking] = useState<ApiToken | null>(null)
  const [deadOpen, setDeadOpen] = useState(false)
  const server = apiAddress()

  const load = () =>
    api
      .tokens()
      .then((list) => {
        setTokens(list)
        setError(null)
      })
      .catch((failure: unknown) => {
        setTokens([])
        setError(failure instanceof ApiFailure ? failure.code : 'INTERNAL_ERROR')
      })

  // biome-ignore lint/correctness/useExhaustiveDependencies: read once, on opening
  useEffect(() => void load(), [])

  const now = Date.now()
  const live = tokens?.filter((t) => !dead(t, now)) ?? []
  const gone = tokens?.filter((t) => dead(t, now)) ?? []
  const allowed = error !== 'NOT_ALLOWED'

  return (
    <>
      <ScreenHeader
        tools={
          <>
            <Button size="sm" variant="outline" asChild>
              <Link href="/documentation">
                <BookOpen />
                {$t('Documentation')}
              </Link>
            </Button>
            {allowed && (
              <Button size="sm" onClick={() => setCreating(true)}>
                <Plus />
                {$t('Nouveau jeton')}
              </Button>
            )}
          </>
        }
      >
        <span className="text-muted-foreground">{$t('Paramétrage')}</span>
        <Slash />
        <span className="font-medium">{$t('API et MCP')}</span>
      </ScreenHeader>
      <div className="flex-1 overflow-y-auto scroll-discret">
        <div className="mx-auto max-w-4xl space-y-8 px-6 py-8">
          <div className="grid gap-3 md:grid-cols-2">
            <Surface
              icon={<Terminal className="size-4" />}
              title={$t('API REST')}
              text={$t(
                'Un programme, un script, une synchronisation : JSON, avec le jeton en en-tête.',
              )}
              address={`${server}/api/v1`}
              docs="/documentation#presentation"
            />
            <Surface
              icon={<Bot className="size-4" />}
              title={$t('Serveur MCP')}
              text={$t('Un agent — Claude ou tout client MCP — lit les conversations et y répond.')}
              address={`${server}/mcp`}
              docs="/documentation#mcp"
            />
          </div>

          {!allowed ? (
            <p className="rounded-lg border bg-muted/40 px-4 py-6 text-center text-sm text-muted-foreground">
              {$t('Les jetons se gèrent par les superviseurs.')}
            </p>
          ) : tokens === null ? (
            <div className="flex justify-center py-10">
              <LoaderCircle className="size-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <section className="space-y-3">
              <h2 className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
                {$t('Jetons actifs')}{' '}
                <span className="font-normal tabular-nums">{live.length}</span>
              </h2>
              {error && <p className="text-sm text-destructive">{messageFor(error)}</p>}
              {live.length === 0 ? (
                <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed px-6 py-10 text-center">
                  <KeyRound className="size-5 text-muted-foreground" />
                  <p className="max-w-sm text-sm text-muted-foreground">
                    {$t('Aucun jeton : créez-en un pour un programme ou un agent.')}
                  </p>
                  <Button size="sm" variant="outline" onClick={() => setCreating(true)}>
                    <Plus />
                    {$t('Nouveau jeton')}
                  </Button>
                </div>
              ) : (
                <ul className="space-y-2">
                  {live.map((t) => (
                    <TokenRow key={t.id} token={t} onRevoke={() => setRevoking(t)} />
                  ))}
                </ul>
              )}
              {gone.length > 0 && (
                <div className="pt-2">
                  <button
                    type="button"
                    onClick={() => setDeadOpen((open) => !open)}
                    className="text-xs text-muted-foreground hover:text-foreground"
                  >
                    {$tp(
                      gone.length,
                      '{count} jeton révoqué ou expiré',
                      '{count} jetons révoqués ou expirés',
                    )}
                  </button>
                  {deadOpen && (
                    <ul className="mt-2 space-y-2 opacity-70">
                      {gone.map((t) => (
                        <TokenRow key={t.id} token={t} />
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </section>
          )}
        </div>
      </div>

      {creating && (
        <CreateDialog
          onClose={() => setCreating(false)}
          onCreated={() => void load()}
          server={server}
        />
      )}
      <Dialog open={revoking !== null} onOpenChange={(open) => !open && setRevoking(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {$t('Révoquer « {label} » ?', { label: revoking?.label ?? '' })}
            </DialogTitle>
            <DialogDescription>
              {$t('Ce qui l’utilise est refusé dès maintenant. Cela ne se défait pas.')}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRevoking(null)}>
              {$t('Annuler')}
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                const target = revoking
                setRevoking(null)
                if (target)
                  api
                    .revokeToken(target.id)
                    .then(load)
                    .catch((failure: unknown) =>
                      setError(failure instanceof ApiFailure ? failure.code : 'INTERNAL_ERROR'),
                    )
              }}
            >
              {$t('Révoquer')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

function Surface({
  icon,
  title,
  text,
  address,
  docs,
}: {
  readonly icon: ReactNode
  readonly title: string
  readonly text: string
  readonly address: string
  /** Its documentation. */
  readonly docs: string
}) {
  return (
    <div className="space-y-2 rounded-lg border bg-card p-4">
      <div className="flex items-center gap-2 text-sm font-medium">
        <span className="flex size-7 items-center justify-center rounded-md bg-muted text-muted-foreground">
          {icon}
        </span>
        {title}
        <Link
          href={docs}
          className="ml-auto inline-flex items-center gap-1 text-xs font-normal text-muted-foreground hover:text-foreground"
        >
          <BookOpen className="size-3.5" />
          {$t('Documentation')}
        </Link>
      </div>
      <p className="text-xs text-muted-foreground">{text}</p>
      <div className="flex items-center gap-1 rounded-md border bg-muted/40 py-1 pr-1 pl-2.5">
        <code className="min-w-0 flex-1 truncate font-mono text-xs">{address}</code>
        <CopyButton text={address} />
      </div>
    </div>
  )
}

function TokenRow({
  token,
  onRevoke,
}: { readonly token: ApiToken; readonly onRevoke?: () => void }) {
  const inboxes = useInbox((s) => s.directory.inboxes)
  const where = token.surfaces.map((s) => (s === 'rest' ? $t('API REST') : $t('MCP'))).join(' · ')
  const boxes =
    token.inboxIds === null
      ? $t('Toutes les boîtes')
      : token.inboxIds.map((id) => inboxes.find((i) => i.id === id)?.name ?? id).join(', ')
  const state = token.revokedAt
    ? $t('Révoqué le {date}', { date: dateOf(token.revokedAt) })
    : token.expiresAt
      ? new Date(token.expiresAt).getTime() <= Date.now()
        ? $t('Expiré le {date}', { date: dateOf(token.expiresAt) })
        : $t('Expire le {date}', { date: dateOf(token.expiresAt) })
      : $t('Sans expiration')
  return (
    <li className="flex items-start gap-3 rounded-lg border bg-card px-4 py-3">
      <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md bg-muted">
        <KeyRound className="size-4 text-muted-foreground" />
      </span>
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate text-sm font-medium">{token.label}</span>
          <Chip tint={token.access === 'write' ? 'amber' : 'sky'}>
            {token.access === 'write' ? $t('Lecture et écriture') : $t('Lecture seule')}
          </Chip>
        </div>
        <p className="truncate text-xs text-muted-foreground">
          <code className="font-mono">{token.prefix}…</code> · {where} · {boxes}
        </p>
        <p className="text-xs text-muted-foreground">
          {$t('Créé par {name} le {date}', {
            name: token.createdBy,
            date: dateOf(token.createdAt),
          })}
          {' · '}
          {token.lastUsedAt
            ? $t('utilisé le {date}', { date: dateOf(token.lastUsedAt) })
            : $t('jamais utilisé')}
          {' · '}
          {state}
        </p>
      </div>
      {onRevoke && (
        <Button size="sm" variant="outline" onClick={onRevoke}>
          {$t('Révoquer')}
        </Button>
      )}
    </li>
  )
}

function CreateDialog({
  onClose,
  onCreated,
  server,
}: {
  readonly onClose: () => void
  readonly onCreated: () => void
  readonly server: string
}) {
  const inboxes = useInbox((s) => s.directory.inboxes)
  const [label, setLabel] = useState('')
  const [rest, setRest] = useState(true)
  const [mcp, setMcp] = useState(true)
  const [access, setAccess] = useState<TokenAccess>('read')
  const [scope, setScope] = useState<'all' | 'some'>('all')
  const [chosen, setChosen] = useState<string[]>([])
  const [validity, setValidity] = useState<Validity>('never')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [created, setCreated] = useState<CreatedToken | null>(null)

  const surfaces: TokenSurface[] = [
    ...(rest ? ['rest' as const] : []),
    ...(mcp ? ['mcp' as const] : []),
  ]
  const ready =
    label.trim() !== '' && surfaces.length > 0 && (scope === 'all' || chosen.length > 0) && !saving

  async function create() {
    setSaving(true)
    setError(null)
    try {
      const made = await api.createToken({
        label: label.trim(),
        access,
        surfaces,
        inboxIds: scope === 'all' ? null : chosen,
        expiresInDays: validity === 'never' ? null : Number(validity),
      })
      setCreated(made)
      onCreated()
    } catch (failure) {
      setError(failure instanceof ApiFailure ? failure.code : 'INTERNAL_ERROR')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-xl">
        {created ? (
          <Secret created={created} server={server} onClose={onClose} />
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>{$t('Nouveau jeton')}</DialogTitle>
              <DialogDescription>
                {$t(
                  'Pour un programme ou un agent. Il ne gère jamais les jetons, et ne supprime rien.',
                )}
              </DialogDescription>
            </DialogHeader>
            <div className="max-h-[60vh] space-y-6 overflow-y-auto pr-1 scroll-discret">
              <Field label={$t('À quoi sert ce jeton ?')} required>
                {(id) => (
                  <Input
                    id={id}
                    autoFocus
                    value={label}
                    maxLength={200}
                    onChange={(event) => setLabel(event.target.value)}
                    placeholder={$t('Synchronisation avec le CRM')}
                  />
                )}
              </Field>
              <FormSection title={$t('Accès')}>
                <ToggleField
                  label={$t('API REST')}
                  hint={$t('Un programme, un script, une synchronisation.')}
                  checked={rest}
                  onChange={setRest}
                />
                <ToggleField
                  label={$t('MCP')}
                  hint={$t('Un agent : Claude ou tout client MCP.')}
                  checked={mcp}
                  onChange={setMcp}
                />
              </FormSection>
              <FormSection title={$t('Droits')}>
                <CardChoice
                  value={access}
                  onChange={setAccess}
                  options={[
                    {
                      value: 'read',
                      label: $t('Lecture seule'),
                      hint: $t('Lire les conversations, les contacts, chercher.'),
                      icon: <Eye className="size-4" />,
                    },
                    {
                      value: 'write',
                      label: $t('Lecture et écriture'),
                      hint: $t('Aussi répondre, noter, affecter, résoudre, étiqueter.'),
                      icon: <PenLine className="size-4" />,
                    },
                  ]}
                />
              </FormSection>
              <FormSection title={$t('Boîtes de réception')}>
                <Segmented
                  aria-label={$t('Boîtes de réception')}
                  value={scope}
                  onValueChange={setScope}
                  options={[
                    { value: 'all', label: $t('Toutes') },
                    { value: 'some', label: $t('Certaines') },
                  ]}
                />
                {scope === 'some' && (
                  <div className="flex flex-wrap gap-1.5">
                    {inboxes.map((inbox) => {
                      const on = chosen.includes(inbox.id)
                      return (
                        <button
                          key={inbox.id}
                          type="button"
                          aria-pressed={on}
                          onClick={() =>
                            setChosen((all) =>
                              on ? all.filter((id) => id !== inbox.id) : [...all, inbox.id],
                            )
                          }
                          className={cn(
                            'inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-xs transition-colors',
                            on ? 'border-primary bg-primary/10 font-medium' : 'hover:bg-accent',
                          )}
                        >
                          <InboxGlyph look={inbox} />
                          {inbox.name}
                        </button>
                      )
                    })}
                  </div>
                )}
              </FormSection>
              <FormSection title={$t('Validité')}>
                <Segmented
                  aria-label={$t('Validité')}
                  value={validity}
                  onValueChange={setValidity}
                  options={VALIDITY.map((v) => ({
                    value: v,
                    label:
                      v === 'never'
                        ? $t('Sans expiration')
                        : v === '365'
                          ? $t('1 an')
                          : $t('{count} jours', { count: v }),
                  }))}
                />
              </FormSection>
              {error && <p className="text-sm text-destructive">{messageFor(error)}</p>}
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={onClose}>
                {$t('Annuler')}
              </Button>
              <Button disabled={!ready} onClick={() => void create()}>
                {saving && <LoaderCircle className="animate-spin" />}
                {$t('Créer le jeton')}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

/** The secret, once: copied now, or never again — with what to paste where. */
function Secret({
  created,
  server,
  onClose,
}: {
  readonly created: CreatedToken
  readonly server: string
  readonly onClose: () => void
}) {
  const { token, secret } = created
  const rest = token.surfaces.includes('rest')
  const mcp = token.surfaces.includes('mcp')
  const snippets = [
    {
      key: 'env',
      label: $t('Variable d’environnement'),
      text: `# PowerShell\n$env:MESSAGERIE_TOKEN = "${secret}"\n# bash\nexport MESSAGERIE_TOKEN="${secret}"`,
    },
    ...(rest
      ? [
          {
            key: 'curl',
            label: 'cURL',
            text: `curl -H "Authorization: Bearer $MESSAGERIE_TOKEN" ${server}/api/v1/conversations`,
          },
        ]
      : []),
    ...(mcp
      ? [
          {
            key: 'claude',
            label: 'Claude Code',
            text: `claude mcp add --transport http messagerie ${server}/mcp --header "Authorization: Bearer $MESSAGERIE_TOKEN"`,
          },
          {
            key: 'json',
            label: 'mcpServers',
            text: JSON.stringify(
              {
                mcpServers: {
                  messagerie: {
                    type: 'http',
                    url: `${server}/mcp`,
                    headers: { Authorization: 'Bearer ${MESSAGERIE_TOKEN}' },
                  },
                },
              },
              null,
              2,
            ),
          },
        ]
      : []),
  ]
  const [shown, setShown] = useState(snippets[0]?.key ?? 'env')
  const snippet = snippets.find((s) => s.key === shown) ?? snippets[0]
  return (
    <>
      <DialogHeader>
        <DialogTitle>{$t('Jeton créé')}</DialogTitle>
        <DialogDescription>
          {$t('Copiez le jeton « {label} » maintenant : il ne sera plus jamais affiché.', {
            label: token.label,
          })}
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-4">
        <div className="flex items-center gap-1 rounded-md border bg-muted/40 py-1.5 pr-1.5 pl-3">
          <code className="min-w-0 flex-1 font-mono text-xs break-all">{secret}</code>
          <CopyButton text={secret} label={$t('Copier le jeton')}>
            {$t('Copier')}
          </CopyButton>
        </div>
        <p className="text-xs text-muted-foreground">
          {$t(
            'Gardez-le dans une variable d’environnement, MESSAGERIE_TOKEN, plutôt que dans un fichier ou un message.',
          )}
        </p>
        <div className="space-y-2">
          <Segmented
            aria-label={$t('Exemples')}
            value={shown}
            onValueChange={setShown}
            options={snippets.map((s) => ({ value: s.key, label: s.label }))}
          />
          {snippet && (
            <div className="relative">
              <pre className="max-h-56 overflow-auto rounded-md border bg-muted/40 p-3 font-mono text-[11px] leading-relaxed whitespace-pre-wrap scroll-discret">
                {snippet.text}
              </pre>
              <div className="absolute top-1.5 right-1.5">
                <CopyButton text={snippet.text} />
              </div>
            </div>
          )}
        </div>
      </div>
      <DialogFooter>
        <Button onClick={onClose}>{$t('J’ai copié le jeton')}</Button>
      </DialogFooter>
    </>
  )
}
