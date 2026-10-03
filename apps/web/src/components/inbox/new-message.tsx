'use client'

import { ChoiceMenu } from '@/components/settings/field-input'
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
import { Label } from '@/components/ui/label'
import { Segmented } from '@/components/ui/segmented'
import { Textarea } from '@/components/ui/textarea'
import { ApiFailure, api } from '@/lib/api'
import { $t, $tp } from '@/lib/i18n'
import { messageFor } from '@/lib/messages'
import { useInbox } from '@/lib/store/inbox'
import { useNewMessage } from '@/lib/store/new-message'
import type { ContactListItem, OutreachOptions } from '@chat/contracts'
import { LoaderCircle, Mail, Send, Smartphone, X } from 'lucide-react'
import { type ReactNode, useEffect, useId, useState } from 'react'
import { ContactAvatar } from './labels'

/**
 * « Nouveau message » (D23): the agent writes first — by SMS from one of the numbers, or by
 * e-mail. A contact found as one types, or a number or an address. The conversation opens
 * once sent: the customer's answer comes in there, like any other.
 */

type Channel = 'sms' | 'email'

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const compact = (value: string) => value.replace(/[\s.()-]/g, '')
/** A number the server takes: international, or French (06…) read as such. */
function phoneOf(value: string): string | null {
  let phone = compact(value)
  if (/^0[1-9]\d{8}$/.test(phone)) phone = `+33${phone.slice(1)}`
  if (/^00[1-9]/.test(phone)) phone = `+${phone.slice(2)}`
  return /^\+[1-9]\d{6,14}$/.test(phone) ? phone : null
}

/** How many SMS a text takes: 160 characters alone, 153 a part beyond. */
const smsCount = (text: string) => (text.length <= 160 ? 1 : Math.ceil(text.length / 153))

function Row({
  label,
  children,
}: { readonly label: string; readonly children: (id: string) => ReactNode }) {
  const id = useId()
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children(id)}
    </div>
  )
}

/** The sites one may write an e-mail for: with their own address, or the server's SMTP. */
const writable = (options: OutreachOptions) =>
  options.sites.filter((s) => s.mailbox || (options.email && s.emailReplies))

export function NewMessageDialog() {
  const { open, contact: given, hide } = useNewMessage()
  const [options, setOptions] = useState<OutreachOptions | null>(null)
  const [channel, setChannel] = useState<Channel>('sms')
  const [query, setQuery] = useState('')
  const [found, setFound] = useState<readonly ContactListItem[]>([])
  const [contact, setContact] = useState<ContactListItem | null>(null)
  const [address, setAddress] = useState('')
  const [name, setName] = useState('')
  const [numberId, setNumberId] = useState<string | null>(null)
  const [siteId, setSiteId] = useState<string | null>(null)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Opened: what may be used, and the contact it was opened for.
  useEffect(() => {
    if (!open) return
    setContact(given)
    setQuery('')
    setAddress('')
    setName('')
    setText('')
    setError(null)
    void api
      .outreach()
      .then((loaded) => {
        setOptions(loaded)
        const sms = loaded.numbers.length > 0
        setChannel(sms && (!given || given.phone || !given.email) ? 'sms' : 'email')
        setNumberId(loaded.numbers[0]?.id ?? null)
        setSiteId(writable(loaded)[0]?.id ?? null)
      })
      .catch(() => setOptions({ numbers: [], email: false, sites: [] }))
  }, [open, given])

  // The contacts that match what is typed — a name, an address, a number.
  useEffect(() => {
    const typed = query.trim()
    if (contact || typed.length < 2) {
      setFound([])
      return
    }
    const timer = setTimeout(() => {
      void api
        .contacts(typed)
        .then((rows) => setFound(rows.slice(0, 5)))
        .catch(() => setFound([]))
    }, 200)
    return () => clearTimeout(timer)
  }, [query, contact])

  const sms = channel === 'sms'
  // The number it leaves from writes by RCS where the phone reads it.
  const rcs = (options?.numbers.find((n) => n.id === numberId) ?? options?.numbers[0])?.rcs === true
  const canSms = (options?.numbers.length ?? 0) > 0
  const emailSites = options ? writable(options) : []
  const canEmail = emailSites.length > 0
  const viaMailbox = emailSites.find((s) => s.id === siteId)?.mailbox === true
  // What the message goes to: the contact's own, else what was typed.
  const destination = contact
    ? sms
      ? (contact.phone ?? phoneOf(address))
      : (contact.email ?? (EMAIL.test(address.trim()) ? address.trim() : null))
    : sms
      ? phoneOf(query)
      : EMAIL.test(query.trim())
        ? query.trim()
        : null
  const ready = destination !== null && text.trim() !== '' && !busy && (sms ? canSms : canEmail)

  async function send() {
    if (!ready || destination === null) return
    setBusy(true)
    setError(null)
    try {
      const conversation = await api.startConversation({
        channel,
        body: text.trim(),
        ...(contact ? { contactId: contact.id } : {}),
        ...(sms ? { phone: destination } : { email: destination }),
        ...(!contact && name.trim() ? { name: name.trim() } : {}),
        ...(sms && numberId ? { numberId } : {}),
        ...(!sms && !contact && siteId ? { siteId } : {}),
      })
      hide()
      const inbox = useInbox.getState()
      await inbox.reload()
      inbox.open(conversation.id)
    } catch (failure) {
      setError(messageFor(failure instanceof ApiFailure ? failure.code : 'UNREACHABLE'))
    } finally {
      setBusy(false)
    }
  }

  const nothing = options !== null && !canSms && !canEmail

  return (
    <Dialog open={open} onOpenChange={(next) => !next && hide()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{$t('Nouveau message')}</DialogTitle>
          <DialogDescription>
            {sms
              ? rcs
                ? $t(
                    'Écrivez le premier au client, en RCS si son téléphone le lit, en SMS sinon. Sa réponse arrive ici, dans la conversation.',
                  )
                : $t(
                    'Écrivez le premier au client, par SMS. Sa réponse arrive ici, dans la conversation.',
                  )
              : viaMailbox
                ? $t(
                    'Écrivez le premier au client, par e-mail, depuis l’adresse du site. Sa réponse arrive ici, dans la conversation.',
                  )
                : $t(
                    'Écrivez le premier au client, par e-mail. Il répond en revenant sur le site : le widget lui montre la conversation.',
                  )}
          </DialogDescription>
        </DialogHeader>

        {nothing ? (
          <p className="rounded-lg border border-dashed px-3 py-3 text-sm text-muted-foreground">
            {$t(
              'Aucun moyen d’écrire au client pour l’instant : un superviseur ajoute un numéro dans « Numéros SMS » ou une adresse dans « Adresses e-mail », ou le serveur se voit donner un serveur d’e-mail (CHAT_SMTP_URL).',
            )}
          </p>
        ) : (
          <form
            className="grid min-w-0 gap-4"
            onSubmit={(event) => {
              event.preventDefault()
              void send()
            }}
          >
            <Segmented
              aria-label={$t('Canal')}
              value={channel}
              onValueChange={(next) => setChannel(next)}
              className="w-full"
              options={[
                {
                  value: 'sms',
                  label: (
                    <span className="inline-flex items-center gap-1.5">
                      <Smartphone className="size-3.5" />
                      {rcs ? $t('SMS / RCS') : $t('SMS')}
                    </span>
                  ),
                },
                {
                  value: 'email',
                  label: (
                    <span className="inline-flex items-center gap-1.5">
                      <Mail className="size-3.5" />
                      {$t('E-mail')}
                    </span>
                  ),
                },
              ]}
            />
            {sms && !canSms && (
              <p className="text-xs text-amber-700 dark:text-amber-400">
                {$t(
                  'Aucun numéro SMS n’est prêt : un superviseur en ajoute un dans « Numéros SMS ».',
                )}
              </p>
            )}
            {!sms && !canEmail && (
              <p className="text-xs text-amber-700 dark:text-amber-400">
                {options?.email
                  ? $t(
                      'Aucun site n’écrit d’e-mails à ses clients : « Répondre par e-mail » est désactivé.',
                    )
                  : $t(
                      'Aucun site n’a d’adresse dans « Adresses e-mail », et le serveur n’a pas de serveur SMTP (CHAT_SMTP_URL).',
                    )}
              </p>
            )}

            <Row label={$t('Destinataire')}>
              {(id) =>
                contact ? (
                  <div className="flex items-center gap-2 rounded-md border bg-muted/40 py-1.5 pr-1.5 pl-2">
                    <ContactAvatar name={contact.name} className="size-6 text-[10px]" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{contact.name}</span>
                      <span className="block truncate text-[11px] text-muted-foreground">
                        {[contact.phone, contact.email, contact.site].filter(Boolean).join(' · ')}
                      </span>
                    </span>
                    <Button
                      id={id}
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-7"
                      aria-label={$t('Choisir un autre destinataire')}
                      onClick={() => setContact(null)}
                    >
                      <X className="size-3.5" />
                    </Button>
                  </div>
                ) : (
                  <div className="grid gap-1">
                    <Input
                      id={id}
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      placeholder={
                        sms
                          ? $t('Un nom, ou un numéro : +33 6 12 34 56 78')
                          : $t('Un nom, ou une adresse : lea@exemple.fr')
                      }
                      autoComplete="off"
                      autoFocus
                    />
                    {found.length > 0 && (
                      <ul className="overflow-hidden rounded-md border">
                        {found.map((row) => (
                          <li key={row.id}>
                            <button
                              type="button"
                              onClick={() => setContact(row)}
                              className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-xs hover:bg-accent"
                            >
                              <ContactAvatar name={row.name} className="size-6 text-[10px]" />
                              <span className="min-w-0 flex-1 truncate font-medium">
                                {row.name}
                              </span>
                              <span className="truncate text-muted-foreground">
                                {sms
                                  ? (row.phone ?? $t('sans numéro'))
                                  : (row.email ?? $t('sans adresse'))}
                              </span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )
              }
            </Row>

            {contact && (sms ? !contact.phone : !contact.email) && (
              <Row label={sms ? $t('Son numéro') : $t('Son adresse e-mail')}>
                {(id) => (
                  <Input
                    id={id}
                    value={address}
                    onChange={(event) => setAddress(event.target.value)}
                    placeholder={sms ? '+33 6 12 34 56 78' : 'lea@exemple.fr'}
                    inputMode={sms ? 'tel' : 'email'}
                  />
                )}
              </Row>
            )}

            {!contact && (
              <Row label={$t('Son nom (facultatif)')}>
                {(id) => (
                  <Input
                    id={id}
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    maxLength={120}
                    placeholder={$t('Léa Martin')}
                  />
                )}
              </Row>
            )}

            {sms && (options?.numbers.length ?? 0) > 1 && (
              <Row label={$t('Depuis')}>
                {(id) => (
                  <ChoiceMenu
                    id={id}
                    value={numberId}
                    choices={(options?.numbers ?? []).map((n) => ({
                      id: n.id,
                      label: [n.name, n.phone, n.rcs ? 'RCS' : null].filter(Boolean).join(' · '),
                    }))}
                    onChange={setNumberId}
                    allowNone={false}
                    disabled={busy}
                  />
                )}
              </Row>
            )}

            {!sms && !contact && emailSites.length > 1 && (
              <Row label={$t('Pour le site')}>
                {(id) => (
                  <ChoiceMenu
                    id={id}
                    value={siteId}
                    choices={emailSites.map((s) => ({ id: s.id, label: s.name }))}
                    onChange={setSiteId}
                    allowNone={false}
                    disabled={busy}
                  />
                )}
              </Row>
            )}

            <Row label={$t('Message')}>
              {(id) => (
                <div className="grid gap-1">
                  <Textarea
                    id={id}
                    rows={5}
                    value={text}
                    onChange={(event) => setText(event.target.value)}
                    maxLength={4000}
                    placeholder={$t('Bonjour, …')}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) void send()
                    }}
                  />
                  {sms && text.length > 0 && (
                    <span className="text-right text-[11px] text-muted-foreground tabular-nums">
                      {$tp(text.length, '{count} caractère', '{count} caractères')} ·{' '}
                      {$tp(smsCount(text), '{count} SMS', '{count} SMS')}
                    </span>
                  )}
                </div>
              )}
            </Row>

            {error && <p className="animate-shake text-sm text-destructive">{error}</p>}

            <DialogFooter>
              <Button type="button" variant="ghost" onClick={hide}>
                {$t('Annuler')}
              </Button>
              <Button type="submit" disabled={!ready} className="gap-1.5">
                {busy ? (
                  <LoaderCircle className="size-3.5 animate-spin" />
                ) : (
                  <Send className="size-3.5" />
                )}
                {sms
                  ? rcs
                    ? $t('Envoyer le message')
                    : $t('Envoyer le SMS')
                  : $t('Envoyer l’e-mail')}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
