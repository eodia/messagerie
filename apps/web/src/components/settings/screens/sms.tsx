'use client'

import { Chip } from '@/components/app/chip'
import { CopyButton } from '@/components/app/copy-button'
import { Input } from '@/components/ui/input'
import { apiAddress } from '@/lib/api'
import { $t } from '@/lib/i18n'
import { Check, CircleAlert, MessageSquare, Smartphone, Sparkles } from 'lucide-react'
import { ChoiceMenu } from '../field-input'
import { Field, FormSection } from '../kit/controls'
import { type SettingsData, type Values, bool, one, text, useSettingsData } from '../kit/data'
import { NEW, useRowEditor } from '../kit/editor'
import { PreviewCard, Studio } from '../kit/studio'
import { EnvField } from './tools'

/**
 * « Numéros SMS » (D23): the phone numbers visitors write to by SMS — and by RCS, through
 * a Twilio messaging service with an RCS sender. The preview says what to paste in Twilio,
 * what is still missing, and plays a message coming in on a phone.
 */

const PHONE = /^\+[1-9]\d{6,14}$/
const compact = (value: string) => value.replace(/[\s.()-]/g, '')

/** What a number still lacks to work, as the server will read it. */
function missing(values: Values): string[] {
  const lacks: string[] = []
  if (!PHONE.test(compact(text(values.Numéro)))) {
    lacks.push($t('un numéro au format international (+33…)'))
  }
  if (!/^AC[0-9a-f]{32}$/i.test(text(values['Compte Twilio']))) {
    lacks.push($t('l’identifiant du compte Twilio (AC…)'))
  }
  if (!text(values["Jeton (variable d'environnement)"])) {
    lacks.push($t('la variable d’environnement du jeton'))
  }
  return lacks
}

export function SmsNumbersScreen() {
  const data = useSettingsData(['numeros_sms', 'sites'])
  const editor = useRowEditor(data, 'numeros_sms', {
    defaults: { Fournisseur: 'Twilio', Actif: true },
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
          'Un numéro Twilio où vos clients écrivent par SMS ou par RCS : leurs messages arrivent dans l’inbox, l’IA et les conseillers y répondent, et les réponses repartent sur leur téléphone.',
        ),
      }}
      used={[
        'Nom',
        'Numéro',
        'Fournisseur',
        'Compte Twilio',
        "Jeton (variable d'environnement)",
        'Service de messagerie',
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
              {text(values.Numéro) || '—'}
              {text(values['Service de messagerie']) ? ' · RCS' : ''}
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
              hint={$t('Le numéro Twilio où l’on écrit, au format international.')}
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
            title={$t('Le compte Twilio')}
            hint={$t(
              'Le jeton reste dans l’environnement du serveur : la messagerie n’en garde que le nom.',
            )}
          >
            <Field label={$t('Compte Twilio')} hint={$t('Account SID, dans la console Twilio.')}>
              {(id) => (
                <Input
                  id={id}
                  value={text(values['Compte Twilio'])}
                  onChange={(e) => editor.set('Compte Twilio', e.target.value.trim())}
                  placeholder="AC…"
                  className="font-mono text-xs"
                  maxLength={34}
                />
              )}
            </Field>
            <Field
              label={$t('Jeton (variable d’environnement)')}
              hint={$t(
                'Le NOM de la variable du serveur qui contient l’Auth Token du compte — jamais le jeton lui-même.',
              )}
            >
              {(id) => (
                <EnvField
                  id={id}
                  value={text(values["Jeton (variable d'environnement)"])}
                  onChange={(v) => editor.set("Jeton (variable d'environnement)", v)}
                />
              )}
            </Field>
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
  const rcs = text(values['Service de messagerie']) !== ''
  const site = data.rows('sites').find((s) => s.id === one(values.Site))
  const address = id ? `${apiAddress()}/channels/twilio/${id}` : null

  return (
    <>
      <PreviewCard label={$t('Dans Twilio')} hint={text(values.Numéro) || undefined}>
        <div className="space-y-3 p-5 text-xs">
          <p className="text-muted-foreground">
            {rcs
              ? $t(
                  'Dans le service de messagerie, « Integration » : envoyez les messages entrants à cette adresse (HTTP POST).',
                )
              : $t(
                  'Dans la configuration du numéro, « A message comes in » : Webhook, HTTP POST, à cette adresse.',
                )}
          </p>
          {address ? (
            <div className="flex items-center gap-2 rounded-lg border bg-muted/40 py-2 pr-2 pl-3">
              <code className="min-w-0 flex-1 truncate font-mono text-xs">{address}</code>
              <CopyButton text={address} label={$t('Copier l’adresse')}>
                {$t('Copier')}
              </CopyButton>
            </div>
          ) : (
            <p className="rounded-lg border border-dashed px-3 py-2 text-muted-foreground">
              {$t('L’adresse paraît ici une fois le numéro enregistré.')}
            </p>
          )}
          <p className="text-muted-foreground">
            {$t(
              'Elle doit joindre le serveur de la messagerie depuis Internet (CHAT_PUBLIC_URL) : Twilio signe chaque appel avec le jeton du compte, et la messagerie refuse les autres.',
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
                ? $t('Prêt à recevoir, si le serveur a la variable du jeton.')
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
