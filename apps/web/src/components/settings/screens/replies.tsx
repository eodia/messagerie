'use client'

import { ColorBadge } from '@/components/app/chip'
import { MarkdownField } from '@/components/inbox/draft-editor'
import { ContactAvatar } from '@/components/inbox/labels'
import { RichText } from '@/components/inbox/rich-text'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { $t } from '@/lib/i18n'
import { plainOf } from '@/lib/rich-text'
import { useAddressTab } from '@/lib/use-address-tab'
import { cn } from '@/lib/utils'
import type { Editor } from '@tiptap/react'
import { MessageSquareText, Sparkles, Tag } from 'lucide-react'
import { useState } from 'react'
import { Toggles } from '../field-input'
import { ColorField, Field, FormSection, ToggleField } from '../kit/controls'
import { type SettingsData, type Values, bool, list, text, useSettingsData } from '../kit/data'
import { useRowEditor } from '../kit/editor'
import { PreviewCard, Studio, StudioTabs } from '../kit/studio'

/**
 * Canned replies and tags. A reply is typed after « / » in the composer, and may name the
 * contact; the preview shows the menu, then the message as the visitor gets it. A tag is
 * put on by an agent, or by the AI when told when — the preview puts it on a conversation.
 */

type Tab = 'replies' | 'tags'

/** Whom the preview writes to. */
const SAMPLE = { prénom: 'Léa', nom: 'Martin', email: 'lea.martin@exemple.fr' } as const
const VARIABLES = ['prénom', 'nom', 'email'] as const

const filled = (content: string) =>
  content.replace(/\{(prénom|nom|email)\}/g, (_, key: keyof typeof SAMPLE) => SAMPLE[key])

const shortcutOf = (raw: string) =>
  raw
    .toLowerCase()
    .replace(/^\/+/, '')
    .replace(/\s+/g, '-')
    .replace(/[^\p{L}\p{N}_-]/gu, '')

export function RepliesScreen() {
  const data = useSettingsData(['reponses_types', 'etiquettes', 'equipes'])
  const [tab, setTab, tabBase] = useAddressTab<Tab>('/parametrage/reponses', {
    replies: null,
    tags: 'etiquettes',
  })
  const replies = useRowEditor(data, 'reponses_types')
  const tags = useRowEditor(data, 'etiquettes', { defaults: { Couleur: '#2563EB' } })
  /** The content's field, to put a variable where the caret is. */
  const [content, setContent] = useState<Editor | null>(null)

  const tabs = (
    <StudioTabs
      value={tab}
      onChange={setTab}
      tabs={[
        {
          value: 'replies',
          label: $t('Réponses types'),
          count: data.rows('reponses_types').length,
        },
        { value: 'tags', label: $t('Étiquettes'), count: data.rows('etiquettes').length },
      ]}
    />
  )

  if (tab === 'tags') {
    return (
      <Studio
        base={tabBase}
        section={$t('Réponses types et étiquettes')}
        data={data}
        editor={tags}
        tabs={tabs}
        nouns={{ fresh: $t('Nouvelle étiquette'), remove: $t('Supprimer l’étiquette') }}
        empty={{
          title: $t('Aucune étiquette'),
          text: $t('Des étiquettes pour ranger les conversations : à la main, ou par l’IA.'),
        }}
        used={['Nom', 'Couleur', "Quand l'appliquer", "Posée par l'IA"]}
        item={(_row, values) => (
          <>
            <ColorBadge color={text(values.Couleur) || '#64748b'} className="min-w-0 truncate">
              {bool(values["Posée par l'IA"]) && <Sparkles />}
              <span className="truncate">{text(values.Nom) || $t('Nouvelle étiquette')}</span>
            </ColorBadge>
          </>
        )}
        form={(values) => (
          <>
            <FormSection title={$t('L’étiquette')}>
              <Field label={$t('Nom')} required>
                {(id) => (
                  <Input
                    id={id}
                    value={text(values.Nom)}
                    onChange={(e) => tags.set('Nom', e.target.value)}
                    maxLength={40}
                    placeholder={$t('Réclamation')}
                  />
                )}
              </Field>
              <Field label={$t('Couleur')}>
                {(id) => (
                  <ColorField
                    id={id}
                    value={text(values.Couleur)}
                    onChange={(c) => tags.set('Couleur', c)}
                  />
                )}
              </Field>
            </FormSection>
            <FormSection title={$t('Qui la pose')}>
              <ToggleField
                label={$t('L’IA peut la poser seule')}
                hint={$t('Sinon, seuls les conseillers la posent.')}
                checked={bool(values["Posée par l'IA"])}
                onChange={(on) => tags.set("Posée par l'IA", on)}
                disabled={!data.canEdit}
              />
              <Field
                label={$t('Quand l’appliquer')}
                hint={$t(
                  'Lu par l’IA pour étiqueter, et par les conseillers : décrivez les cas en une ou deux phrases.',
                )}
              >
                {(id) => (
                  <Textarea
                    id={id}
                    rows={3}
                    value={text(values["Quand l'appliquer"])}
                    onChange={(e) => tags.set("Quand l'appliquer", e.target.value)}
                    placeholder={$t(
                      'Le client exprime un mécontentement, ou demande un geste commercial.',
                    )}
                  />
                )}
              </Field>
            </FormSection>
          </>
        )}
        preview={(values) => <TagPreview data={data} values={values} id={tags.selectedId} />}
      />
    )
  }

  return (
    <Studio
      base={tabBase}
      section={$t('Réponses types et étiquettes')}
      data={data}
      editor={replies}
      tabs={tabs}
      nouns={{ fresh: $t('Nouvelle réponse'), remove: $t('Supprimer la réponse') }}
      empty={{
        title: $t('Aucune réponse type'),
        text: $t('Des réponses prêtes à l’emploi, que les conseillers insèrent en tapant « / ».'),
      }}
      used={['Titre', 'Raccourci', 'Contenu', 'Équipes']}
      searchOf={(values) =>
        `${text(values.Titre)} ${text(values.Raccourci)} ${text(values.Contenu)}`
      }
      item={(_row, values) => (
        <>
          <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-muted">
            <MessageSquareText className="size-3.5 text-muted-foreground" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-medium">
              {text(values.Titre) || $t('Nouvelle réponse')}
            </span>
            <span className="block truncate font-mono text-[11px] text-muted-foreground">
              {text(values.Raccourci) ? `/${text(values.Raccourci)}` : $t('sans raccourci')}
            </span>
          </span>
        </>
      )}
      form={(values) => (
        <>
          <FormSection title={$t('La réponse')}>
            <Field label={$t('Titre')} required>
              {(id) => (
                <Input
                  id={id}
                  value={text(values.Titre)}
                  onChange={(e) => replies.set('Titre', e.target.value)}
                  maxLength={80}
                  placeholder={$t('Délai de remboursement')}
                />
              )}
            </Field>
            <Field
              label={$t('Raccourci')}
              hint={$t('Tapé après « / » dans le composeur, sans espace.')}
            >
              {(id) => (
                <div className="relative">
                  <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 font-mono text-sm text-muted-foreground">
                    /
                  </span>
                  <Input
                    id={id}
                    value={text(values.Raccourci)}
                    onChange={(e) => replies.set('Raccourci', shortcutOf(e.target.value))}
                    placeholder="delai-remboursement"
                    className="pl-6 font-mono"
                    maxLength={40}
                  />
                </div>
              )}
            </Field>
            <Field
              label={$t('Contenu')}
              hint={$t(
                'Cliquez une variable pour l’insérer : elle sera remplacée par celle du contact.',
              )}
            >
              {(id) => (
                <div className="space-y-2">
                  <MarkdownField
                    id={id}
                    value={text(values.Contenu)}
                    onChange={(markdown) => replies.set('Contenu', markdown)}
                    onEditor={setContent}
                    placeholder={$t('Bonjour {prénom}, …')}
                  />
                  <div className="flex flex-wrap gap-1.5">
                    {VARIABLES.map((variable) => (
                      <button
                        key={variable}
                        type="button"
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() =>
                          content?.chain().focus().insertContent(`{${variable}}`).run()
                        }
                        className="inline-flex h-6 items-center rounded-md border border-dashed px-2 font-mono text-[11px] text-muted-foreground transition-colors hover:border-solid hover:bg-muted hover:text-foreground"
                      >
                        {`{${variable}}`}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </Field>
          </FormSection>
          <FormSection title={$t('Pour qui')}>
            <Field label={$t('Équipes')} hint={$t('Aucune : proposée à tous les conseillers.')}>
              {() => (
                <Toggles
                  value={list(values.Équipes)}
                  choices={data
                    .rows('equipes')
                    .map((t) => ({ id: t.id, label: text(t.values.Nom) }))}
                  onChange={(ids) => replies.set('Équipes', ids)}
                  disabled={!data.canEdit}
                />
              )}
            </Field>
          </FormSection>
        </>
      )}
      preview={(values) => <ReplyPreview data={data} values={values} id={replies.selectedId} />}
    />
  )
}

function ReplyPreview({
  data,
  values,
  id,
}: {
  readonly data: SettingsData
  readonly values: Values
  readonly id: string | null
}) {
  const shortcut = text(values.Raccourci)
  const others = data
    .rows('reponses_types')
    .filter((r) => r.id !== id)
    .slice(0, 2)
  const body = filled(text(values.Contenu))

  return (
    <>
      <PreviewCard label={$t('Dans le composeur')} hint={$t('Le conseiller tape « / »')}>
        <div className="space-y-2 bg-muted/30 p-4">
          <div className="overflow-hidden rounded-lg border bg-popover shadow-sm">
            {[
              { id: 'current', values, current: true },
              ...others.map((o) => ({ id: o.id, values: o.values, current: false })),
            ].map((r) => (
              <div
                key={r.id}
                className={cn('flex items-baseline gap-3 px-3 py-2', r.current && 'bg-accent')}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">
                    {text(r.values.Titre) || $t('Nouvelle réponse')}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {plainOf(filled(text(r.values.Contenu))) || '…'}
                  </span>
                </span>
                {text(r.values.Raccourci) && (
                  <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
                    /{text(r.values.Raccourci)}
                  </span>
                )}
              </div>
            ))}
          </div>
          <div className="flex h-10 items-center rounded-lg border bg-background px-3 font-mono text-sm">
            /{shortcut}
            <span className="ml-px h-4 w-px animate-pulse bg-foreground" />
          </div>
        </div>
      </PreviewCard>

      <PreviewCard
        label={$t('Chez le visiteur')}
        hint={$t('Pour {name}', { name: `${SAMPLE.prénom} ${SAMPLE.nom}` })}
      >
        <div className="bg-muted/30 p-5">
          <div className="flex items-end gap-2">
            <ContactAvatar name="Camille Durand" className="size-7 text-[10px]" />
            <div className="max-w-[85%] rounded-2xl rounded-bl-md border bg-background px-3.5 py-2.5 text-sm leading-relaxed">
              {body ? (
                <RichText text={body} />
              ) : (
                <span className="text-muted-foreground">{$t('Le contenu de la réponse.')}</span>
              )}
            </div>
          </div>
        </div>
      </PreviewCard>
    </>
  )
}

function TagPreview({
  data,
  values,
  id,
}: {
  readonly data: SettingsData
  readonly values: Values
  readonly id: string | null
}) {
  const color = text(values.Couleur) || '#64748b'
  const name = text(values.Nom) || $t('Nouvelle étiquette')
  const byAi = bool(values["Posée par l'IA"])
  const others = data.rows('etiquettes').filter((t) => t.id !== id)

  return (
    <>
      <PreviewCard label={$t('Sur une conversation')}>
        <div className="flex gap-3 p-4">
          <ContactAvatar name="Léa Martin" className="size-9" />
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex items-baseline gap-2">
              <span className="flex-1 truncate text-sm font-semibold">Léa Martin</span>
              <span className="text-[11px] text-muted-foreground">14:32</span>
            </div>
            <p className="truncate text-xs text-muted-foreground">
              {$t('Bonjour, je n’ai toujours pas reçu mon remboursement…')}
            </p>
            <div className="flex flex-wrap gap-1 pt-1">
              <ColorBadge color={color} className="ring-2 ring-primary/30">
                {byAi && <Sparkles />}
                {name}
              </ColorBadge>
              {others.slice(0, 2).map((t) => (
                <ColorBadge key={t.id} color={text(t.values.Couleur) || '#64748b'}>
                  {text(t.values.Nom)}
                </ColorBadge>
              ))}
            </div>
          </div>
        </div>
      </PreviewCard>

      {byAi && (
        <PreviewCard label={$t('Ce que lit l’IA')}>
          <div className="space-y-2 p-5 font-mono text-xs leading-relaxed">
            <div className="flex items-center gap-1.5 font-sans text-[11px] font-medium text-violet-700 dark:text-violet-300">
              <Sparkles className="size-3.5" />
              {$t('Consigne d’étiquetage')}
            </div>
            <p>
              <span className="text-muted-foreground">« </span>
              {name}
              <span className="text-muted-foreground"> » — </span>
              {text(values["Quand l'appliquer"]) || (
                <span className="text-amber-700 dark:text-amber-400">
                  {$t('Sans description, l’IA ne saura pas quand la poser.')}
                </span>
              )}
            </p>
          </div>
        </PreviewCard>
      )}

      <PreviewCard label={$t('Toutes les étiquettes')}>
        <div className="flex flex-wrap gap-1.5 p-4">
          <ColorBadge color={color} className="ring-2 ring-primary/30">
            <Tag />
            {name}
          </ColorBadge>
          {others.map((t) => (
            <ColorBadge key={t.id} color={text(t.values.Couleur) || '#64748b'}>
              {bool(t.values["Posée par l'IA"]) && <Sparkles />}
              {text(t.values.Nom)}
            </ColorBadge>
          ))}
        </div>
      </PreviewCard>
    </>
  )
}
