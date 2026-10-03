'use client'

import { Chip } from '@/components/app/chip'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { api } from '@/lib/api'
import { $t } from '@/lib/i18n'
import type { EmailAddressTest } from '@chat/contracts'
import { Check, CircleAlert, Loader2, Mail, PlugZap, Sparkles } from 'lucide-react'
import { useState } from 'react'
import { ChoiceMenu } from '../field-input'
import { Field, FormSection, ToggleField } from '../kit/controls'
import { type SettingsData, type Values, bool, one, text, useSettingsData } from '../kit/data'
import { NEW, useRowEditor } from '../kit/editor'
import { PreviewCard, Studio } from '../kit/studio'
import { EnvField } from './tools'

/**
 * « Adresses e-mail » (D24): a site's own mailbox. The messagerie reads it over IMAP —
 * what comes in opens or continues a conversation — and answers through its SMTP server,
 * so the customer's replies come back to it. The password stays in the server's
 * environment: the row names the variable only (D5).
 */

const PASSWORD = "Mot de passe (variable d'environnement)"
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const SERVER = /^[a-z0-9.-]+(:\d{1,5})?$/i

/** What an address still lacks to work, as the server will read it. */
function missing(values: Values): string[] {
  const lacks: string[] = []
  if (!EMAIL.test(text(values.Adresse))) lacks.push($t('l’adresse e-mail'))
  if (bool(values['Lire la boîte']) && !SERVER.test(text(values['Serveur IMAP']))) {
    lacks.push($t('le serveur IMAP'))
  }
  if (!SERVER.test(text(values['Serveur SMTP']))) lacks.push($t('le serveur SMTP'))
  if (!text(values[PASSWORD])) lacks.push($t('la variable d’environnement du mot de passe'))
  return lacks
}

export function EmailAddressesScreen() {
  const data = useSettingsData(['adresses_email', 'sites'])
  const editor = useRowEditor(data, 'adresses_email', {
    defaults: { 'Lire la boîte': true, Actif: true },
  })

  return (
    <Studio
      base="/parametrage/email"
      section={$t('Adresses e-mail')}
      data={data}
      editor={editor}
      nouns={{ fresh: $t('Nouvelle adresse'), remove: $t('Supprimer l’adresse') }}
      empty={{
        title: $t('Aucune adresse'),
        text: $t(
          'Une adresse où vos clients écrivent par e-mail : la messagerie lit sa boîte, ce qui arrive devient une conversation, et les réponses partent de cette adresse.',
        ),
      }}
      used={[
        'Nom',
        'Adresse',
        'Serveur IMAP',
        'Serveur SMTP',
        'Identifiant',
        PASSWORD,
        'Lire la boîte',
        'Site',
      ]}
      searchOf={(values) => `${text(values.Nom)} ${text(values.Adresse)}`}
      item={(_row, values) => (
        <>
          <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-indigo-500/10">
            <Mail className="size-3.5 text-indigo-700 dark:text-indigo-400" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-medium">
              {text(values.Nom) || $t('Nouvelle adresse')}
            </span>
            <span className="block truncate font-mono text-[11px] text-muted-foreground">
              {text(values.Adresse) || '—'}
              {bool(values['Lire la boîte']) ? '' : ` · ${$t('envoi seul')}`}
            </span>
          </span>
        </>
      )}
      form={(values) => (
        <>
          <FormSection title={$t('L’adresse')}>
            <Field label={$t('Nom')} required>
              {(id) => (
                <Input
                  id={id}
                  value={text(values.Nom)}
                  onChange={(e) => editor.set('Nom', e.target.value)}
                  maxLength={80}
                  placeholder={$t('Service client — e-mail')}
                />
              )}
            </Field>
            <Field
              label={$t('Adresse')}
              hint={$t('Où les clients écrivent, et d’où partent les réponses.')}
              warn={text(values.Adresse) !== '' && !EMAIL.test(text(values.Adresse))}
            >
              {(id) => (
                <Input
                  id={id}
                  value={text(values.Adresse)}
                  onChange={(e) => editor.set('Adresse', e.target.value.trim())}
                  placeholder="support@exemple.fr"
                  type="email"
                  className="font-mono text-xs"
                />
              )}
            </Field>
            <Field
              label={$t('Site')}
              hint={$t(
                'Ses conversations sont celles de ce site : sa boîte de réception, son équipe, son agent IA, sa langue. Les réponses du site par e-mail partent de cette adresse. Aucun : le premier site actif.',
              )}
            >
              {(id) => (
                <ChoiceMenu
                  id={id}
                  value={one(values.Site)}
                  choices={data.rows('sites').map((s) => ({ id: s.id, label: text(s.values.Nom) }))}
                  onChange={(v) => editor.set('Site', v)}
                  allowNone
                  disabled={!data.canEdit}
                />
              )}
            </Field>
          </FormSection>
          <FormSection
            title={$t('Les serveurs')}
            hint={$t(
              'Le mot de passe reste dans l’environnement du serveur : la messagerie n’en garde que le nom.',
            )}
          >
            <Field
              label={$t('Serveur SMTP')}
              hint={$t('Par où partent les réponses : port 465 en TLS, 587 en STARTTLS.')}
              warn={
                text(values['Serveur SMTP']) !== '' && !SERVER.test(text(values['Serveur SMTP']))
              }
            >
              {(id) => (
                <Input
                  id={id}
                  value={text(values['Serveur SMTP'])}
                  onChange={(e) => editor.set('Serveur SMTP', e.target.value.trim())}
                  placeholder="smtp.exemple.fr:465"
                  className="font-mono text-xs"
                />
              )}
            </Field>
            <Field
              label={$t('Identifiant')}
              hint={$t('Le compte des deux serveurs. Vide : l’adresse.')}
            >
              {(id) => (
                <Input
                  id={id}
                  value={text(values.Identifiant)}
                  onChange={(e) => editor.set('Identifiant', e.target.value.trim())}
                  placeholder={text(values.Adresse) || 'support@exemple.fr'}
                  className="font-mono text-xs"
                />
              )}
            </Field>
            <Field
              label={$t('Mot de passe (variable d’environnement)')}
              hint={$t(
                'Le NOM de la variable du serveur qui contient le mot de passe, ou le mot de passe d’application — jamais le mot de passe lui-même.',
              )}
            >
              {(id) => (
                <EnvField
                  id={id}
                  value={text(values[PASSWORD])}
                  onChange={(v) => editor.set(PASSWORD, v)}
                />
              )}
            </Field>
            <ToggleField
              label={$t('Lire la boîte')}
              hint={$t(
                'La messagerie relève la boîte chaque minute : ce qui arrive devient une conversation, ou continue celle à laquelle il répond. Sans elle, l’adresse ne sert qu’à envoyer.',
              )}
              checked={bool(values['Lire la boîte'])}
              onChange={(v) => editor.set('Lire la boîte', v)}
              disabled={!data.canEdit}
            >
              <Field
                label={$t('Serveur IMAP')}
                hint={$t('Où lire ce qui arrive, en TLS : port 993 si rien n’est dit.')}
                warn={
                  text(values['Serveur IMAP']) !== '' && !SERVER.test(text(values['Serveur IMAP']))
                }
              >
                {(id) => (
                  <Input
                    id={id}
                    value={text(values['Serveur IMAP'])}
                    onChange={(e) => editor.set('Serveur IMAP', e.target.value.trim())}
                    placeholder="imap.exemple.fr"
                    className="font-mono text-xs"
                  />
                )}
              </Field>
            </ToggleField>
          </FormSection>
        </>
      )}
      preview={(values) => (
        <EmailPreview
          // A new row, or a changed one, forgets what the last test said.
          key={editor.selectedId === NEW || editor.dirty ? 'draft' : editor.selectedId}
          data={data}
          values={values}
          id={editor.selectedId === NEW || editor.dirty ? null : editor.selectedId}
        />
      )}
    />
  )
}

/** What the server answered for one of the two servers, in words. */
function said(code: string): string {
  switch (code) {
    case 'ok':
      return $t('répond, et accepte le compte')
    case 'ADDRESS_UNAVAILABLE':
      return $t('l’adresse est désactivée, ou vide')
    case 'PASSWORD_MISSING':
      return $t('le serveur de la messagerie n’a pas la variable du mot de passe')
    case 'IMAP_MISSING':
    case 'SMTP_MISSING':
      return $t('aucun serveur donné')
    case 'IMAP_AUTH':
    case 'SMTP_535':
    case 'SMTP_EAUTH':
      return $t('refuse l’identifiant ou le mot de passe')
    case 'IMAP_ENOTFOUND':
    case 'SMTP_EDNS':
      return $t('introuvable : vérifiez le nom du serveur')
    case 'IMAP_ETIMEDOUT':
    case 'SMTP_ETIMEDOUT':
    case 'IMAP_ECONNREFUSED':
    case 'SMTP_ECONNECTION':
    case 'SMTP_ESOCKET':
      return $t('injoignable : vérifiez le serveur et son port')
    default:
      return $t('ne répond pas comme prévu ({code})', { code })
  }
}

function EmailPreview({
  data,
  values,
  id,
}: {
  readonly data: SettingsData
  readonly values: Values
  /** The row's id, once saved and unchanged: the test reads what is saved. */
  readonly id: string | null
}) {
  const lacks = missing(values)
  const reads = bool(values['Lire la boîte'])
  const site = data.rows('sites').find((s) => s.id === one(values.Site))
  const siteName = text(site?.values.Nom) || $t('le premier site actif')
  const [test, setTest] = useState<EmailAddressTest | 'trying' | 'failed' | null>(null)
  const tryIt = () => {
    if (!id) return
    setTest('trying')
    api
      .testEmailAddress(id)
      .then(setTest)
      .catch(() => setTest('failed'))
  }

  return (
    <>
      <PreviewCard label={$t('La connexion')} hint={text(values.Adresse) || undefined}>
        <div className="space-y-3 p-5 text-xs">
          {lacks.length > 0 ? (
            <div className="flex items-start gap-2 rounded-lg bg-amber-500/10 px-3 py-2 text-amber-800 dark:text-amber-300">
              <CircleAlert className="mt-px size-3.5 shrink-0" />
              <span>{$t('Il manque : {what}.', { what: lacks.join(', ') })}</span>
            </div>
          ) : (
            <p className="text-muted-foreground">
              {bool(values.Actif)
                ? reads
                  ? $t(
                      'La boîte est relevée chaque minute, si le serveur a la variable du mot de passe.',
                    )
                  : $t('Les réponses partent de cette adresse ; la boîte n’est pas lue.')
                : $t('Complète, mais désactivée : la boîte n’est ni lue, ni utilisée.')}
            </p>
          )}
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={tryIt}
              disabled={!id || test === 'trying' || !data.canEdit}
            >
              {test === 'trying' ? <Loader2 className="animate-spin" /> : <PlugZap />}
              {$t('Essayer la connexion')}
            </Button>
            {!id && (
              <span className="text-muted-foreground">{$t('Enregistrez d’abord l’adresse.')}</span>
            )}
          </div>
          {test === 'failed' && (
            <p className="text-destructive">{$t('Le serveur de la messagerie n’a pas répondu.')}</p>
          )}
          {test && typeof test === 'object' && (
            <ul className="space-y-1.5">
              {(reads ? (['imap', 'smtp'] as const) : (['smtp'] as const)).map((side) => (
                <li key={side} className="flex items-start gap-2">
                  {test[side] === 'ok' ? (
                    <Check className="mt-px size-3.5 shrink-0 text-emerald-700 dark:text-emerald-400" />
                  ) : (
                    <CircleAlert className="mt-px size-3.5 shrink-0 text-amber-700 dark:text-amber-400" />
                  )}
                  <span>
                    <span className="font-medium">{side === 'imap' ? 'IMAP' : 'SMTP'}</span>
                    {' — '}
                    {said(test[side])}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </PreviewCard>

      <PreviewCard label={$t('Dans la boîte du client')}>
        <div className="space-y-3 bg-muted/30 p-5 text-xs">
          <div className="flex items-center justify-center">
            <Chip tint="sky">
              <Mail />
              {$t('E-mail')}
            </Chip>
          </div>
          <div className="rounded-lg border bg-background">
            <div className="space-y-0.5 border-b px-3.5 py-2.5">
              <p className="truncate">
                <span className="text-muted-foreground">{$t('De')} </span>
                {siteName} &lt;{text(values.Adresse) || 'support@exemple.fr'}&gt;
              </p>
              <p className="truncate font-medium">{$t('Re : Mon dossier')}</p>
            </div>
            <div className="flex items-start gap-2 px-3.5 py-3">
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-violet-500/15">
                <Sparkles className="size-3 text-violet-700 dark:text-violet-300" />
              </span>
              <p className="text-sm leading-relaxed">
                {$t(
                  'Bonjour ! Votre dossier est complet : le virement part sous 48 heures. Répondez simplement à cet e-mail pour la suite.',
                )}
              </p>
            </div>
          </div>
          <p className="text-center text-[11px] text-muted-foreground">
            {$t('Sa réponse revient dans la même conversation de « {site} ».', { site: siteName })}
          </p>
        </div>
      </PreviewCard>
    </>
  )
}
