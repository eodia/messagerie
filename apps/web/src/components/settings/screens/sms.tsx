'use client'

import { Chip } from '@/components/app/chip'
import { CopyButton } from '@/components/app/copy-button'
import { Input } from '@/components/ui/input'
import { api } from '@/lib/api'
import { $t } from '@/lib/i18n'
import { Check, CircleAlert, MessageSquare, Smartphone, Sparkles } from 'lucide-react'
import { useEffect, useState } from 'react'
import { ChoiceMenu } from '../field-input'
import { CardChoice, Field, FormSection, ToggleField } from '../kit/controls'
import { type SettingsData, type Values, bool, one, text, useSettingsData } from '../kit/data'
import { NEW, useRowEditor } from '../kit/editor'
import { PreviewCard, Studio } from '../kit/studio'
import { EnvField } from './tools'

/**
 * « Numéros SMS » (D23): the phone numbers visitors write to by SMS or RCS — through Twilio,
 * by RCS with a messaging service that has an RCS sender, or through SMS Mode, by RCS with
 * the account's RCS agent. The
 * preview says what to paste at the provider — the server gives the address —, what is
 * still missing, and plays a message coming in on a phone.
 */

const TWILIO = 'Twilio'
const SMSMODE = 'SMS Mode'
const providerOf = (values: Values) => (text(values.Fournisseur) === SMSMODE ? SMSMODE : TWILIO)
/** Whether the number writes by RCS to the phones that read it. */
const writesRcs = (values: Values) =>
  providerOf(values) === TWILIO
    ? text(values['Service de messagerie']) !== ''
    : bool(values['Envoyer en RCS'])

const PHONE = /^\+[1-9]\d{6,14}$/
const compact = (value: string) => value.replace(/[\s.()-]/g, '')

/** What a number still lacks to work, as the server will read it. */
function missing(values: Values): string[] {
  const lacks: string[] = []
  if (!PHONE.test(compact(text(values.Numéro)))) {
    lacks.push($t('un numéro au format international (+33…)'))
  }
  if (
    providerOf(values) === TWILIO &&
    !/^AC[0-9a-f]{32}$/i.test(text(values['Identifiant du compte']))
  ) {
    lacks.push($t('l’identifiant du compte Twilio (AC…)'))
  }
  if (!text(values["Jeton (variable d'environnement)"])) {
    lacks.push($t('la variable d’environnement du secret'))
  }
  return lacks
}

export function SmsNumbersScreen() {
  const data = useSettingsData(['numeros_sms', 'sites'])
  const editor = useRowEditor(data, 'numeros_sms', {
    defaults: { Fournisseur: TWILIO, Actif: true },
  })

  return (
    <Studio
      base="/parametrage/sms"
      section={$t('Numéros SMS')}
      data={data}
      editor={editor}
      nouns={{ fresh: $t('Nouveau numéro'), remove: $t('Supprimer le numéro') }}
      empty={{
        title: $t('Aucun numéro'),
        text: $t(
          'Un numéro Twilio ou SMS Mode où vos clients écrivent par SMS ou par RCS : leurs messages arrivent dans l’inbox, l’IA et les conseillers y répondent, et les réponses repartent sur leur téléphone.',
        ),
      }}
      used={[
        'Nom',
        'Numéro',
        'Fournisseur',
        'Identifiant du compte',
        "Jeton (variable d'environnement)",
        'Service de messagerie',
        'Expéditeur',
        'Envoyer en RCS',
        'Site',
      ]}
      searchOf={(values) => `${text(values.Nom)} ${text(values.Numéro)}`}
      item={(_row, values) => (
        <>
          <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-orange-500/10">
            <Smartphone className="size-3.5 text-orange-700 dark:text-orange-400" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-medium">
              {text(values.Nom) || $t('Nouveau numéro')}
            </span>
            <span className="block truncate font-mono text-[11px] text-muted-foreground">
              {text(values.Numéro) || '—'} · {providerOf(values)}
              {writesRcs(values) ? ' · RCS' : ''}
            </span>
          </span>
        </>
      )}
      form={(values) => (
        <>
          <FormSection title={$t('Le numéro')}>
            <Field label={$t('Nom')} required>
              {(id) => (
                <Input
                  id={id}
                  value={text(values.Nom)}
                  onChange={(e) => editor.set('Nom', e.target.value)}
                  maxLength={80}
                  placeholder={$t('Service client — SMS')}
                />
              )}
            </Field>
            <Field
              label={$t('Numéro')}
              hint={$t('Le numéro où l’on écrit, chez le fournisseur, au format international.')}
              warn={text(values.Numéro) !== '' && !PHONE.test(compact(text(values.Numéro)))}
            >
              {(id) => (
                <Input
                  id={id}
                  value={text(values.Numéro)}
                  onChange={(e) => editor.set('Numéro', e.target.value)}
                  placeholder="+33 7 00 00 00 00"
                  inputMode="tel"
                  className="font-mono text-xs"
                />
              )}
            </Field>
            <Field
              label={$t('Site')}
              hint={$t(
                'Ses conversations sont celles de ce site : sa boîte de réception, son équipe, son agent IA, sa langue. Aucun : le premier site actif.',
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
            title={$t('Le fournisseur')}
            hint={$t(
              'Son secret reste dans l’environnement du serveur : la messagerie n’en garde que le nom.',
            )}
          >
            <CardChoice
              value={providerOf(values)}
              onChange={(provider) => editor.set('Fournisseur', provider)}
              disabled={!data.canEdit}
              options={[
                {
                  value: TWILIO,
                  label: 'Twilio',
                  hint: $t('SMS et MMS, et RCS avec un service de messagerie.'),
                  icon: <MessageSquare />,
                },
                {
                  value: SMSMODE,
                  label: 'SMS Mode',
                  hint: $t('SMS, et RCS avec un agent RCS validé chez SMS Mode.'),
                  icon: <Smartphone />,
                },
              ]}
            />
            {providerOf(values) === TWILIO && (
              <Field
                label={$t('Identifiant du compte')}
                hint={$t('Account SID, dans la console Twilio.')}
              >
                {(id) => (
                  <Input
                    id={id}
                    value={text(values['Identifiant du compte'])}
                    onChange={(e) => editor.set('Identifiant du compte', e.target.value.trim())}
                    placeholder="AC…"
                    className="font-mono text-xs"
                    maxLength={34}
                  />
                )}
              </Field>
            )}
            <Field
              label={$t('Secret (variable d’environnement)')}
              hint={
                providerOf(values) === TWILIO
                  ? $t(
                      'Le NOM de la variable du serveur qui contient l’Auth Token du compte — jamais le jeton lui-même.',
                    )
                  : $t(
                      'Le NOM de la variable du serveur qui contient la clé d’API SMS Mode — jamais la clé elle-même.',
                    )
              }
            >
              {(id) => (
                <EnvField
                  id={id}
                  value={text(values["Jeton (variable d'environnement)"])}
                  onChange={(v) => editor.set("Jeton (variable d'environnement)", v)}
                />
              )}
            </Field>
            {providerOf(values) === TWILIO ? (
              <Field
                label={$t('Service de messagerie')}
                hint={$t(
                  'Facultatif (MG…). Avec un expéditeur RCS, les réponses partent en RCS — avec images et fichiers — vers les téléphones qui le lisent, en SMS vers les autres.',
                )}
              >
                {(id) => (
                  <Input
                    id={id}
                    value={text(values['Service de messagerie'])}
                    onChange={(e) => editor.set('Service de messagerie', e.target.value.trim())}
                    placeholder="MG…"
                    className="font-mono text-xs"
                    maxLength={34}
                  />
                )}
              </Field>
            ) : (
              <Field
                label={$t('Expéditeur')}
                hint={$t(
                  'Facultatif : le nom affiché à la place du numéro, 11 caractères au plus. Un client ne peut pas répondre à un nom : vide, les messages partent du numéro.',
                )}
              >
                {(id) => (
                  <Input
                    id={id}
                    value={text(values.Expéditeur)}
                    onChange={(e) => editor.set('Expéditeur', e.target.value)}
                    placeholder="ACME"
                    maxLength={11}
                  />
                )}
              </Field>
            )}
            {providerOf(values) === SMSMODE && (
              <ToggleField
                label={$t('Envoyer en RCS')}
                hint={$t(
                  'Les messages partent en RCS, par l’agent RCS du compte — avec son nom, son logo, les accusés de lecture —, vers les téléphones qui le lisent. Quand SMS Mode refuse le RCS, le même message part aussitôt en SMS.',
                )}
                checked={bool(values['Envoyer en RCS'])}
                onChange={(v) => editor.set('Envoyer en RCS', v)}
                disabled={!data.canEdit}
              />
            )}
          </FormSection>
        </>
      )}
      preview={(values) => (
        <SmsPreview
          data={data}
          values={values}
          id={editor.selectedId === NEW ? null : editor.selectedId}
        />
      )}
    />
  )
}

function SmsPreview({
  data,
  values,
  id,
}: {
  readonly data: SettingsData
  readonly values: Values
  /** The row's id, once saved: Twilio's address carries it. */
  readonly id: string | null
}) {
  const lacks = missing(values)
  const provider = providerOf(values)
  const rcs = writesRcs(values)
  const site = data.rows('sites').find((s) => s.id === one(values.Site))
  const [address, setAddress] = useState<string | null>(null)
  // The server says the address — SMS Mode's carries a key only it can draw —, for the
  // provider saved: a provider changed in the draft waits for « Enregistrer ».
  const saved = providerOf(data.rows('numeros_sms').find((r) => r.id === id)?.values ?? {})
  useEffect(() => {
    setAddress(null)
    if (!id || !saved) return
    let live = true
    void api
      .smsAddresses(id)
      .then((addresses) => live && setAddress(addresses.inbound))
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [id, saved])

  return (
    <>
      <PreviewCard
        label={provider === TWILIO ? $t('Dans Twilio') : $t('Dans SMS Mode')}
        hint={text(values.Numéro) || undefined}
      >
        <div className="space-y-3 p-5 text-xs">
          <p className="text-muted-foreground">
            {provider === SMSMODE
              ? $t(
                  'Chaque réponse donne cette adresse à SMS Mode, pour ce que le client répond. Donnez-la aussi comme URL de réception des réponses (MO) dans l’espace SMS Mode, pour un client qui écrit le premier.',
                )
              : rcs
                ? $t(
                    'Dans le service de messagerie, « Integration » : envoyez les messages entrants à cette adresse (HTTP POST).',
                  )
                : $t(
                    'Dans la configuration du numéro, « A message comes in » : Webhook, HTTP POST, à cette adresse.',
                  )}
          </p>
          {address && saved === provider ? (
            <div className="flex items-center gap-2 rounded-lg border bg-muted/40 py-2 pr-2 pl-3">
              <code className="min-w-0 flex-1 truncate font-mono text-xs">{address}</code>
              <CopyButton text={address} label={$t('Copier l’adresse')}>
                {$t('Copier')}
              </CopyButton>
            </div>
          ) : (
            <p className="rounded-lg border border-dashed px-3 py-2 text-muted-foreground">
              {$t('L’adresse paraît ici une fois le numéro enregistré, avec son fournisseur.')}
            </p>
          )}
          <p className="text-muted-foreground">
            {provider === TWILIO
              ? $t(
                  'Elle doit joindre le serveur de la messagerie depuis Internet (CHAT_PUBLIC_URL) : Twilio signe chaque appel avec le jeton du compte, et la messagerie refuse les autres.',
                )
              : $t(
                  'Elle doit joindre le serveur de la messagerie depuis Internet (CHAT_PUBLIC_URL). Gardez-la pour vous : sa clé est ce qui distingue SMS Mode d’un inconnu.',
                )}
          </p>
          {lacks.length > 0 ? (
            <div className="flex items-start gap-2 rounded-lg bg-amber-500/10 px-3 py-2 text-amber-800 dark:text-amber-300">
              <CircleAlert className="mt-px size-3.5 shrink-0" />
              <span>{$t('Il manque : {what}.', { what: lacks.join(', ') })}</span>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-400">
              <Check className="size-3.5" />
              {bool(values.Actif)
                ? $t('Prêt à recevoir, si le serveur a la variable du secret.')
                : $t('Complet, mais désactivé : les messages sont refusés.')}
            </div>
          )}
        </div>
      </PreviewCard>

      <PreviewCard label={$t('Sur le téléphone du client')}>
        <div className="space-y-3 bg-muted/30 p-5">
          <div className="flex items-center justify-center gap-2">
            <Chip tint={rcs ? 'violet' : 'zinc'}>
              <MessageSquare />
              {rcs ? $t('RCS, SMS sinon') : $t('SMS')}
            </Chip>
          </div>
          <div className="flex justify-end">
            <p className="max-w-[80%] rounded-2xl rounded-br-md bg-foreground px-3.5 py-2.5 text-sm text-background">
              {$t('Bonjour, où en est mon dossier ?')}
            </p>
          </div>
          <div className="flex items-end gap-2">
            <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-violet-500/15">
              <Sparkles className="size-3.5 text-violet-700 dark:text-violet-300" />
            </span>
            <p className="max-w-[80%] rounded-2xl rounded-bl-md border bg-background px-3.5 py-2.5 text-sm leading-relaxed">
              {$t(
                'Bonjour ! Votre dossier est complet : le virement part sous 48 heures. Autre chose ?',
              )}
            </p>
          </div>
          <p className="text-center text-[11px] text-muted-foreground">
            {$t('Arrive dans « {site} », comme une conversation du widget.', {
              site: text(site?.values.Nom) || $t('le premier site actif'),
            })}
          </p>
        </div>
      </PreviewCard>
    </>
  )
}
