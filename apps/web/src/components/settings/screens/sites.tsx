'use client'

import { Chip } from '@/components/app/chip'
import { Input } from '@/components/ui/input'
import { Segmented } from '@/components/ui/segmented'
import { Textarea } from '@/components/ui/textarea'
import { $t, $tp, intlLocale, msg } from '@/lib/i18n'
import { useAddressTab } from '@/lib/use-address-tab'
import { cn } from '@/lib/utils'
import { ArrowUpRight, CalendarOff, Clock, Globe, Palette, Sparkles } from 'lucide-react'
import Link from 'next/link'
import { useState } from 'react'
import { ChoiceMenu } from '../field-input'
import { DayPicker, Field, FormSection, LinesField, RangeField, ToggleField } from '../kit/controls'
import {
  type SettingsData,
  type Values,
  bool,
  list,
  nameOf,
  num,
  one,
  text,
  useSettingsData,
} from '../kit/data'
import { useRowEditor } from '../kit/editor'
import { PreviewCard, Studio, StudioTabs } from '../kit/studio'
import { MonthGrid, type Slot, WeekGrid, openNow, weeklyHours } from '../kit/week'
import { WIDGET_FIELDS } from '../views'

/**
 * The sites, their hours and their closures. A site says where its conversations arrive
 * and how the AI behaves on it; its looks and words are the widget editor's. The preview
 * says it in a sentence, shows the AI's threshold, and draws the site's week.
 */

type Tab = 'sites' | 'hours' | 'closures'

const ZONES = [
  'Europe/Paris',
  'Europe/Brussels',
  'Europe/Zurich',
  'Europe/Luxembourg',
  'Europe/London',
  'Europe/Madrid',
  'Europe/Berlin',
  'America/Toronto',
  'America/Martinique',
  'America/Guadeloupe',
  'Indian/Reunion',
  'Pacific/Noumea',
  'Africa/Casablanca',
  'UTC',
]

const LANGUAGES = [
  { value: 'Français', label: msg('Français') },
  { value: 'English', label: msg('Anglais') },
  { value: 'Deutsch', label: msg('Allemand') },
  { value: 'Español', label: msg('Espagnol') },
] as const

const RETENTION = [30, 90, 180, 365, 730] as const

/** A domain as the widget checks it: the host, with its port if any — or `*.domain`. */
function domainOf(raw: string): string | null {
  const host = raw
    .trim()
    .toLowerCase()
    .replace(/^[a-z]+:\/\//, '')
    .replace(/\/.*$/, '')
  return /^(\*\.)?[a-z0-9-]+(\.[a-z0-9-]+)*(:\d{2,5})?$/.test(host) ? host : null
}

const slotOf = (key: string, values: Values, current = false): Slot => ({
  key,
  days: list(values.Jours),
  opens: text(values.Ouverture),
  closes: text(values.Fermeture),
  current,
})

const dateLabel = (iso: string) =>
  new Intl.DateTimeFormat(intlLocale(), { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(
    new Date(`${iso}T00:00:00Z`),
  )

export function SitesScreen() {
  const data = useSettingsData(['sites', 'horaires', 'fermetures', 'boites', 'equipes'])
  const [tab, setTab, tabBase] = useAddressTab<Tab>('/parametrage/sites', {
    sites: null,
    hours: 'horaires',
    closures: 'fermetures',
  })
  const sites = useRowEditor(data, 'sites', {
    defaults: {
      Langue: 'Français',
      'Fuseau horaire': 'Europe/Paris',
      'Agent IA actif': true,
      'Seuil de confiance (%)': 70,
      'Conservation (jours)': 365,
    },
  })
  const hours = useRowEditor(data, 'horaires', {
    defaults: {
      Jours: ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi'],
      Ouverture: '09:00',
      Fermeture: '18:00',
    },
  })
  const closures = useRowEditor(data, 'fermetures')
  const siteName = (id: string | null) =>
    id ? nameOf(data.table('sites'), data.rows('sites').find((s) => s.id === id)?.values ?? {}) : ''
  const siteChoices = data.rows('sites').map((s) => ({ id: s.id, label: text(s.values.Nom) }))

  const tabs = (
    <StudioTabs
      value={tab}
      onChange={setTab}
      tabs={[
        { value: 'sites', label: $t('Sites'), count: data.rows('sites').length },
        { value: 'hours', label: $t('Horaires'), count: data.rows('horaires').length },
        { value: 'closures', label: $t('Fermetures'), count: data.rows('fermetures').length },
      ]}
    />
  )
  const section = $t('Sites et horaires')

  if (tab === 'hours') {
    return (
      <Studio
        base={tabBase}
        section={section}
        data={data}
        editor={hours}
        tabs={tabs}
        nouns={{ fresh: $t('Nouveau créneau'), remove: $t('Supprimer le créneau') }}
        empty={{
          title: $t('Aucun horaire'),
          text: $t('Sans créneau, personne n’est jamais là : l’IA répond seule et le dit.'),
        }}
        used={['Créneau', 'Jours', 'Ouverture', 'Fermeture', 'Site']}
        item={(_row, values) => (
          <>
            <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-muted">
              <Clock className="size-3.5 text-muted-foreground" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-medium">
                {text(values.Créneau) || $t('Nouveau créneau')}
              </span>
              <span className="block truncate text-[11px] text-muted-foreground tabular-nums">
                {daysLabel(list(values.Jours))} · {text(values.Ouverture)}–{text(values.Fermeture)}
              </span>
            </span>
          </>
        )}
        form={(values) => (
          <>
            <FormSection title={$t('Le créneau')}>
              <Field label={$t('Nom')} required hint={$t('Libre : « Semaine », « Samedi matin »…')}>
                {(id) => (
                  <Input
                    id={id}
                    value={text(values.Créneau)}
                    onChange={(e) => hours.set('Créneau', e.target.value)}
                    maxLength={60}
                  />
                )}
              </Field>
              <Field label={$t('Jours')}>
                {() => (
                  <DayPicker
                    value={list(values.Jours)}
                    onChange={(days) => hours.set('Jours', days)}
                    disabled={!data.canEdit}
                  />
                )}
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label={$t('Ouverture')}>
                  {(id) => (
                    <Input
                      id={id}
                      type="time"
                      value={text(values.Ouverture)}
                      onChange={(e) => hours.set('Ouverture', e.target.value)}
                    />
                  )}
                </Field>
                <Field label={$t('Fermeture')}>
                  {(id) => (
                    <Input
                      id={id}
                      type="time"
                      value={text(values.Fermeture)}
                      onChange={(e) => hours.set('Fermeture', e.target.value)}
                    />
                  )}
                </Field>
              </div>
              {text(values.Ouverture) >= text(values.Fermeture) &&
                text(values.Fermeture) !== '' && (
                  <p className="text-xs text-amber-700 dark:text-amber-400">
                    {$t('La fermeture doit venir après l’ouverture, le même jour.')}
                  </p>
                )}
            </FormSection>
            <FormSection title={$t('Pour quel site')}>
              <Field label={$t('Site')} hint={$t('Aucun : le créneau vaut pour tous les sites.')}>
                {(id) => (
                  <ChoiceMenu
                    id={id}
                    value={one(values.Site)}
                    choices={siteChoices}
                    onChange={(v) => hours.set('Site', v)}
                    allowNone
                    disabled={!data.canEdit}
                  />
                )}
              </Field>
            </FormSection>
          </>
        )}
        preview={(values) => {
          const site = one(values.Site)
          const slots = data
            .rows('horaires')
            .filter(
              (r) =>
                r.id !== hours.selectedId &&
                (one(r.values.Site) === null || one(r.values.Site) === site || site === null),
            )
            .map((r) => slotOf(r.id, r.values))
          const all = [...slots, slotOf('current', values, true)]
          return (
            <>
              <PreviewCard
                label={$t('La semaine')}
                hint={site ? siteName(site) : $t('Tous les sites')}
              >
                <div className="p-5">
                  <WeekGrid slots={all} />
                </div>
                <div className="flex items-center justify-between border-t px-5 py-3 text-xs text-muted-foreground">
                  <span>
                    {$t('Ouvert {hours} h par semaine', {
                      hours: weeklyHours(all).toLocaleString(intlLocale()),
                    })}
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="size-2 rounded-sm bg-primary" />
                    {$t('Ce créneau')}
                  </span>
                </div>
              </PreviewCard>
              <PreviewCard label={$t('Hors de ces heures')}>
                <WidgetBubble>
                  {$t(
                    'Nos conseillers sont absents pour le moment. Je réponds à vos questions, et un conseiller reprendra votre demande à la réouverture.',
                  )}
                </WidgetBubble>
              </PreviewCard>
            </>
          )
        }}
      />
    )
  }

  if (tab === 'closures') {
    return (
      <Studio
        base={tabBase}
        section={section}
        data={data}
        editor={closures}
        tabs={tabs}
        nouns={{ fresh: $t('Nouvelle fermeture'), remove: $t('Supprimer la fermeture') }}
        empty={{
          title: $t('Aucune fermeture prévue'),
          text: $t(
            'Jours fériés, fermetures, événements : ces jours-là, personne ne répond, horaires ou pas.',
          ),
        }}
        used={['Motif', 'Du', 'Au', 'Message aux visiteurs', 'Site']}
        item={(_row, values) => (
          <>
            <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-muted">
              <CalendarOff className="size-3.5 text-muted-foreground" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-medium">
                {text(values.Motif) || $t('Nouvelle fermeture')}
              </span>
              <span className="block truncate text-[11px] text-muted-foreground">
                {text(values.Du)
                  ? text(values.Au) && text(values.Au) !== text(values.Du)
                    ? `${dateLabel(text(values.Du))} → ${dateLabel(text(values.Au))}`
                    : dateLabel(text(values.Du))
                  : $t('Date à choisir')}
              </span>
            </span>
          </>
        )}
        form={(values) => (
          <>
            <FormSection title={$t('La fermeture')}>
              <Field label={$t('Motif')} required hint={$t('Par exemple « Noël ».')}>
                {(id) => (
                  <Input
                    id={id}
                    value={text(values.Motif)}
                    onChange={(e) => closures.set('Motif', e.target.value)}
                    maxLength={80}
                  />
                )}
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label={$t('Du')}>
                  {(id) => (
                    <Input
                      id={id}
                      type="date"
                      value={text(values.Du)}
                      onChange={(e) => closures.set('Du', e.target.value || null)}
                    />
                  )}
                </Field>
                <Field label={$t('Au')} hint={$t('Vide : un seul jour.')}>
                  {(id) => (
                    <Input
                      id={id}
                      type="date"
                      value={text(values.Au)}
                      min={text(values.Du) || undefined}
                      onChange={(e) => closures.set('Au', e.target.value || null)}
                    />
                  )}
                </Field>
              </div>
            </FormSection>
            <FormSection title={$t('Ce que dit le widget')}>
              <Field
                label={$t('Message aux visiteurs')}
                hint={$t('Vide : le message habituel hors horaires.')}
              >
                {(id) => (
                  <Textarea
                    id={id}
                    rows={4}
                    value={text(values['Message aux visiteurs'])}
                    onChange={(e) => closures.set('Message aux visiteurs', e.target.value)}
                    placeholder={$t('Nous sommes fermés aujourd’hui…')}
                  />
                )}
              </Field>
              <Field label={$t('Site')} hint={$t('Aucun : tous les sites sont fermés.')}>
                {(id) => (
                  <ChoiceMenu
                    id={id}
                    value={one(values.Site)}
                    choices={siteChoices}
                    onChange={(v) => closures.set('Site', v)}
                    allowNone
                    disabled={!data.canEdit}
                  />
                )}
              </Field>
            </FormSection>
          </>
        )}
        preview={(values) => {
          const from = text(values.Du)
          const to = text(values.Au) || from
          return (
            <>
              <PreviewCard
                label={$t('Au calendrier')}
                hint={one(values.Site) ? siteName(one(values.Site)) : $t('Tous les sites')}
              >
                <div className="grid gap-6 p-5 sm:grid-cols-2">
                  {from ? (
                    <>
                      <MonthGrid month={from} from={from} to={to} />
                      {to.slice(0, 7) !== from.slice(0, 7) && (
                        <MonthGrid month={to} from={from} to={to} />
                      )}
                    </>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      {$t('Choisissez le premier jour fermé.')}
                    </p>
                  )}
                </div>
              </PreviewCard>
              <PreviewCard label={$t('Ces jours-là, le widget')}>
                <WidgetBubble>
                  {text(values['Message aux visiteurs']) ||
                    $t(
                      'Nos conseillers sont absents pour le moment. Je réponds à vos questions, et un conseiller reprendra votre demande à la réouverture.',
                    )}
                </WidgetBubble>
              </PreviewCard>
            </>
          )
        }}
      />
    )
  }

  return (
    <Studio
      base={tabBase}
      section={section}
      data={data}
      editor={sites}
      tabs={tabs}
      nouns={{ fresh: $t('Nouveau site'), remove: $t('Supprimer le site') }}
      empty={{
        title: $t('Aucun site'),
        text: $t('Un site, ou une marque, qui embarque le widget de chat.'),
      }}
      used={[
        'Nom',
        'Domaines autorisés',
        'Langue',
        'Fuseau horaire',
        'Agent IA actif',
        'Seuil de confiance (%)',
        "Consignes de l'agent IA",
        'Conservation (jours)',
        'Boîte de réception',
        'Équipe par défaut',
      ]}
      elsewhere={[...WIDGET_FIELDS, "Message d'accueil"]}
      item={(_row, values) => (
        <>
          <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-muted">
            <Globe className="size-3.5 text-muted-foreground" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-medium">
              {text(values.Nom) || $t('Nouveau site')}
            </span>
            <span className="block truncate font-mono text-[11px] text-muted-foreground">
              {text(values['Domaines autorisés']).split('\n')[0] || $t('Aucun domaine')}
            </span>
          </span>
        </>
      )}
      form={(values) => <SiteForm data={data} values={values} set={sites.set} />}
      preview={(values) => <SitePreview data={data} values={values} id={sites.selectedId} />}
    />
  )
}

function daysLabel(days: readonly string[]): string {
  const week = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi']
  if (days.length === 7) return $t('Tous les jours')
  if (days.length === 5 && week.every((d) => days.includes(d))) return $t('En semaine')
  return days.map((d) => $t(d).slice(0, 3)).join(', ') || $t('Aucun jour')
}

function SiteForm({
  data,
  values,
  set,
}: {
  readonly data: SettingsData
  readonly values: Values
  readonly set: (label: string, value: unknown) => void
}) {
  const zone = text(values['Fuseau horaire'])
  const threshold = num(values['Seuil de confiance (%)']) ?? 70
  const retention = num(values['Conservation (jours)'])
  const presets: number[] = [...RETENTION]
  if (retention !== null && !presets.includes(retention)) presets.push(retention)

  return (
    <>
      <FormSection title={$t('Le site')}>
        <Field label={$t('Nom')} required hint={$t('Affiché en tête du widget.')}>
          {(id) => (
            <Input
              id={id}
              value={text(values.Nom)}
              onChange={(e) => set('Nom', e.target.value)}
              maxLength={60}
            />
          )}
        </Field>
        <Field
          label={$t('Domaines autorisés')}
          hint={$t(
            'Le widget refuse de s’afficher ailleurs. Entrée pour ajouter ; *.exemple.fr vaut pour les sous-domaines.',
          )}
        >
          {(id) => (
            <LinesField
              id={id}
              value={text(values['Domaines autorisés'])}
              onChange={(v) => set('Domaines autorisés', v)}
              placeholder="www.exemple.fr"
              check={domainOf}
              disabled={!data.canEdit}
            />
          )}
        </Field>
        <Field label={$t('Langue du widget')}>
          {() => (
            <Segmented
              aria-label={$t('Langue du widget')}
              value={text(values.Langue) || 'Français'}
              onValueChange={(v) => set('Langue', v)}
              options={LANGUAGES.map((l) => ({ value: l.value, label: $t(l.label) }))}
              disabled={!data.canEdit}
              className="w-full"
            />
          )}
        </Field>
        <Field label={$t('Fuseau horaire')} hint={$t('Les horaires d’ouverture s’y lisent.')}>
          {(id) => (
            <ChoiceMenu
              id={id}
              value={zone || null}
              choices={(ZONES.includes(zone) || !zone ? ZONES : [zone, ...ZONES]).map((z) => ({
                id: z,
                label: z.replace('_', ' '),
              }))}
              onChange={(v) => set('Fuseau horaire', v)}
              allowNone={false}
              disabled={!data.canEdit}
            />
          )}
        </Field>
      </FormSection>

      <FormSection title={$t('Où arrivent ses conversations')}>
        <Field label={$t('Boîte de réception')} hint={$t('Aucune : la première boîte active.')}>
          {(id) => (
            <ChoiceMenu
              id={id}
              value={one(values['Boîte de réception'])}
              choices={data.rows('boites').map((b) => ({ id: b.id, label: text(b.values.Nom) }))}
              onChange={(v) => set('Boîte de réception', v)}
              allowNone
              disabled={!data.canEdit}
            />
          )}
        </Field>
        <Field
          label={$t('Équipe par défaut')}
          hint={$t('Celle qui reçoit les conversations que l’IA transfère.')}
        >
          {(id) => (
            <ChoiceMenu
              id={id}
              value={one(values['Équipe par défaut'])}
              choices={data.rows('equipes').map((t) => ({ id: t.id, label: text(t.values.Nom) }))}
              onChange={(v) => set('Équipe par défaut', v)}
              allowNone
              disabled={!data.canEdit}
            />
          )}
        </Field>
      </FormSection>

      <FormSection title={$t('L’agent IA')}>
        <ToggleField
          label={$t('L’IA répond en premier')}
          hint={$t('Désactivé : chaque conversation va directement à un conseiller.')}
          checked={bool(values['Agent IA actif'])}
          onChange={(on) => set('Agent IA actif', on)}
          disabled={!data.canEdit}
        >
          <Field
            label={$t('Seuil de confiance')}
            hint={$t(
              'En dessous, l’IA ne répond pas seule : elle passe la main à un conseiller, avec un résumé.',
            )}
          >
            {(id) => (
              <RangeField
                id={id}
                value={threshold}
                min={0}
                max={100}
                step={5}
                onChange={(n) => set('Seuil de confiance (%)', n)}
                format={(n) => `${n} %`}
                disabled={!data.canEdit}
              />
            )}
          </Field>
          <Field
            label={$t('Consignes')}
            hint={$t('Le ton, ce qu’elle doit toujours dire, ce qu’elle ne doit jamais promettre.')}
          >
            {(id) => (
              <Textarea
                id={id}
                rows={6}
                value={text(values["Consignes de l'agent IA"])}
                onChange={(e) => set("Consignes de l'agent IA", e.target.value)}
                placeholder={$t('Vouvoyez. Ne promettez jamais de délai de remboursement.')}
              />
            )}
          </Field>
        </ToggleField>
      </FormSection>

      <FormSection title={$t('Conservation')}>
        <Field
          label={$t('Purger les conversations après')}
          hint={$t('Avec leurs pièces jointes et leurs extraits indexés pour l’IA.')}
        >
          {() => (
            <Segmented
              aria-label={$t('Purger les conversations après')}
              value={String(retention ?? 365)}
              onValueChange={(v) => set('Conservation (jours)', Number(v))}
              options={presets.map((d) => ({ value: String(d), label: durationLabel(d) }))}
              disabled={!data.canEdit}
              className="w-full"
            />
          )}
        </Field>
      </FormSection>

      <div className="border-t px-6 py-5">
        <Link
          href="/widget"
          className="group flex items-center gap-3 rounded-lg border px-3.5 py-3 transition-colors hover:bg-muted/50"
        >
          <span className="flex size-8 items-center justify-center rounded-lg bg-muted">
            <Palette className="size-4 text-muted-foreground" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium">{$t('Apparence et textes du widget')}</span>
            <span className="block text-xs text-muted-foreground">
              {$t('Couleur, position, message d’accueil…')}
            </span>
          </span>
          <ArrowUpRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
        </Link>
      </div>
    </>
  )
}

function durationLabel(days: number): string {
  if (days % 365 === 0) return $tp(days / 365, '{count} an', '{count} ans')
  if (days % 30 === 0) return $tp(days / 30, '{count} mois', '{count} mois')
  return $tp(days, '{count} jour', '{count} jours')
}

function SitePreview({
  data,
  values,
  id,
}: {
  readonly data: SettingsData
  readonly values: Values
  readonly id: string | null
}) {
  const name = text(values.Nom) || $t('Ce site')
  const ai = bool(values['Agent IA actif'])
  const threshold = num(values['Seuil de confiance (%)']) ?? 70
  const inbox = data.rows('boites').find((b) => b.id === one(values['Boîte de réception']))
  const firstInbox = data.rows('boites').find((b) => bool(b.values.Actif))
  const arriving = inbox ?? firstInbox
  const team = data.rows('equipes').find((t) => t.id === one(values['Équipe par défaut']))
  const slots = data
    .rows('horaires')
    .filter((r) => one(r.values.Site) === null || one(r.values.Site) === id)
    .map((r) => slotOf(r.id, r.values))
  const open = openNow(slots, text(values['Fuseau horaire']))
  const today = new Date().toISOString().slice(0, 10)
  const closures = data
    .rows('fermetures')
    .filter(
      (r) =>
        (one(r.values.Site) === null || one(r.values.Site) === id) &&
        (text(r.values.Au) || text(r.values.Du)) >= today,
    )
    .sort((a, b) => text(a.values.Du).localeCompare(text(b.values.Du)))
    .slice(0, 3)

  return (
    <>
      <PreviewCard label={$t('En une phrase')}>
        <p className="p-5 text-[15px] leading-relaxed">
          {$t('Les conversations de {site} arrivent dans {inbox}.', {
            site: name,
            inbox: text(arriving?.values.Nom) || $t('la première boîte active'),
          })}{' '}
          {ai
            ? $t(
                'L’IA répond en premier ; sous {threshold} % de confiance, elle passe la main à {team}, avec un résumé.',
                {
                  threshold,
                  team: text(team?.values.Nom) || $t('l’équipe de la boîte'),
                },
              )
            : $t('Pas d’IA : un conseiller répond à chaque conversation.')}
        </p>
      </PreviewCard>

      {ai && (
        <PreviewCard label={$t('Qui répond, selon la confiance de l’IA')}>
          <div className="space-y-3 p-5">
            <div className="relative h-9 overflow-hidden rounded-lg border">
              <div
                className="absolute inset-y-0 left-0 flex items-center justify-center bg-amber-500/15 text-[11px] font-medium text-amber-800 transition-[width] duration-300 dark:text-amber-300"
                style={{ width: `${threshold}%` }}
              >
                {threshold >= 25 && $t('Un conseiller')}
              </div>
              <div
                className="absolute inset-y-0 right-0 flex items-center justify-center bg-violet-500/15 text-[11px] font-medium text-violet-800 transition-[width] duration-300 dark:text-violet-300"
                style={{ width: `${100 - threshold}%` }}
              >
                {threshold <= 75 && (
                  <span className="flex items-center gap-1">
                    <Sparkles className="size-3" />
                    {$t('L’IA seule')}
                  </span>
                )}
              </div>
              <div
                className="absolute inset-y-0 w-0.5 bg-foreground transition-[left] duration-300"
                style={{ left: `${threshold}%` }}
              />
            </div>
            <div className="flex justify-between text-[10px] text-muted-foreground tabular-nums">
              <span>0 %</span>
              <span>{threshold} %</span>
              <span>100 %</span>
            </div>
          </div>
        </PreviewCard>
      )}

      <PreviewCard
        label={$t('Sa semaine')}
        hint={
          <span
            className={cn(
              'inline-flex items-center gap-1.5',
              open ? 'text-emerald-700 dark:text-emerald-400' : '',
            )}
          >
            <span
              className={cn(
                'size-1.5 rounded-full',
                open ? 'bg-emerald-500' : 'bg-muted-foreground/50',
              )}
            />
            {open ? $t('Ouvert maintenant') : $t('Fermé maintenant')}
          </span>
        }
      >
        <div className="p-5">
          {slots.length > 0 ? (
            <WeekGrid slots={slots} />
          ) : (
            <p className="text-sm text-muted-foreground">
              {$t('Aucun créneau : l’IA répond seule, à toute heure.')}
            </p>
          )}
        </div>
        {closures.length > 0 && (
          <div className="space-y-1.5 border-t px-5 py-3">
            {closures.map((c) => (
              <div key={c.id} className="flex items-center gap-2 text-xs">
                <CalendarOff className="size-3.5 text-muted-foreground" />
                <span className="flex-1 truncate">{text(c.values.Motif)}</span>
                <Chip tint="zinc">
                  {text(c.values.Au) && text(c.values.Au) !== text(c.values.Du)
                    ? `${dateLabel(text(c.values.Du))} → ${dateLabel(text(c.values.Au))}`
                    : dateLabel(text(c.values.Du))}
                </Chip>
              </div>
            ))}
          </div>
        )}
      </PreviewCard>
    </>
  )
}

/** A message of the widget's, as the visitor reads it. */
function WidgetBubble({ children }: { readonly children: React.ReactNode }) {
  return (
    <div className="bg-muted/30 p-5">
      <div className="flex items-end gap-2">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-violet-500/15">
          <Sparkles className="size-3.5 text-violet-700 dark:text-violet-300" />
        </span>
        <p className="max-w-[85%] rounded-2xl rounded-bl-md border bg-background px-3.5 py-2.5 text-sm leading-relaxed">
          {children}
        </p>
      </div>
    </div>
  )
}
