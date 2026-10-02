'use client'

import { Chip } from '@/components/app/chip'
import { InboxGlyph } from '@/components/app/look'
import { ContactAvatar } from '@/components/inbox/labels'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Segmented } from '@/components/ui/segmented'
import { Textarea } from '@/components/ui/textarea'
import { api } from '@/lib/api'
import { $t, $tp } from '@/lib/i18n'
import { useAddressTab } from '@/lib/use-address-tab'
import { cn } from '@/lib/utils'
import type { SettingsRow } from '@chat/contracts'
import {
  ArrowRightLeft,
  Check,
  Headset,
  Inbox,
  KeyRound,
  ShieldCheck,
  UserPlus,
  UserRound,
} from 'lucide-react'
import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react'
import { ChoiceMenu, Toggles } from '../field-input'
import { CardChoice, Field, FormSection, RangeField, ToggleField } from '../kit/controls'
import {
  type SettingsData,
  type Values,
  bool,
  forgetOverview,
  list,
  nameOf,
  num,
  one,
  text,
  useSettingsData,
} from '../kit/data'
import { type Extras, NEW, useRowEditor } from '../kit/editor'
import { PreviewCard, Studio, StudioTabs } from '../kit/studio'
import { AccountDialog } from './account-dialog'
import { lookOfRow } from './inboxes'

/**
 * Teams and agents: who answers, grouped as they are assigned and transferred to. An agent
 * is invited from here — their basedb account is created with them, and they choose their
 * own password at their first sign-in. A team's members are chosen from the team as well:
 * they are written on the agents' rows, where basedb keeps them.
 */

type Tab = 'teams' | 'agents'

const sameSet = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((x) => b.includes(x))

export function TeamsScreen() {
  const data = useSettingsData(['equipes', 'conseillers', 'boites'])
  const [tab, setTab, tabBase] = useAddressTab<Tab>('/parametrage/equipes', {
    teams: null,
    agents: 'conseillers',
  })
  const agents = data.rows('conseillers')

  // A team's members, as chosen on the team: written on the agents' rows when it is saved.
  const [members, setMembers] = useState<Readonly<Record<string, readonly string[]>>>({})
  const membersOf = useCallback(
    (teamId: string) =>
      members[teamId] ??
      agents
        .filter((a) => teamId !== NEW && list(a.values.Équipes).includes(teamId))
        .map((a) => a.id),
    [members, agents],
  )
  const extras: Extras = useMemo(
    () => ({
      dirty: (id) =>
        members[id] !== undefined &&
        !sameSet(
          members[id] ?? [],
          agents.filter((a) => id !== NEW && list(a.values.Équipes).includes(id)).map((a) => a.id),
        ),
      save: async (id, was) => {
        const chosen = members[was]
        if (!chosen) return
        for (const agent of agents) {
          const teams = list(agent.values.Équipes)
          const has = teams.includes(id)
          const wants = chosen.includes(agent.id)
          if (has === wants) continue
          await api.updateRow('conseillers', agent.id, {
            Équipes: wants ? [...teams, id] : teams.filter((t) => t !== id),
          })
        }
        setMembers(({ [was]: _, ...others }) => others)
        await data.reload(['conseillers'])
      },
      discard: (id) => setMembers(({ [id]: _, ...others }) => others),
    }),
    [members, agents, data],
  )

  const teams = useRowEditor(data, 'equipes', { extras })
  const people = useRowEditor(data, 'conseillers', { defaults: { Rôle: 'Conseiller' } })
  const [inviting, setInviting] = useState(false)

  // Reached from the palette: « Inviter un conseiller ».
  useEffect(() => {
    if (!new URLSearchParams(window.location.search).has('inviter')) return
    setTab('agents')
    setInviting(true)
  }, [setTab])

  const tabs = (
    <StudioTabs
      value={tab}
      onChange={setTab}
      tabs={[
        { value: 'teams', label: $t('Équipes'), count: data.rows('equipes').length },
        { value: 'agents', label: $t('Conseillers'), count: agents.length },
      ]}
    />
  )

  if (tab === 'teams') {
    return (
      <Studio
        base={tabBase}
        section={$t('Équipes et conseillers')}
        data={data}
        editor={teams}
        tabs={tabs}
        nouns={{ fresh: $t('Nouvelle équipe'), remove: $t('Supprimer l’équipe') }}
        empty={{
          title: $t('Aucune équipe'),
          text: $t(
            'Une équipe regroupe des conseillers : on lui confie des conversations, on lui en transfère.',
          ),
        }}
        used={['Nom', 'Description']}
        item={(row, values) => (
          <>
            <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-muted">
              <Headset className="size-3.5 text-muted-foreground" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-medium">
                {text(values.Nom) || $t('Nouvelle équipe')}
              </span>
              <span className="block truncate text-[11px] text-muted-foreground">
                {$tp(membersOf(row.id).length, '{count} conseiller', '{count} conseillers')}
              </span>
            </span>
          </>
        )}
        form={(values) => (
          <>
            <FormSection title={$t('L’équipe')}>
              <Field label={$t('Nom')} required>
                {(id) => (
                  <Input
                    id={id}
                    value={text(values.Nom)}
                    onChange={(event) => teams.set('Nom', event.target.value)}
                    placeholder={$t('Équipe Auto')}
                    maxLength={60}
                  />
                )}
              </Field>
              <Field
                label={$t('Description')}
                hint={$t('Ce dont elle s’occupe : les conseillers la lisent en transférant.')}
              >
                {(id) => (
                  <Textarea
                    id={id}
                    rows={2}
                    value={text(values.Description)}
                    onChange={(event) => teams.set('Description', event.target.value)}
                    placeholder={$t('Contrats et sinistres automobile.')}
                  />
                )}
              </Field>
            </FormSection>
            <FormSection
              title={$t('Membres')}
              hint={$t('Un conseiller peut être de plusieurs équipes.')}
            >
              <MemberPicker
                agents={agents}
                chosen={teams.selectedId ? membersOf(teams.selectedId) : []}
                onChange={(ids) => {
                  const id = teams.selectedId
                  if (id) setMembers((all) => ({ ...all, [id]: ids }))
                }}
                disabled={!data.canEdit}
              />
            </FormSection>
          </>
        )}
        preview={(values) => (
          <TeamPreview
            data={data}
            values={values}
            id={teams.selectedId}
            members={agents.filter(
              (a) => teams.selectedId !== null && membersOf(teams.selectedId).includes(a.id),
            )}
          />
        )}
      />
    )
  }

  return (
    <>
      <Studio
        base={tabBase}
        section={$t('Équipes et conseillers')}
        data={data}
        editor={people}
        tabs={tabs}
        nouns={{ fresh: $t('Nouveau conseiller'), remove: $t('Retirer le conseiller') }}
        empty={{
          title: $t('Aucun conseiller'),
          text: $t('Invitez la première personne qui répondra aux visiteurs.'),
        }}
        listAction={
          <Button
            size="sm"
            className="h-8 w-full justify-start gap-1.5 text-xs"
            onClick={() => setInviting(true)}
          >
            <UserPlus className="size-3.5" />
            {$t('Inviter un conseiller')}
          </Button>
        }
        used={['Nom', 'E-mail', 'Rôle', 'Équipes', 'Conversations simultanées']}
        searchOf={(values) => text(values.Nom)}
        item={(_row, values) => (
          <>
            <ContactAvatar name={text(values.Nom) || '?'} className="size-7 text-[10px]" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-medium">
                {text(values.Nom) || $t('Nouveau conseiller')}
              </span>
              <span className="block truncate text-[11px] text-muted-foreground">
                {values.Rôle === 'Superviseur' ? $t('Superviseur') : $t('Conseiller')}
                {list(values.Équipes).length > 0 &&
                  ` · ${list(values.Équipes)
                    .map((t) =>
                      nameOf(
                        data.table('equipes'),
                        data.rows('equipes').find((r) => r.id === t)?.values ?? {},
                      ),
                    )
                    .filter(Boolean)
                    .join(', ')}`}
              </span>
            </span>
          </>
        )}
        form={(values) => (
          <AgentForm data={data} values={values} id={people.selectedId} set={people.set} />
        )}
        preview={(values) => <AgentPreview data={data} values={values} />}
      />
      {inviting && (
        <InviteDialog
          data={data}
          onClose={() => setInviting(false)}
          onInvited={(row) => {
            forgetOverview()
            void data.reload().then(() => people.select(row.id))
          }}
        />
      )}
    </>
  )
}

// ── Teams ─────────────────────────────────────────────────────────────────────────────

function MemberPicker({
  agents,
  chosen,
  onChange,
  disabled,
}: {
  readonly agents: readonly SettingsRow[]
  readonly chosen: readonly string[]
  readonly onChange: (ids: string[]) => void
  readonly disabled: boolean
}) {
  if (agents.length === 0) {
    return <p className="text-xs text-muted-foreground">{$t('Aucun conseiller pour l’instant.')}</p>
  }
  return (
    <ul className="divide-y overflow-hidden rounded-lg border">
      {agents.map((agent) => {
        const on = chosen.includes(agent.id)
        const name = text(agent.values.Nom)
        return (
          <li key={agent.id}>
            <button
              type="button"
              aria-pressed={on}
              disabled={disabled}
              onClick={() =>
                onChange(on ? chosen.filter((id) => id !== agent.id) : [...chosen, agent.id])
              }
              className="flex w-full items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-muted/50 disabled:hover:bg-transparent"
            >
              <ContactAvatar name={name || '?'} className="size-7 text-[10px]" />
              <span
                className={cn(
                  'min-w-0 flex-1 truncate text-sm',
                  !bool(agent.values.Actif) && 'text-muted-foreground',
                )}
              >
                {name}
              </span>
              {agent.values.Rôle === 'Superviseur' && (
                <Chip tint="violet">{$t('Superviseur')}</Chip>
              )}
              <span
                className={cn(
                  'flex size-4.5 shrink-0 items-center justify-center rounded-[5px] border transition-colors',
                  on && 'border-primary bg-primary text-primary-foreground',
                )}
              >
                {on && <Check className="size-3" strokeWidth={3} />}
              </span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}

function TeamPreview({
  data,
  values,
  id,
  members,
}: {
  readonly data: SettingsData
  readonly values: Values
  readonly id: string | null
  readonly members: readonly SettingsRow[]
}) {
  const name = text(values.Nom) || $t('Nouvelle équipe')
  const inboxes = data
    .rows('boites')
    .filter((b) => id !== null && list(b.values.Équipes).includes(id))
  const others = data
    .rows('equipes')
    .filter((t) => t.id !== id)
    .slice(0, 2)
  const capacity = members.reduce(
    (sum, m) => sum + (num(m.values['Conversations simultanées']) ?? 0),
    0,
  )

  return (
    <>
      <PreviewCard label={$t('L’équipe')}>
        <div className="space-y-4 p-5">
          <div className="flex items-start gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-muted">
              <Headset className="size-5 text-muted-foreground" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate font-semibold">{name}</div>
              <p className="line-clamp-2 text-xs text-muted-foreground">
                {text(values.Description) || $t('Sans description')}
              </p>
            </div>
          </div>
          <div className="flex items-center">
            {members.slice(0, 7).map((m) => (
              <ContactAvatar
                key={m.id}
                name={text(m.values.Nom)}
                online={bool(m.values.Actif)}
                className="-ml-1.5 size-8 text-[10px] ring-2 ring-background first:ml-0"
              />
            ))}
            <span className="ml-3 text-xs text-muted-foreground">
              {members.length === 0
                ? $t('Aucun membre : personne ne recevra ses conversations.')
                : $tp(members.length, '{count} conseiller', '{count} conseillers')}
              {capacity > 0 &&
                members.length > 0 &&
                $tp(
                  capacity,
                  ', jusqu’à {count} conversation à la fois',
                  ', jusqu’à {count} conversations à la fois',
                )}
            </span>
          </div>
          <div className="space-y-1.5 border-t pt-3">
            <div className="text-[11px] font-medium text-muted-foreground">{$t('Répond dans')}</div>
            <div className="flex flex-wrap gap-1.5">
              {inboxes.map((b) => (
                <span
                  key={b.id}
                  className="inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs"
                >
                  <InboxGlyph look={lookOfRow(b.values)} className="size-3" />
                  {text(b.values.Nom)}
                </span>
              ))}
              {inboxes.length === 0 && (
                <span className="text-xs text-muted-foreground">
                  {$t('Aucune boîte : choisissez l’équipe dans « Boîtes de réception ».')}
                </span>
              )}
            </div>
          </div>
        </div>
      </PreviewCard>

      <PreviewCard label={$t('Au moment de transférer')} hint={$t('Ce que voit un conseiller')}>
        <div className="space-y-1 p-3">
          <div className="flex items-center gap-2 px-2 pt-1 pb-2 text-sm font-medium">
            <ArrowRightLeft className="size-4 text-muted-foreground" />
            {$t('Transférer la conversation')}
          </div>
          {[
            ...others.map((t) => ({ id: t.id, name: text(t.values.Nom), current: false })),
            { id: 'current', name, current: true },
          ].map((t) => (
            <div
              key={t.id}
              className={cn(
                'flex items-center gap-3 rounded-lg border px-3 py-2 text-sm',
                t.current
                  ? 'border-primary/50 bg-primary/5 ring-1 ring-primary/20'
                  : 'text-muted-foreground',
              )}
            >
              <span
                className={cn(
                  'size-3.5 rounded-full border',
                  t.current && 'border-4 border-primary',
                )}
              />
              <span className="flex-1 truncate">{t.name}</span>
              {t.current && (
                <span className="text-[11px] text-muted-foreground">
                  {$tp(members.length, '{count} membre', '{count} membres')}
                </span>
              )}
            </div>
          ))}
        </div>
      </PreviewCard>
    </>
  )
}

// ── Agents ────────────────────────────────────────────────────────────────────────────

function AgentForm({
  data,
  values,
  id,
  set,
}: {
  readonly data: SettingsData
  readonly values: Values
  readonly id: string | null
  readonly set: (label: string, value: unknown) => void
}) {
  const email = text(values['E-mail'])
  const limit = num(values['Conversations simultanées'])
  const [resetting, setResetting] = useState(false)

  return (
    <>
      <FormSection title={$t('La personne')}>
        <Field
          label={$t('Nom')}
          required
          hint={$t('Son prénom s’affiche aux visiteurs, derrière l’IA.')}
        >
          {(fieldId) => (
            <Input
              id={fieldId}
              value={text(values.Nom)}
              onChange={(event) => set('Nom', event.target.value)}
              placeholder={$t('Camille Durand')}
              maxLength={80}
            />
          )}
        </Field>
      </FormSection>

      <FormSection title={$t('Connexion')}>
        <Field
          label={$t('Adresse e-mail')}
          hint={$t(
            'Celle de sa connexion — avec son mot de passe, ou par le fournisseur d’identité de l’entreprise.',
          )}
        >
          {(fieldId) => (
            <Input
              id={fieldId}
              type="email"
              value={email}
              onChange={(event) => set('E-mail', event.target.value)}
              placeholder="camille.durand@exemple.fr"
              maxLength={254}
              disabled={!data.canEdit}
            />
          )}
        </Field>
        {data.canEdit && id !== NEW && email !== '' && (
          <div className="flex items-center justify-between gap-3 rounded-lg border bg-muted/30 px-3 py-2">
            <span className="text-xs text-muted-foreground">
              {$t('Mot de passe oublié, ou jamais choisi : un lien pour en choisir un.')}
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 shrink-0 gap-1.5 text-xs"
              onClick={() => setResetting(true)}
            >
              <KeyRound className="size-3.5" />
              {$t('Créer un lien')}
            </Button>
          </div>
        )}
      </FormSection>

      <FormSection title={$t('Rôle')}>
        <CardChoice
          value={values.Rôle === 'Superviseur' ? 'Superviseur' : 'Conseiller'}
          onChange={(role) => set('Rôle', role)}
          disabled={!data.canEdit}
          options={[
            {
              value: 'Conseiller',
              label: $t('Conseiller'),
              hint: $t('Voit les boîtes de ses équipes, répond, transfère.'),
              icon: <UserRound />,
            },
            {
              value: 'Superviseur',
              label: $t('Superviseur'),
              hint: $t('Voit tout, réaffecte, et règle le paramétrage.'),
              icon: <ShieldCheck />,
            },
          ]}
        />
      </FormSection>

      <FormSection title={$t('Équipes')}>
        <Toggles
          value={list(values.Équipes)}
          choices={data.rows('equipes').map((t) => ({ id: t.id, label: text(t.values.Nom) }))}
          onChange={(ids) => set('Équipes', ids)}
          disabled={!data.canEdit}
        />
      </FormSection>

      <FormSection title={$t('Charge')}>
        <ToggleField
          label={$t('Limiter les conversations simultanées')}
          hint={$t('Au-delà, plus aucune conversation ne lui est confiée automatiquement.')}
          checked={limit !== null}
          onChange={(on) => set('Conversations simultanées', on ? 5 : null)}
          disabled={!data.canEdit}
        >
          {limit !== null && (
            <Field label={$t('Au plus')}>
              {(fieldId) => (
                <RangeField
                  id={fieldId}
                  value={limit}
                  min={1}
                  max={20}
                  onChange={(n) => set('Conversations simultanées', n)}
                  format={(n) => $tp(n, '{count} conversation', '{count} conversations')}
                  disabled={!data.canEdit}
                />
              )}
            </Field>
          )}
        </ToggleField>
      </FormSection>

      {resetting && id && (
        <AccountDialog
          title={$t('Nouveau mot de passe')}
          description={$t(
            '{name} choisira un nouveau mot de passe à ce lien ; ses sessions ouvertes seront alors fermées.',
            { name: text(values.Nom) || email },
          )}
          action={$t('Créer le lien')}
          run={async () => (await api.resetAgentPassword(id)).link}
          onClose={() => setResetting(false)}
          done={<SignInHint email={email} />}
        />
      )}
    </>
  )
}

function SignInHint({ email }: { readonly email: string | null }) {
  return (
    <div className="rounded-lg border bg-muted/30 px-3 py-2.5 text-xs leading-relaxed text-muted-foreground">
      {$t('Ensuite, pour se connecter : {address}, avec {email} et ce mot de passe.', {
        address: typeof window === 'undefined' ? '' : window.location.origin,
        email: email ?? '—',
      })}
    </div>
  )
}

function AgentPreview({ data, values }: { readonly data: SettingsData; readonly values: Values }) {
  const name = text(values.Nom) || $t('Nouveau conseiller')
  const supervisor = values.Rôle === 'Superviseur'
  const teamIds = list(values.Équipes)
  const email = text(values['E-mail'])
  const inboxes = data
    .rows('boites')
    .filter(
      (b) =>
        bool(b.values.Actif) &&
        (supervisor || list(b.values.Équipes).some((t) => teamIds.includes(t))),
    )
  const limit = num(values['Conversations simultanées'])

  return (
    <>
      <PreviewCard label={$t('Sa fiche')}>
        <div className="flex items-center gap-4 p-5">
          <ContactAvatar name={name} online={bool(values.Actif)} className="size-14 text-base" />
          <div className="min-w-0 flex-1 space-y-1">
            <div className="truncate text-lg font-semibold">{name}</div>
            <div className="truncate text-xs text-muted-foreground">
              {email || $t('Pas encore d’adresse de connexion')}
            </div>
            <div className="flex flex-wrap gap-1.5 pt-1">
              {supervisor ? (
                <Chip tint="violet">{$t('Superviseur')}</Chip>
              ) : (
                <Chip tint="zinc">{$t('Conseiller')}</Chip>
              )}
              {!bool(values.Actif) && <Chip tint="rose">{$t('Désactivé')}</Chip>}
              {teamIds.map((t) => (
                <Chip key={t} tint="sky">
                  {text(data.rows('equipes').find((r) => r.id === t)?.values.Nom)}
                </Chip>
              ))}
            </div>
          </div>
        </div>
      </PreviewCard>

      <PreviewCard
        label={$t('Ce qu’il voit')}
        hint={supervisor ? $t('Un superviseur voit toutes les boîtes') : undefined}
      >
        <div className="bg-sidebar p-2">
          {inboxes.map((b) => (
            <div key={b.id} className="flex h-8 items-center gap-2.5 rounded-lg px-2 text-[13px]">
              <InboxGlyph look={lookOfRow(b.values)} />
              <span className="flex-1 truncate">{text(b.values.Nom)}</span>
              <Inbox className="size-3.5 text-muted-foreground" />
            </div>
          ))}
          {inboxes.length === 0 && (
            <p className="px-2 py-3 text-xs text-amber-700 dark:text-amber-400">
              {$t('Aucune boîte : rattachez-le à une équipe qui répond dans une boîte.')}
            </p>
          )}
        </div>
      </PreviewCard>

      <PreviewCard label={$t('Sa charge')}>
        <div className="space-y-3 p-5">
          {limit === null ? (
            <p className="text-sm text-muted-foreground">
              {$t('Sans limite : il reçoit des conversations tant qu’il est disponible.')}
            </p>
          ) : (
            <>
              <div className="flex gap-1">
                {Array.from({ length: limit }, (_, i) => (
                  <span
                    // biome-ignore lint/suspicious/noArrayIndexKey: identical slots, in order
                    key={i}
                    className={cn(
                      'h-6 flex-1 rounded-sm',
                      i < Math.ceil(limit / 2) ? 'bg-primary/70' : 'bg-muted',
                    )}
                  />
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                {$tp(
                  limit,
                  'Jusqu’à {count} conversation à la fois, puis la file attend un autre conseiller.',
                  'Jusqu’à {count} conversations à la fois, puis la file attend un autre conseiller.',
                )}
              </p>
            </>
          )}
        </div>
      </PreviewCard>
    </>
  )
}

function InviteDialog({
  data,
  onClose,
  onInvited,
}: {
  readonly data: SettingsData
  readonly onClose: () => void
  readonly onInvited: (row: SettingsRow) => void
}) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<'agent' | 'supervisor'>('agent')
  const [teamIds, setTeamIds] = useState<string[]>([])

  return (
    <AccountDialog
      title={$t('Inviter un conseiller')}
      description={$t(
        'Son compte est créé maintenant, avec un lien à lui transmettre : il y choisira son mot de passe.',
      )}
      action={$t('Inviter')}
      ready={name.trim() !== '' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())}
      run={async () => {
        const invited = await api.inviteAgent({ name, email, role, teamIds })
        onInvited(invited.row)
        return invited.link
      }}
      onClose={onClose}
      done={<SignInHint email={email.trim()} />}
    >
      <InviteField label={$t('Nom')}>
        {(id) => (
          <Input
            id={id}
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={$t('Camille Durand')}
            maxLength={120}
            autoFocus
          />
        )}
      </InviteField>
      <InviteField label={$t('Adresse e-mail')}>
        {(id) => (
          <Input
            id={id}
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="camille.durand@exemple.fr"
            maxLength={254}
          />
        )}
      </InviteField>
      <InviteField label={$t('Rôle')}>
        {() => (
          <Segmented
            aria-label={$t('Rôle')}
            value={role}
            onValueChange={setRole}
            options={[
              { value: 'agent', label: $t('Conseiller') },
              { value: 'supervisor', label: $t('Superviseur') },
            ]}
            className="w-full"
          />
        )}
      </InviteField>
      <InviteField label={$t('Équipes')}>
        {() => (
          <Toggles
            value={teamIds}
            choices={data.rows('equipes').map((t) => ({ id: t.id, label: text(t.values.Nom) }))}
            onChange={setTeamIds}
            disabled={false}
          />
        )}
      </InviteField>
    </AccountDialog>
  )
}

function InviteField({
  label,
  children,
}: {
  readonly label: string
  readonly children: (id: string) => ReactNode
}) {
  const id = `invite-${label}`
  return (
    <div className="space-y-2">
      <Label htmlFor={id} className="text-foreground">
        {label}
      </Label>
      {children(id)}
    </div>
  )
}
