'use client'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Segmented } from '@/components/ui/segmented'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { $t } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import type { WidgetAppearance, WidgetEditorSite, WidgetSettings } from '@chat/contracts'
import { ArrowUpRight, Check, Copy, ExternalLink, Plus, X } from 'lucide-react'
import Link from 'next/link'
import { type ReactNode, useId, useState } from 'react'
import { PageActions } from './page-actions'
import { type Problems, contrastOn } from './settings'

/**
 * The editor's fields, in four tabs: how the widget looks, what it says, when it shows,
 * and how a site installs it. Every change goes to the preview at once; nothing is saved
 * until « Enregistrer ».
 */

export const SWATCHES = [
  '#2563EB',
  '#7C3AED',
  '#DB2777',
  '#DC2626',
  '#EA580C',
  '#CA8A04',
  '#16A34A',
  '#0D9488',
  '#18181B',
] as const

const MAX_SUGGESTIONS = 6

/** The page's API, as a site's developer copies it — code, so not translated. */
const API_EXAMPLE = [
  'MessagerieChat.open()            // .close() .toggle() .show() .hide()',
  "MessagerieChat.setMessage('Bonjour, je souhaite…')   // prérempli, pas envoyé",
  "MessagerieChat.send('Bonjour')",
  "MessagerieChat.setUser({ name: 'Léa Martin', email: 'lea@exemple.fr', phone: '06…' })",
  "MessagerieChat.setContactData({ Abonnement: 'Pro' })",
  "MessagerieChat.setConversationData({ Commande: 'A-1042', 'Panier (€)': 89.9 })",
  'MessagerieChat.reset()           // nouvelle conversation ; { visitor: true } : nouveau visiteur',
  "MessagerieChat.on('message:received', (message) => { … })",
  '// événements : ready, open, close, message:sent, message:received, reset',
].join('\n')

/** An action of the page (D21), as a site's developer copies it. */
const ACTION_EXAMPLE = [
  "MessagerieChat.registerAction('tarifer', {",
  "  label: 'Calculer un tarif',",
  "  description: 'Le prix mensuel et annuel pour la valeur d’achat d’un appareil',",
  "  parameters: { type: 'object', properties: { valeur: { type: 'number' } }, required: ['valeur'] },",
  "  kind: 'read',          // 'read' : cherche ; 'do' : change la page",
  '  confirm: false,        // true : le visiteur accepte d’abord',
  '  handler: ({ valeur }) => tarifer(valeur),   // ce que renvoie la page, l’IA le lit',
  '})',
  "MessagerieChat.unregisterAction('tarifer')",
].join('\n')

const CONTEXT_EXAMPLE = [
  'MessagerieChat.setPageContext(() => ({',
  "  etape: 'souscription',",
  '  panier: panier.map((a) => ({ modele: a.modele, valeur: a.valeur })),',
  '}))',
].join('\n')

const QUEUE_EXAMPLE = [
  'window.MessagerieChat = window.MessagerieChat || []',
  "MessagerieChat.push(['setConversationData', { Page: location.pathname }])",
  "MessagerieChat.push(['on', 'open', () => analytics.track('chat_open')])",
].join('\n')

export function WidgetForm({
  site,
  draft,
  problems,
  onChange,
  server,
}: {
  readonly site: WidgetEditorSite
  readonly draft: WidgetSettings
  readonly problems: Problems
  /** Changes the draft — from its latest state, so that quick changes add up. */
  readonly onChange: (update: (draft: WidgetSettings) => WidgetSettings) => void
  /** The chat server's address, for the installation snippet. */
  readonly server: string
}) {
  const look = draft.appearance
  const set = (patch: Partial<WidgetSettings>) => onChange((d) => ({ ...d, ...patch }))
  const setLook = (patch: Partial<WidgetAppearance>) =>
    onChange((d) => ({ ...d, appearance: { ...d.appearance, ...patch } }))
  const contrast = contrastOn(draft.color)

  return (
    <Tabs defaultValue="look" className="gap-0">
      <TabsList className="sticky top-0 z-10 w-full bg-background px-5">
        <TabsTrigger value="look">{$t('Apparence')}</TabsTrigger>
        <TabsTrigger value="words">{$t('Textes')}</TabsTrigger>
        <TabsTrigger value="display">{$t('Affichage')}</TabsTrigger>
        <TabsTrigger value="install">{$t('Installation')}</TabsTrigger>
        <TabsTrigger value="actions">{$t('Actions')}</TabsTrigger>
      </TabsList>

      <TabsContent value="look" className="space-y-7 px-5 py-5">
        <Field
          label={$t('Couleur')}
          hint={
            contrast !== null && contrast < 4.5
              ? $t(
                  'Contraste de {ratio}:1 avec le texte du bandeau : visez au moins 4,5:1 pour qu’il se lise.',
                  { ratio: contrast.toFixed(1).replace('.', ',') },
                )
              : $t('La couleur du bouton, du bandeau et des messages du visiteur.')
          }
          warn={contrast !== null && contrast < 4.5}
        >
          {(id) => (
            <div className="space-y-2.5">
              <div className="flex flex-wrap gap-1.5">
                {SWATCHES.map((color) => {
                  const chosen = draft.color.toUpperCase() === color
                  return (
                    <button
                      key={color}
                      type="button"
                      aria-label={color}
                      aria-pressed={chosen}
                      onClick={() => set({ color })}
                      className={cn(
                        'flex size-7 items-center justify-center rounded-full ring-offset-2 ring-offset-background transition-shadow',
                        chosen ? 'ring-2 ring-foreground/70' : 'hover:ring-2 hover:ring-border',
                      )}
                      style={{ background: color }}
                    >
                      {chosen && <Check className="size-3.5 text-white" strokeWidth={3} />}
                    </button>
                  )
                })}
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  aria-label={$t('Choisir une autre couleur')}
                  value={/^#[0-9a-f]{6}$/i.test(draft.color) ? draft.color : '#000000'}
                  onChange={(event) => set({ color: event.target.value.toUpperCase() })}
                  className="size-9 shrink-0 cursor-pointer rounded-md border bg-transparent p-1"
                />
                <Input
                  id={id}
                  value={draft.color}
                  onChange={(event) => set({ color: event.target.value.trim() })}
                  aria-invalid={problems.color}
                  className="w-32 font-mono uppercase"
                  maxLength={7}
                />
              </div>
            </div>
          )}
        </Field>

        <Field label={$t('Thème')}>
          {() => (
            <Segmented
              aria-label={$t('Thème')}
              value={look.theme}
              onValueChange={(theme) => setLook({ theme })}
              options={[
                { value: 'auto', label: $t('Automatique') },
                { value: 'light', label: $t('Clair') },
                { value: 'dark', label: $t('Sombre') },
              ]}
              className="w-full"
            />
          )}
        </Field>

        <Field label={$t('Coins')}>
          {() => (
            <Segmented
              aria-label={$t('Coins')}
              value={look.corners}
              onValueChange={(corners) => setLook({ corners })}
              options={[
                { value: 'round', label: $t('Arrondis') },
                { value: 'soft', label: $t('Adoucis') },
                { value: 'square', label: $t('Droits') },
              ]}
              className="w-full"
            />
          )}
        </Field>

        <Field
          label={$t('Police')}
          hint={
            look.font === 'site'
              ? $t(
                  'Celle du texte de la page où le widget s’affiche. Le widget ne charge aucune police.',
                )
              : look.font === 'custom'
                ? $t('Le nom d’une police que le site charge déjà, par exemple Inter.')
                : $t(
                    'Le widget ne charge aucune police : il prend celle de l’appareil qui s’en approche.',
                  )
          }
        >
          {(id) => (
            <div className="space-y-2">
              <Segmented
                aria-label={$t('Police')}
                value={look.font}
                onValueChange={(font) => setLook({ font })}
                options={[
                  { value: 'site', label: $t('Du site') },
                  { value: 'system', label: $t('Système') },
                  { value: 'rounded', label: $t('Arrondie') },
                  { value: 'serif', label: $t('Serif') },
                  { value: 'custom', label: $t('Autre') },
                ]}
                className="w-full"
              />
              {look.font === 'custom' && (
                <Input
                  id={id}
                  value={look.customFont ?? ''}
                  placeholder="Inter"
                  onChange={(event) => setLook({ customFont: event.target.value })}
                  aria-invalid={problems.customFont}
                  maxLength={60}
                />
              )}
            </div>
          )}
        </Field>

        <Field label={$t('Logo')} hint={$t('Adresse https d’une image carrée, en tête du widget.')}>
          {(id) => (
            <Input
              id={id}
              value={look.logo ?? ''}
              placeholder="https://"
              onChange={(event) => setLook({ logo: event.target.value })}
              aria-invalid={problems.logo}
              maxLength={500}
            />
          )}
        </Field>

        <Toggle
          label={$t('Montrer l’équipe')}
          hint={
            site.team.length > 0
              ? $t('Les initiales de {names}, en tête du widget.', {
                  names: site.team.join(', '),
                })
              : $t('Les initiales des conseillers actifs, en tête du widget.')
          }
          checked={look.showTeam}
          onChange={(showTeam) => setLook({ showTeam })}
        />

        <Section title={$t('Bouton et position')}>
          <Field label={$t('Côté')}>
            {() => (
              <Segmented
                aria-label={$t('Côté')}
                value={look.position}
                onValueChange={(position) => setLook({ position })}
                options={[
                  { value: 'left', label: $t('En bas à gauche') },
                  { value: 'right', label: $t('En bas à droite') },
                ]}
                className="w-full"
              />
            )}
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label={$t('Marge latérale')}>
              {(id) => (
                <Pixels
                  id={id}
                  value={look.offsetX}
                  invalid={problems.offsetX}
                  onChange={(offsetX) => setLook({ offsetX })}
                />
              )}
            </Field>
            <Field label={$t('Marge du bas')}>
              {(id) => (
                <Pixels
                  id={id}
                  value={look.offsetY}
                  invalid={problems.offsetY}
                  onChange={(offsetY) => setLook({ offsetY })}
                />
              )}
            </Field>
          </div>

          <Field label={$t('Bouton')}>
            {(id) => (
              <div className="space-y-2">
                <Segmented
                  aria-label={$t('Bouton')}
                  value={look.launcher}
                  onValueChange={(launcher) => setLook({ launcher })}
                  options={[
                    { value: 'round', label: $t('Rond') },
                    { value: 'label', label: $t('Avec libellé') },
                  ]}
                  className="w-full"
                />
                {look.launcher === 'label' && (
                  <Input
                    id={id}
                    value={look.launcherLabel ?? ''}
                    placeholder={$t('Une question ?')}
                    onChange={(event) => setLook({ launcherLabel: event.target.value })}
                    maxLength={40}
                  />
                )}
              </div>
            )}
          </Field>
        </Section>
      </TabsContent>

      <TabsContent value="words" className="space-y-7 px-5 py-5">
        <Field label={$t('Nom affiché')}>
          {(id) => (
            <Input
              id={id}
              value={draft.name}
              onChange={(event) => set({ name: event.target.value })}
              aria-invalid={problems.name}
              maxLength={80}
            />
          )}
        </Field>

        <Field label={$t('Langue du widget')}>
          {() => (
            <Segmented
              aria-label={$t('Langue du widget')}
              value={draft.language}
              onValueChange={(language) => set({ language })}
              options={[
                { value: 'fr', label: 'Français' },
                { value: 'en', label: 'English' },
                { value: 'de', label: 'Deutsch' },
                { value: 'es', label: 'Español' },
              ]}
              className="w-full"
            />
          )}
        </Field>

        <Field
          label={$t('Titre d’accueil')}
          hint={$t(
            '{prénom} devient le prénom d’un client connecté, et disparaît pour un visiteur anonyme.',
          )}
        >
          {(id) => (
            <Input
              id={id}
              value={draft.title ?? ''}
              placeholder={$t('Comment pouvons-nous vous aider ?')}
              onChange={(event) => set({ title: event.target.value })}
              maxLength={120}
            />
          )}
        </Field>

        <Field
          label={$t('Sous-titre')}
          hint={$t('Vide : une phrase qui dit qui répond, l’IA ou les conseillers.')}
        >
          {(id) => (
            <Textarea
              id={id}
              value={draft.tagline ?? ''}
              onChange={(event) => set({ tagline: event.target.value })}
              maxLength={300}
              rows={2}
            />
          )}
        </Field>

        <Field
          label={$t('Message d’accueil')}
          hint={$t('Le premier message du fil. Le gras, les listes et les liens s’affichent.')}
        >
          {(id) => (
            <Textarea
              id={id}
              value={draft.welcome ?? ''}
              placeholder={$t('Bonjour ! Comment pouvons-nous vous aider ?')}
              onChange={(event) => set({ welcome: event.target.value })}
              maxLength={1000}
              rows={3}
            />
          )}
        </Field>

        <Field
          label={$t('Questions suggérées')}
          hint={$t('Proposées d’un clic avant que le visiteur écrive — six au plus.')}
        >
          {() => (
            <div className="space-y-1.5">
              {draft.suggestions.map((question, index) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: a question is edited in place, by its position
                <div key={index} className="flex items-center gap-1.5">
                  <Input
                    value={question}
                    aria-label={$t('Question {n}', { n: index + 1 })}
                    onChange={(event) => {
                      const text = event.target.value.replace(/\n/g, ' ')
                      onChange((d) => ({
                        ...d,
                        suggestions: d.suggestions.map((q, i) => (i === index ? text : q)),
                      }))
                    }}
                    maxLength={120}
                  />
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={$t('Retirer la question')}
                    onClick={() =>
                      onChange((d) => ({
                        ...d,
                        suggestions: d.suggestions.filter((_, i) => i !== index),
                      }))
                    }
                  >
                    <X className="text-muted-foreground" />
                  </Button>
                </div>
              ))}
              {draft.suggestions.length < MAX_SUGGESTIONS && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 gap-1.5 px-2 text-xs text-muted-foreground"
                  onClick={() => onChange((d) => ({ ...d, suggestions: [...d.suggestions, ''] }))}
                >
                  <Plus className="size-3.5" />
                  {$t('Ajouter une question')}
                </Button>
              )}
            </div>
          )}
        </Field>
      </TabsContent>

      <TabsContent value="display" className="space-y-6 px-5 py-5">
        <Toggle
          label={$t('Bulle d’accueil')}
          hint={$t(
            'Le message d’accueil apparaît à côté du bouton, sans ouvrir le widget, une fois par visite.',
          )}
          checked={look.nudgeAfter !== null}
          onChange={(on) => setLook({ nudgeAfter: on ? 5 : null })}
        >
          {look.nudgeAfter !== null && (
            <div className="mt-2.5 flex items-center gap-2 text-sm text-muted-foreground">
              {$t('Après')}
              <Input
                type="number"
                min={0}
                max={600}
                value={look.nudgeAfter}
                aria-label={$t('Délai en secondes')}
                aria-invalid={problems.nudgeAfter}
                onChange={(event) =>
                  setLook({ nudgeAfter: Math.round(Number(event.target.value) || 0) })
                }
                className="h-8 w-20"
              />
              {$t('secondes')}
            </div>
          )}
        </Toggle>
        <Toggle
          label={$t('Masquer sur mobile')}
          hint={$t('Aucun widget sur un écran de moins de 480 pixels.')}
          checked={look.hideOnMobile}
          onChange={(hideOnMobile) => setLook({ hideOnMobile })}
        />
        <Toggle
          label={$t('Masquer quand personne ne répond')}
          hint={
            site.ai
              ? $t('Sans effet ici : l’IA répond à toute heure sur ce site.')
              : $t('Hors des horaires d’ouverture, le widget ne s’affiche pas.')
          }
          checked={look.hideWhenAway}
          onChange={(hideWhenAway) => setLook({ hideWhenAway })}
        />
        <Toggle
          label={$t('Mention « Propulsé par Messagerie »')}
          hint={$t('En pied du widget.')}
          checked={look.branding}
          onChange={(branding) => setLook({ branding })}
        />
      </TabsContent>

      <TabsContent value="install" className="space-y-7 px-5 py-5">
        <Snippet
          title={$t('Sur chaque page du site')}
          hint={$t('Avant la fin de la balise body. Rien d’autre à charger.')}
          code={`<script src="${server}/widget.js" data-site="${site.id}" async></script>`}
        />

        <div className="space-y-2">
          <div className="text-sm font-medium">{$t('Domaines autorisés')}</div>
          {site.domains.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              {$t(
                'Aucun : le widget ne s’affiche nulle part. Ajoutez-les dans « Sites et horaires ».',
              )}
            </p>
          ) : (
            <ul className="flex flex-wrap gap-1.5">
              {site.domains.map((domain) => (
                <li key={domain} className="rounded-md border px-2 py-0.5 font-mono text-xs">
                  {domain}
                </li>
              ))}
            </ul>
          )}
          <Link
            href="/parametrage/sites"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <ArrowUpRight className="size-3" />
            {$t('Modifier dans « Sites et horaires »')}
          </Link>
        </div>

        <Snippet
          title={$t('Pour un client connecté au site')}
          hint={$t(
            'Le serveur du site signe l’identité du client (JWT HS256, avec le secret du site) : le widget le reconnaît, et l’IA peut consulter sa fiche.',
          )}
          code={`<script src="${server}/widget.js" data-site="${site.id}"\n        data-identity="<jeton signé par votre serveur>" async></script>`}
        />

        <Snippet
          title={$t('Piloter le widget depuis la page')}
          hint={$t(
            'Ouvrir, préremplir ou envoyer un message, dire qui est le visiteur, joindre des données : elles arrivent dans le panneau du conseiller, marquées comme non vérifiées.',
          )}
          code={API_EXAMPLE}
        />

        <Snippet
          title={$t('Avant le chargement du script')}
          hint={$t('Les appels attendent dans une file, puis s’exécutent dans l’ordre.')}
          code={QUEUE_EXAMPLE}
        />
      </TabsContent>

      <TabsContent value="actions" className="space-y-7 px-5 py-5">
        <PageActions siteId={site.id} />
        <Snippet
          title={$t('Déclarer une action')}
          hint={$t(
            'La page dit ce qu’elle sait faire ; l’IA le lui demande quand le visiteur en a besoin, une fois l’action autorisée ici. « read » cherche sans rien changer ; « do » change la page.',
          )}
          code={ACTION_EXAMPLE}
        />
        <Snippet
          title={$t('Dire où en est la page')}
          hint={$t(
            'Lu à chaque message du visiteur : l’étape, le panier, le formulaire. L’IA le reçoit comme une donnée non vérifiée.',
          )}
          code={CONTEXT_EXAMPLE}
        />
      </TabsContent>
    </Tabs>
  )
}

function Section({ title, children }: { readonly title: string; readonly children: ReactNode }) {
  return (
    <section className="space-y-5 border-t pt-6">
      <h3 className="text-sm font-semibold">{title}</h3>
      {children}
    </section>
  )
}

function Field({
  label,
  hint,
  warn = false,
  children,
}: {
  readonly label: string
  readonly hint?: string
  readonly warn?: boolean
  readonly children: (id: string) => ReactNode
}) {
  const id = useId()
  return (
    <div className="space-y-2">
      <Label htmlFor={id} className="text-foreground">
        {label}
      </Label>
      {children(id)}
      {hint && (
        <p
          className={cn(
            'text-xs',
            warn ? 'text-amber-700 dark:text-amber-400' : 'text-muted-foreground',
          )}
        >
          {hint}
        </p>
      )}
    </div>
  )
}

function Toggle({
  label,
  hint,
  checked,
  onChange,
  children,
}: {
  readonly label: string
  readonly hint: string
  readonly checked: boolean
  readonly onChange: (checked: boolean) => void
  readonly children?: ReactNode
}) {
  const id = useId()
  return (
    <div>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1 space-y-1">
          <Label htmlFor={id} className="text-foreground">
            {label}
          </Label>
          <p className="text-xs text-muted-foreground">{hint}</p>
        </div>
        <Switch id={id} checked={checked} onCheckedChange={onChange} className="mt-0.5" />
      </div>
      {children}
    </div>
  )
}

function Pixels({
  id,
  value,
  invalid,
  onChange,
}: {
  readonly id: string
  readonly value: number
  readonly invalid: boolean
  readonly onChange: (value: number) => void
}) {
  return (
    <div className="relative">
      <Input
        id={id}
        type="number"
        min={0}
        max={200}
        value={value}
        aria-invalid={invalid}
        onChange={(event) => onChange(Math.round(Number(event.target.value) || 0))}
        className="pr-9"
      />
      <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-xs text-muted-foreground">
        px
      </span>
    </div>
  )
}

function Snippet({
  title,
  hint,
  code,
}: {
  readonly title: string
  readonly hint: string
  readonly code: string
}) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="space-y-2">
      <div className="text-sm font-medium">{title}</div>
      <p className="text-xs text-muted-foreground">{hint}</p>
      <div className="relative">
        <pre className="scroll-discret overflow-x-auto rounded-md border bg-muted/50 py-2.5 pr-10 pl-3 font-mono text-[11.5px] leading-relaxed">
          {code}
        </pre>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={$t('Copier')}
          className="absolute top-1.5 right-1.5"
          onClick={() => {
            void navigator.clipboard?.writeText(code).then(() => {
              setCopied(true)
              setTimeout(() => setCopied(false), 1500)
            })
          }}
        >
          {copied ? <Check className="text-primary" /> : <Copy className="text-muted-foreground" />}
        </Button>
      </div>
    </div>
  )
}
