'use client'

import { Chip } from '@/components/app/chip'
import { ContactAvatar } from '@/components/inbox/labels'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { $t } from '@/lib/i18n'
import { ArrowRightLeft, MessageCircleOff, ShieldAlert, Sparkles } from 'lucide-react'
import { ChoiceMenu } from '../field-input'
import { CardChoice, Field, FormSection } from '../kit/controls'
import { type SettingsData, type Values, one, text, useSettingsData } from '../kit/data'
import { useRowEditor } from '../kit/editor'
import { PreviewCard, Studio } from '../kit/studio'

/**
 * Guardrails: the subjects the AI does not answer itself. The preview plays the moment — a
 * visitor raises the subject, the AI says what it was told to, and the conversation goes
 * to a team, or stays where it is.
 */

const TRANSFER = 'Transférer à un conseiller'
const ANSWER = 'Répondre sans traiter'

export function GuardrailsScreen() {
  const data = useSettingsData(['garde_fous', 'equipes'])
  const editor = useRowEditor(data, 'garde_fous', { defaults: { Action: TRANSFER } })

  return (
    <Studio
      section={$t('Garde-fous')}
      data={data}
      editor={editor}
      nouns={{ fresh: $t('Nouveau garde-fou'), remove: $t('Supprimer le garde-fou') }}
      empty={{
        title: $t('Aucun garde-fou'),
        text: $t(
          'Les sujets sur lesquels l’IA ne répond pas elle-même : un litige, une résiliation, une urgence…',
        ),
      }}
      used={['Nom', 'Sujet', 'Action', 'Message au visiteur', 'Équipe']}
      item={(_row, values) => (
        <>
          <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-amber-500/10">
            <ShieldAlert className="size-3.5 text-amber-700 dark:text-amber-400" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-medium">
              {text(values.Nom) || $t('Nouveau garde-fou')}
            </span>
            <span className="block truncate text-[11px] text-muted-foreground">
              {values.Action === ANSWER
                ? $t('Répond sans traiter')
                : $t('Transfère à un conseiller')}
            </span>
          </span>
        </>
      )}
      form={(values) => (
        <>
          <FormSection title={$t('Le sujet')}>
            <Field label={$t('Nom')} required>
              {(id) => (
                <Input
                  id={id}
                  value={text(values.Nom)}
                  onChange={(e) => editor.set('Nom', e.target.value)}
                  maxLength={60}
                  placeholder={$t('Litige et contentieux')}
                />
              )}
            </Field>
            <Field
              label={$t('Ce qui le déclenche')}
              hint={$t('Décrit à l’IA, avec des exemples : c’est ainsi qu’elle le reconnaît.')}
            >
              {(id) => (
                <Textarea
                  id={id}
                  rows={4}
                  value={text(values.Sujet)}
                  onChange={(e) => editor.set('Sujet', e.target.value)}
                  placeholder={$t(
                    'Le visiteur parle d’avocat, de procès, de médiateur ou de mise en demeure.',
                  )}
                />
              )}
            </Field>
          </FormSection>
          <FormSection title={$t('Ce que fait l’IA')}>
            <CardChoice
              value={values.Action === ANSWER ? ANSWER : TRANSFER}
              onChange={(action) => editor.set('Action', action)}
              disabled={!data.canEdit}
              options={[
                {
                  value: TRANSFER,
                  label: $t('Transférer'),
                  hint: $t('Elle prévient le visiteur et passe la main à une équipe.'),
                  icon: <ArrowRightLeft />,
                },
                {
                  value: ANSWER,
                  label: $t('Répondre sans traiter'),
                  hint: $t('Elle dit son message, sans traiter la demande.'),
                  icon: <MessageCircleOff />,
                },
              ]}
            />
            <Field
              label={$t('Message au visiteur')}
              hint={$t('Ce que l’IA dit quand le garde-fou se déclenche.')}
            >
              {(id) => (
                <Textarea
                  id={id}
                  rows={3}
                  value={text(values['Message au visiteur'])}
                  onChange={(e) => editor.set('Message au visiteur', e.target.value)}
                  placeholder={$t(
                    'Je transmets votre demande à un conseiller, qui vous répond au plus vite.',
                  )}
                />
              )}
            </Field>
            {values.Action !== ANSWER && (
              <Field label={$t('Vers l’équipe')} hint={$t('Aucune : l’équipe par défaut du site.')}>
                {(id) => (
                  <ChoiceMenu
                    id={id}
                    value={one(values.Équipe)}
                    choices={data
                      .rows('equipes')
                      .map((t) => ({ id: t.id, label: text(t.values.Nom) }))}
                    onChange={(v) => editor.set('Équipe', v)}
                    allowNone
                    disabled={!data.canEdit}
                  />
                )}
              </Field>
            )}
          </FormSection>
        </>
      )}
      preview={(values) => <GuardrailPreview data={data} values={values} />}
    />
  )
}

function GuardrailPreview({
  data,
  values,
}: { readonly data: SettingsData; readonly values: Values }) {
  const transfer = values.Action !== ANSWER
  const team = data.rows('equipes').find((t) => t.id === one(values.Équipe))
  const subject = text(values.Sujet)

  return (
    <>
      <PreviewCard label={$t('Le moment venu')} hint={text(values.Nom) || undefined}>
        <div className="space-y-4 bg-muted/30 p-5">
          <div className="flex justify-end">
            <p className="max-w-[80%] rounded-2xl rounded-br-md bg-foreground px-3.5 py-2.5 text-sm text-background">
              {$t('Je vais devoir saisir un avocat si rien ne bouge.')}
            </p>
          </div>
          <div className="flex justify-center">
            <span className="inline-flex max-w-[90%] items-center gap-1.5 rounded-full border bg-background px-3 py-1 text-[11px] text-muted-foreground">
              <ShieldAlert className="size-3.5 shrink-0 text-amber-600" />
              <span className="truncate">
                {$t('Garde-fou « {name} » reconnu', {
                  name: text(values.Nom) || $t('Nouveau garde-fou'),
                })}
              </span>
            </span>
          </div>
          <div className="flex items-end gap-2">
            <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-violet-500/15">
              <Sparkles className="size-3.5 text-violet-700 dark:text-violet-300" />
            </span>
            <p className="max-w-[80%] rounded-2xl rounded-bl-md border bg-background px-3.5 py-2.5 text-sm leading-relaxed">
              {text(values['Message au visiteur']) || (
                <span className="text-muted-foreground">{$t('Le message au visiteur.')}</span>
              )}
            </p>
          </div>
          {transfer && (
            <div className="flex items-center justify-center gap-2 pt-1">
              <span className="h-px flex-1 bg-border" />
              <Chip tint="amber">
                <ArrowRightLeft />
                {$t('Transférée à {team}', {
                  team: text(team?.values.Nom) || $t('l’équipe du site'),
                })}
              </Chip>
              <span className="h-px flex-1 bg-border" />
            </div>
          )}
          {transfer && (
            <div className="flex items-center gap-2 rounded-lg border border-dashed bg-background/60 px-3 py-2 text-xs text-muted-foreground">
              <ContactAvatar
                name={text(team?.values.Nom) || $t('Équipe')}
                className="size-6 text-[9px]"
              />
              {$t('Un conseiller reprend, avec le résumé de l’IA.')}
            </div>
          )}
        </div>
      </PreviewCard>

      <PreviewCard label={$t('Ce que lit l’IA')}>
        <div className="space-y-1.5 p-5 font-mono text-xs leading-relaxed">
          <p>
            <span className="text-muted-foreground">{$t('Si :')} </span>
            {subject || (
              <span className="text-amber-700 dark:text-amber-400">
                {$t('décrivez le sujet, sinon l’IA ne le reconnaîtra pas.')}
              </span>
            )}
          </p>
          <p>
            <span className="text-muted-foreground">{$t('Alors :')} </span>
            {transfer
              ? $t('dire le message, puis transférer — sans répondre sur le fond.')
              : $t('dire le message, sans traiter la demande.')}
          </p>
        </div>
      </PreviewCard>
    </>
  )
}
