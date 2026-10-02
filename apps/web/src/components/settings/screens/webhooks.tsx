'use client'

import { CodeGroup } from '@/components/api-reference/code-block'
import { Chip } from '@/components/app/chip'
import { CopyButton } from '@/components/app/copy-button'
import { InboxGlyph } from '@/components/app/look'
import { RowsSkeleton } from '@/components/app/skeletons'
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
import { Hint } from '@/components/ui/tooltip'
import { ApiFailure, api } from '@/lib/api'
import { $t, $tp, intlLocale } from '@/lib/i18n'
import { messageFor } from '@/lib/messages'
import { useInbox } from '@/lib/store/inbox'
import { cn } from '@/lib/utils'
import type {
  CreatedWebhook,
  DeliveryStatus,
  Webhook,
  WebhookDelivery,
  WebhookEventType,
} from '@chat/contracts'
import {
  ChevronDown,
  LoaderCircle,
  Pause,
  Play,
  Plus,
  Send,
  Trash2,
  Webhook as WebhookIcon,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { Field, FormSection } from '../kit/controls'

/**
 * The webhooks (D17) — basedb's, for the chat: another system told, within seconds, what
 * happens in the conversations — a message, a handoff, a resolution —, signed with a secret
 * shown once. Only to an HTTPS address that is public: a webhook must not become a way
 * into the network the chat runs in. What the log shows of a call is its state and the
 * code the other side answered — never the network's detail.
 */

const EVENTS: readonly {
  readonly group: 'conversation' | 'message'
  readonly id: WebhookEventType
  readonly label: string
}[] = [
  { group: 'message', id: 'message.created', label: $t('Nouveau message') },
  { group: 'message', id: 'message.deleted', label: $t('Message supprimé') },
  { group: 'conversation', id: 'conversation.created', label: $t('Nouvelle conversation') },
  { group: 'conversation', id: 'conversation.handed_off', label: $t('Passée à un conseiller') },
  { group: 'conversation', id: 'conversation.assigned', label: $t('Affectée') },
  { group: 'conversation', id: 'conversation.transferred', label: $t('Transférée') },
  { group: 'conversation', id: 'conversation.resolved', label: $t('Résolue') },
  { group: 'conversation', id: 'conversation.reopened', label: $t('Rouverte') },
]

const labelOf = (type: string) =>
  type === 'webhook.ping' ? $t('Test') : (EVENTS.find((e) => e.id === type)?.label ?? type)

const STATUS: Readonly<Record<DeliveryStatus, string>> = {
  pending: $t('En attente'),
  in_flight: $t('En cours'),
  delivered: $t('Livrée'),
  failed: $t('Échec'),
  abandoned: $t('Abandonnée'),
}

const TIME = new Intl.DateTimeFormat(intlLocale(), { dateStyle: 'short', timeStyle: 'medium' })

/** How the other side checks a call: the HMAC of the raw body, and its freshness. */
function verification(): { lang: string; title: string; body: string }[] {
  return [
    {
      lang: 'js',
      title: $t('Vérifier la signature (Node.js)'),
      body: [
        "import { createHmac, timingSafeEqual } from 'node:crypto'",
        '',
        `// ${$t('header : X-Messagerie-Signature, « t=1758204180,v1=… » ; body : le corps BRUT reçu.')}`,
        'function authentique(header, body, secret) {',
        "  const { t, v1 } = Object.fromEntries(header.split(',').map((p) => p.split('=')))",
        "  const attendu = createHmac('sha256', secret).update(`${t}.${body}`).digest('hex')",
        '  const frais = Math.abs(Date.now() / 1000 - Number(t)) < 300',
        "  return frais && timingSafeEqual(Buffer.from(v1, 'hex'), Buffer.from(attendu, 'hex'))",
        '}',
      ].join('\n'),
    },
    {
      lang: 'json',
      title: $t('Ce qui arrive'),
      body: JSON.stringify(
        {
          events: [
            {
              id: '6f1c…',
              type: 'message.created',
              occurredAt: '2026-10-02T09:14:03.512Z',
              conversation: { id: '4f1c…', status: 'open', contact: { name: 'Léa Martin' } },
              message: { id: '9a8b…', kind: 'visitor', body: 'Où en est mon remboursement ?' },
            },
          ],
        },
        null,
        2,
      ),
    },
  ]
}

const failure = (error: unknown) => (error instanceof ApiFailure ? error.code : 'INTERNAL_ERROR')

export function WebhooksPanel({
  creating,
  onCreating,
}: {
  readonly creating: boolean
  readonly onCreating: (open: boolean) => void
}) {
  const [hooks, setHooks] = useState<Webhook[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [removing, setRemoving] = useState<Webhook | null>(null)

  const load = () =>
    api
      .webhooks()
      .then((list) => {
        setHooks(list)
        setError(null)
      })
      .catch((e: unknown) => {
        setHooks([])
        setError(failure(e))
      })

  // biome-ignore lint/correctness/useExhaustiveDependencies: read once, on opening
  useEffect(() => void load(), [])

  const act = (work: Promise<unknown>) =>
    work.then(load).catch((e: unknown) => setError(failure(e)))

  if (error === 'NOT_ALLOWED') {
    return (
      <p className="rounded-lg border bg-muted/40 px-4 py-6 text-center text-sm text-muted-foreground">
        {$t('Les webhooks se gèrent par les superviseurs.')}
      </p>
    )
  }
  return (
    <>
      {hooks === null ? (
        <RowsSkeleton rows={3} />
      ) : (
        <section className="space-y-3">
          <h2 className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
            {$t('Webhooks')} <span className="font-normal tabular-nums">{hooks.length}</span>
          </h2>
          {error && <p className="text-sm text-destructive">{messageFor(error)}</p>}
          {hooks.length === 0 ? (
            <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed px-6 py-10 text-center">
              <WebhookIcon className="size-5 text-muted-foreground" />
              <p className="max-w-sm text-sm text-muted-foreground">
                {$t(
                  'Aucun webhook : prévenez un autre système — un CRM, un entrepôt de données, une alerte — de ce qui se passe dans les conversations.',
                )}
              </p>
              <Button size="sm" variant="outline" onClick={() => onCreating(true)}>
                <Plus />
                {$t('Nouveau webhook')}
              </Button>
            </div>
          ) : (
            <ul className="space-y-2">
              {hooks.map((hook) => (
                <WebhookRow
                  key={hook.id}
                  hook={hook}
                  onToggle={() => act(api.setWebhookActive(hook.id, !hook.active))}
                  onRemove={() => setRemoving(hook)}
                  onTested={() => void load()}
                />
              ))}
            </ul>
          )}
        </section>
      )}

      {creating && <CreateDialog onClose={() => onCreating(false)} onCreated={() => void load()} />}
      <Dialog open={removing !== null} onOpenChange={(open) => !open && setRemoving(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {$t('Supprimer « {label} » ?', { label: removing?.label ?? '' })}
            </DialogTitle>
            <DialogDescription>
              {$t(
                'Il n’est plus prévenu de rien, et ce qui attendait d’être envoyé ne le sera pas. Cela ne se défait pas.',
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRemoving(null)}>
              {$t('Annuler')}
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                const target = removing
                setRemoving(null)
                if (target) void act(api.deleteWebhook(target.id))
              }}
            >
              {$t('Supprimer')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

function WebhookRow({
  hook,
  onToggle,
  onRemove,
  onTested,
}: {
  readonly hook: Webhook
  readonly onToggle: () => void
  readonly onRemove: () => void
  /** A test went out: what the row says of the last delivery reads again. */
  readonly onTested: () => void
}) {
  const inboxes = useInbox((s) => s.directory.inboxes)
  const [log, setLog] = useState(false)
  /** Moves when a test is sent: the log reads again. */
  const [tested, setTested] = useState(0)
  const [testing, setTesting] = useState(false)
  const boxes =
    hook.inboxIds === null
      ? $t('Toutes les boîtes')
      : hook.inboxIds.map((id) => inboxes.find((i) => i.id === id)?.name ?? id).join(', ')
  const events =
    hook.events.length === EVENTS.length
      ? $t('Tous les événements')
      : hook.events.map(labelOf).join(', ')

  const test = async () => {
    setTesting(true)
    try {
      await api.testWebhook(hook.id)
      setLog(true)
      // The postman passes every two seconds: the log is read once it has.
      await new Promise((done) => setTimeout(done, 2500))
      setTested((n) => n + 1)
      onTested()
    } finally {
      setTesting(false)
    }
  }

  return (
    <li className="rounded-lg border bg-card px-4 py-3">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md bg-muted">
          <WebhookIcon className="size-4 text-muted-foreground" />
        </span>
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate text-sm font-medium">{hook.label}</span>
            {hook.active ? (
              <Chip tint="emerald">{$t('Actif')}</Chip>
            ) : hook.disabledReason === 'failures' ? (
              <Chip tint="rose">{$t('Arrêté après des échecs répétés')}</Chip>
            ) : (
              <Chip tint="zinc">{$t('Arrêté')}</Chip>
            )}
          </div>
          <p className="truncate font-mono text-[11px] text-muted-foreground">{hook.url}</p>
          <p className="text-xs text-muted-foreground">
            {events} · {boxes}
          </p>
          <p className="text-xs text-muted-foreground">
            {$t('Créé par {name} le {date}', {
              name: hook.createdBy,
              date: new Date(hook.createdAt).toLocaleDateString(intlLocale(), {
                day: 'numeric',
                month: 'short',
                year: 'numeric',
              }),
            })}
            {' · '}
            {hook.lastDeliveryAt
              ? $t('dernier envoi livré le {date}', {
                  date: TIME.format(new Date(hook.lastDeliveryAt)),
                })
              : $t('rien de livré encore')}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          {hook.active && (
            <Hint label={$t('Envoyer un test')}>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={$t('Envoyer un test à {label}', { label: hook.label })}
                disabled={testing}
                onClick={() => void test()}
              >
                {testing ? <LoaderCircle className="animate-spin" /> : <Send />}
              </Button>
            </Hint>
          )}
          <Hint label={hook.active ? $t('Arrêter') : $t('Reprendre')}>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={
                hook.active
                  ? $t('Arrêter {label}', { label: hook.label })
                  : $t('Reprendre {label}', { label: hook.label })
              }
              onClick={onToggle}
            >
              {hook.active ? <Pause /> : <Play />}
            </Button>
          </Hint>
          <Hint label={$t('Supprimer')}>
            <Button
              variant="ghost"
              size="icon-sm"
              className="text-destructive hover:text-destructive"
              aria-label={$t('Supprimer {label}', { label: hook.label })}
              onClick={onRemove}
            >
              <Trash2 />
            </Button>
          </Hint>
        </div>
      </div>
      <button
        type="button"
        aria-expanded={log}
        onClick={() => setLog((open) => !open)}
        className="mt-2 ml-11 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
      >
        <ChevronDown className={cn('size-3 transition-transform', log && 'rotate-180')} />
        {$t('Derniers envois')}
      </button>
      {log && <Deliveries webhookId={hook.id} tested={tested} />}
    </li>
  )
}

/** The last calls of a webhook: their state, their tries, the code the other side answered. */
function Deliveries({
  webhookId,
  tested,
}: { readonly webhookId: string; readonly tested: number }) {
  const [rows, setRows] = useState<WebhookDelivery[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void tested
    api.webhookDeliveries(webhookId).then(setRows, (e: unknown) => {
      setRows([])
      setError(failure(e))
    })
  }, [webhookId, tested])

  if (rows === null) {
    return <RowsSkeleton rows={2} avatar={false} className="ml-9" />
  }
  if (error !== null) {
    return <p className="mt-2 ml-11 text-xs text-destructive">{messageFor(error)}</p>
  }
  if (rows.length === 0) {
    return (
      <p className="mt-2 ml-11 text-xs text-muted-foreground">
        {$t('Rien n’a encore été envoyé.')}
      </p>
    )
  }
  return (
    <ul className="mt-2 ml-11 divide-y rounded-md border text-xs">
      {rows.slice(0, 20).map((d) => (
        <li key={d.id} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 px-2.5 py-1.5">
          <Chip
            tint={
              d.status === 'delivered'
                ? 'emerald'
                : d.status === 'failed'
                  ? 'rose'
                  : d.status === 'abandoned'
                    ? 'zinc'
                    : 'amber'
            }
          >
            {STATUS[d.status]}
          </Chip>
          <span className="font-medium">{labelOf(d.type)}</span>
          <span className="text-muted-foreground tabular-nums">
            {TIME.format(new Date(d.createdAt))}
          </span>
          {d.responseCode !== null ? (
            <span className="font-mono text-muted-foreground">HTTP {d.responseCode}</span>
          ) : (
            d.errorCode && <span className="text-muted-foreground">{reasonOf(d.errorCode)}</span>
          )}
          {d.attempts > 1 && (
            <span className="text-muted-foreground">
              {$tp(d.attempts, '{count} tentative', '{count} tentatives')}
            </span>
          )}
          {d.nextAttemptAt && (
            <span className="text-muted-foreground">
              {$t('nouvel essai {date}', { date: TIME.format(new Date(d.nextAttemptAt)) })}
            </span>
          )}
        </li>
      ))}
    </ul>
  )
}

/** Why a call got no answer — said plainly, without the network's detail. */
function reasonOf(code: string): string {
  switch (code) {
    case 'TIMEOUT':
      return $t('pas de réponse en 10 secondes')
    case 'NETWORK':
      return $t('injoignable')
    case 'TARGET_REJECTED':
      return $t('adresse refusée')
    case 'REDIRECT':
      return $t('redirection refusée')
    case 'SECRET_UNREADABLE':
      return $t('secret illisible : recréez le webhook')
    default:
      return code
  }
}

function CreateDialog({
  onClose,
  onCreated,
}: {
  readonly onClose: () => void
  readonly onCreated: () => void
}) {
  const inboxes = useInbox((s) => s.directory.inboxes)
  const [label, setLabel] = useState('')
  const [url, setUrl] = useState('https://')
  const [chosen, setChosen] = useState<WebhookEventType[]>(['message.created'])
  const [scope, setScope] = useState<'all' | 'some'>('all')
  const [boxes, setBoxes] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [created, setCreated] = useState<CreatedWebhook | null>(null)

  const ready =
    label.trim() !== '' &&
    /^https?:\/\/[^/\s]+/.test(url.trim()) &&
    chosen.length > 0 &&
    (scope === 'all' || boxes.length > 0) &&
    !saving

  const toggle = (id: WebhookEventType) =>
    setChosen((all) => (all.includes(id) ? all.filter((e) => e !== id) : [...all, id]))

  async function create() {
    setSaving(true)
    setError(null)
    try {
      const made = await api.createWebhook({
        label: label.trim(),
        url: url.trim(),
        events: EVENTS.map((e) => e.id).filter((id) => chosen.includes(id)),
        inboxIds: scope === 'all' ? null : boxes,
      })
      setCreated(made)
      onCreated()
    } catch (e) {
      setError(failure(e))
    } finally {
      setSaving(false)
    }
  }

  const group = (which: 'conversation' | 'message', title: string) => (
    <div className="space-y-1.5">
      <p className="text-xs text-muted-foreground">{title}</p>
      <div className="flex flex-wrap gap-1.5">
        {EVENTS.filter((e) => e.group === which).map((e) => {
          const on = chosen.includes(e.id)
          return (
            <button
              key={e.id}
              type="button"
              aria-pressed={on}
              onClick={() => toggle(e.id)}
              className={cn(
                'inline-flex h-8 items-center rounded-md border px-2.5 text-xs transition-colors',
                on ? 'border-primary bg-primary/10 font-medium' : 'hover:bg-accent',
              )}
            >
              {e.label}
            </button>
          )
        })}
      </div>
    </div>
  )

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className={created ? 'max-w-2xl' : 'max-w-xl'}>
        {created ? (
          <>
            <DialogHeader>
              <DialogTitle>{$t('Webhook créé')}</DialogTitle>
              <DialogDescription>
                {$t(
                  'Copiez le secret de « {label} » maintenant : il ne sera plus jamais affiché. Il sert au système destinataire à vérifier que chaque envoi vient bien d’ici.',
                  { label: created.webhook.label },
                )}
              </DialogDescription>
            </DialogHeader>
            <div className="min-w-0 space-y-4">
              <div className="flex items-center gap-1 rounded-md border bg-muted/40 py-1.5 pr-1.5 pl-3">
                <code className="min-w-0 flex-1 font-mono text-xs break-all">{created.secret}</code>
                <CopyButton text={created.secret} label={$t('Copier le secret')}>
                  {$t('Copier')}
                </CopyButton>
              </div>
              <CodeGroup blocks={verification()} />
            </div>
            <DialogFooter>
              <Button onClick={onClose}>{$t('J’ai copié le secret')}</Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>{$t('Nouveau webhook')}</DialogTitle>
              <DialogDescription>
                {$t(
                  'Un autre système est prévenu, dans les secondes, de ce qui se passe dans les conversations. Chaque envoi est signé ; un échec est retenté pendant plus d’un jour.',
                )}
              </DialogDescription>
            </DialogHeader>
            <div className="max-h-[60vh] space-y-6 overflow-y-auto pr-1 scroll-discret">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={$t('Nom')} required>
                  {(id) => (
                    <Input
                      id={id}
                      autoFocus
                      value={label}
                      maxLength={200}
                      onChange={(event) => setLabel(event.target.value)}
                      placeholder={$t('Synchronisation CRM')}
                    />
                  )}
                </Field>
                <Field label={$t('Adresse (HTTPS)')} required>
                  {(id) => (
                    <Input
                      id={id}
                      value={url}
                      inputMode="url"
                      onChange={(event) => setUrl(event.target.value)}
                      placeholder="https://exemple.fr/messagerie"
                    />
                  )}
                </Field>
              </div>
              <FormSection title={$t('Quand prévenir')}>
                {group('message', $t('Messages'))}
                {group('conversation', $t('Conversations'))}
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
                      const on = boxes.includes(inbox.id)
                      return (
                        <button
                          key={inbox.id}
                          type="button"
                          aria-pressed={on}
                          onClick={() =>
                            setBoxes((all) =>
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
              {error && <p className="text-sm text-destructive">{messageFor(error)}</p>}
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={onClose}>
                {$t('Annuler')}
              </Button>
              <Button disabled={!ready} onClick={() => void create()}>
                {saving && <LoaderCircle className="animate-spin" />}
                {$t('Créer le webhook')}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
