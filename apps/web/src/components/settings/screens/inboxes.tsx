'use client'

import { ContactAvatar } from '@/components/inbox/labels'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { $t, $tp } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import { Globe, Inbox, MessagesSquare, UsersRound } from 'lucide-react'
import { ChoiceMenu, Toggles } from '../field-input'
import { ColorField, Field, FormSection } from '../kit/controls'
import { type Values, bool, list, nameOf, one, text, useSettingsData } from '../kit/data'
import { useRowEditor } from '../kit/editor'
import { PreviewCard, Studio } from '../kit/studio'

/**
 * The inboxes: where conversations arrive, and the teams that answer there — the same team
 * may serve several (D12). The preview shows the inbox in the menu, and a conversation's
 * way: from the sites that pour into it, to the agents who see it.
 */
export function InboxesScreen() {
  const data = useSettingsData(['boites', 'equipes', 'conseillers', 'sites'])
  const editor = useRowEditor(data, 'boites', { defaults: { Couleur: '#2563EB' } })
  const teams = data.rows('equipes')
  const teamName = (id: string) =>
    nameOf(data.table('equipes'), teams.find((t) => t.id === id)?.values ?? {})

  return (
    <Studio
      section={$t('Boîtes de réception')}
      data={data}
      editor={editor}
      nouns={{ fresh: $t('Nouvelle boîte'), remove: $t('Supprimer la boîte') }}
      empty={{
        title: $t('Aucune boîte de réception'),
        text: $t(
          'Une boîte reçoit les conversations d’un ou plusieurs sites, et les équipes qui y répondent.',
        ),
      }}
      used={['Nom', 'Description', 'Couleur', 'Équipes', 'Équipe par défaut']}
      item={(_row, values) => (
        <>
          <span
            className="size-2.5 shrink-0 rounded-full bg-muted-foreground/40"
            style={text(values.Couleur) ? { background: text(values.Couleur) } : undefined}
          />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-medium">
              {text(values.Nom) || $t('Nouvelle boîte')}
            </span>
            <span className="block truncate text-[11px] text-muted-foreground">
              {list(values.Équipes).map(teamName).filter(Boolean).join(', ') || $t('Aucune équipe')}
            </span>
          </span>
        </>
      )}
      form={(values) => (
        <>
          <FormSection title={$t('La boîte')}>
            <Field
              label={$t('Nom')}
              required
              hint={$t('Comme le menu de la messagerie l’affiche.')}
            >
              {(id) => (
                <Input
                  id={id}
                  value={text(values.Nom)}
                  onChange={(event) => editor.set('Nom', event.target.value)}
                  placeholder={$t('Service client')}
                  maxLength={60}
                />
              )}
            </Field>
            <Field label={$t('Description')}>
              {(id) => (
                <Textarea
                  id={id}
                  rows={2}
                  value={text(values.Description)}
                  onChange={(event) => editor.set('Description', event.target.value)}
                  placeholder={$t('Les demandes générales des clients.')}
                />
              )}
            </Field>
            <Field
              label={$t('Couleur')}
              hint={$t('La pastille de la boîte, dans le menu et les listes.')}
            >
              {(id) => (
                <ColorField
                  id={id}
                  value={text(values.Couleur)}
                  onChange={(color) => editor.set('Couleur', color)}
                />
              )}
            </Field>
          </FormSection>

          <FormSection
            title={$t('Qui répond')}
            hint={$t(
              'Les conseillers de ces équipes voient la boîte. Les superviseurs voient toutes les boîtes.',
            )}
          >
            <Field label={$t('Équipes')}>
              {() => (
                <Toggles
                  value={list(values.Équipes)}
                  choices={teams.map((t) => ({ id: t.id, label: teamName(t.id) }))}
                  onChange={(ids) => {
                    editor.set('Équipes', ids)
                    const fallback = one(values['Équipe par défaut'])
                    if (fallback && !ids.includes(fallback)) editor.set('Équipe par défaut', null)
                  }}
                  disabled={!data.canEdit}
                />
              )}
            </Field>
            <Field
              label={$t('Équipe par défaut')}
              hint={$t(
                'Celle à qui une nouvelle conversation est confiée. Aucune : l’équipe du site.',
              )}
            >
              {(id) => (
                <ChoiceMenu
                  id={id}
                  value={one(values['Équipe par défaut'])}
                  choices={list(values.Équipes).map((t) => ({ id: t, label: teamName(t) }))}
                  onChange={(team) => editor.set('Équipe par défaut', team)}
                  allowNone
                  disabled={!data.canEdit}
                />
              )}
            </Field>
          </FormSection>
        </>
      )}
      preview={(values) => (
        <InboxPreview
          values={values}
          id={editor.selectedId}
          others={editor.rows.filter((r) => r.id !== editor.selectedId).map((r) => r.values)}
          teams={teams.map((t) => ({ id: t.id, name: teamName(t.id) }))}
          agents={data.rows('conseillers').map((r) => r.values)}
          sites={data.rows('sites').map((r) => r.values)}
        />
      )}
    />
  )
}

function InboxPreview({
  values,
  id,
  others,
  teams,
  agents,
  sites,
}: {
  readonly values: Values
  readonly id: string | null
  readonly others: readonly Values[]
  readonly teams: readonly { readonly id: string; readonly name: string }[]
  readonly agents: readonly Values[]
  readonly sites: readonly Values[]
}) {
  const color = text(values.Couleur) || '#94a3b8'
  const name = text(values.Nom) || $t('Nouvelle boîte')
  const chosen = list(values.Équipes)
  const fallback = one(values['Équipe par défaut'])
  const pouring = sites.filter((s) => id !== null && one(s['Boîte de réception']) === id)
  const members = agents.filter(
    (a) => bool(a.Actif) && list(a.Équipes).some((t) => chosen.includes(t)),
  )
  const supervisors = agents.filter(
    (a) => bool(a.Actif) && a.Rôle === 'Superviseur' && !members.includes(a),
  )

  return (
    <>
      <PreviewCard label={$t('Dans le menu')} className="bg-sidebar p-2">
        <div className="flex h-8 items-center gap-2.5 rounded-lg px-2 text-[13px] font-medium">
          <MessagesSquare className="size-4 text-muted-foreground" />
          <span className="flex-1">{$t('Conversations')}</span>
        </div>
        {[...others.filter((o) => bool(o.Actif)).slice(0, 2), values].map((inbox, index) => {
          const current = inbox === values
          return (
            <div
              key={current ? 'current' : index}
              className={cn(
                'flex h-7 items-center gap-2.5 rounded-lg pr-2 pl-8 text-[13px] transition-colors',
                current
                  ? 'bg-sidebar-accent font-medium ring-1 ring-primary/30'
                  : 'text-muted-foreground',
                current && !bool(values.Actif) && 'opacity-50',
              )}
            >
              <span
                className="size-2 shrink-0 rounded-full"
                style={{ background: text(inbox.Couleur) || '#94a3b8' }}
              />
              <span className="min-w-0 flex-1 truncate">{current ? name : text(inbox.Nom)}</span>
              {current && (
                <span className="rounded-full bg-primary/15 px-1.5 text-[10px] font-semibold tabular-nums">
                  3
                </span>
              )}
            </div>
          )
        })}
      </PreviewCard>

      <PreviewCard
        label={$t('Le chemin d’une conversation')}
        hint={bool(values.Actif) ? undefined : $t('Désactivée : rien n’y arrive')}
      >
        <ol className="relative space-y-0 p-5">
          <Step icon={Globe} title={$t('Arrive d’un site')}>
            {pouring.length > 0 ? (
              <span className="flex flex-wrap gap-1.5">
                {pouring.map((s) => (
                  <span key={text(s.Nom)} className="rounded-md bg-muted px-2 py-0.5 text-xs">
                    {text(s.Nom)}
                  </span>
                ))}
              </span>
            ) : (
              <span className="text-xs text-muted-foreground">
                {$t(
                  'Aucun site n’y verse encore : choisissez cette boîte dans « Sites et horaires ».',
                )}
              </span>
            )}
          </Step>
          <Step icon={Inbox} title={$t('Entre dans la boîte')} accent={color}>
            <span className="inline-flex items-center gap-2 rounded-lg border px-2.5 py-1 text-sm font-medium">
              <span className="size-2.5 rounded-full" style={{ background: color }} />
              {name}
            </span>
          </Step>
          <Step icon={UsersRound} title={$t('Est confiée à une équipe')}>
            {chosen.length > 0 ? (
              <span className="flex flex-wrap gap-1.5">
                {chosen.map((t) => (
                  <span
                    key={t}
                    className={cn(
                      'inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs',
                      t === fallback
                        ? 'bg-primary/10 font-medium text-foreground ring-1 ring-primary/30'
                        : 'bg-muted',
                    )}
                  >
                    {teams.find((x) => x.id === t)?.name}
                    {t === fallback && (
                      <span className="text-[10px] text-muted-foreground">{$t('par défaut')}</span>
                    )}
                  </span>
                ))}
              </span>
            ) : (
              <span className="text-xs text-amber-700 dark:text-amber-400">
                {$t('Aucune équipe : seuls les superviseurs la verront.')}
              </span>
            )}
          </Step>
          <Step icon={MessagesSquare} title={$t('Que voient ces conseillers')} last>
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-1">
                {members.slice(0, 8).map((a) => (
                  <ContactAvatar
                    key={text(a.Nom)}
                    name={text(a.Nom)}
                    className="size-7 text-[10px] ring-2 ring-background"
                  />
                ))}
                {members.length === 0 && (
                  <span className="text-xs text-muted-foreground">
                    {$t('Aucun conseiller pour l’instant.')}
                  </span>
                )}
              </div>
              <p className="text-[11px] text-muted-foreground">
                {$tp(members.length, '{count} conseiller', '{count} conseillers')}
                {supervisors.length > 0 &&
                  $tp(
                    supervisors.length,
                    ', et {count} superviseur qui voit tout',
                    ', et {count} superviseurs qui voient tout',
                  )}
              </p>
            </div>
          </Step>
        </ol>
      </PreviewCard>
    </>
  )
}

function Step({
  icon: Icon,
  title,
  accent,
  last = false,
  children,
}: {
  readonly icon: typeof Globe
  readonly title: string
  readonly accent?: string
  readonly last?: boolean
  readonly children: React.ReactNode
}) {
  return (
    <li className="relative flex gap-3.5 pb-5 last:pb-0">
      {!last && <span className="absolute top-8 bottom-0 left-[15px] w-px bg-border" />}
      <span
        className="relative z-10 flex size-8 shrink-0 items-center justify-center rounded-full border bg-background"
        style={accent ? { borderColor: accent, color: accent } : undefined}
      >
        <Icon className="size-3.5" />
      </span>
      <div className="min-w-0 flex-1 space-y-1.5 pt-1">
        <div className="text-xs font-medium text-muted-foreground">{title}</div>
        {children}
      </div>
    </li>
  )
}
