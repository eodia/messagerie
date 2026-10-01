'use client'

import { Chip } from '@/components/app/chip'
import { ToolDialog, type ToolTarget } from '@/components/app/tool-dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Segmented } from '@/components/ui/segmented'
import { Textarea } from '@/components/ui/textarea'
import { Hint } from '@/components/ui/tooltip'
import { api } from '@/lib/api'
import { $t, $tp, msg } from '@/lib/i18n'
import { useAddressTab } from '@/lib/use-address-tab'
import { cn } from '@/lib/utils'
import type { ToolsOverview } from '@chat/contracts'
import {
  Braces,
  CalendarClock,
  Check,
  FileText,
  Globe,
  Headset,
  Lock,
  Play,
  Plug,
  Plus,
  RefreshCw,
  Sparkles,
  X,
} from 'lucide-react'
import { type ReactNode, useCallback, useEffect, useState } from 'react'
import { CardChoice, Field, FormSection, ToggleField } from '../kit/controls'
import { type Values, bool, text, useSettingsData } from '../kit/data'
import { NEW, useRowEditor } from '../kit/editor'
import { PreviewCard, Studio, StudioTabs } from '../kit/studio'

/**
 * What the AI may do: its own tools — a read in basedb, an HTTP call, a callback — and the
 * MCP servers whose tools it is offered. No secret is written here: a token or a header
 * names an environment variable of the chat server, `${NAME}` (D5). The preview shows the
 * tool as the model reads it and the request it sends; a saved tool is tried from here.
 */

type Tab = 'tools' | 'mcp'

const TYPES = {
  basedb: 'Lecture dans basedb',
  http: 'Appel HTTP',
  callback: 'Rappel',
} as const

const ENV = /^[A-Z_][A-Z0-9_]*$/

// ── The parameters, as a JSON schema written row by row ─────────────────────────────────

type ParamType = 'string' | 'number' | 'integer' | 'boolean'

interface Param {
  readonly name: string
  readonly type: ParamType
  readonly description: string
  readonly required: boolean
}

const PARAM_TYPES: readonly { readonly value: ParamType; readonly label: string }[] = [
  { value: 'string', label: msg('Texte') },
  { value: 'number', label: msg('Nombre') },
  { value: 'integer', label: msg('Entier') },
  { value: 'boolean', label: msg('Oui / non') },
]

function paramsOf(json: string): Param[] | null {
  if (json.trim() === '') return []
  try {
    const schema = JSON.parse(json) as {
      properties?: Record<string, { type?: string; description?: string }>
      required?: string[]
    }
    if (typeof schema !== 'object' || schema === null) return null
    return Object.entries(schema.properties ?? {}).map(([name, spec]) => ({
      name,
      type: (['number', 'integer', 'boolean'] as const).find((t) => t === spec.type) ?? 'string',
      description: spec.description ?? '',
      required: schema.required?.includes(name) ?? false,
    }))
  } catch {
    return null
  }
}

function schemaOf(params: readonly Param[]): string {
  const required = params.filter((p) => p.required && p.name).map((p) => p.name)
  return JSON.stringify(
    {
      type: 'object',
      properties: Object.fromEntries(
        params
          .filter((p) => p.name)
          .map((p) => [
            p.name,
            { type: p.type, ...(p.description ? { description: p.description } : {}) },
          ]),
      ),
      ...(required.length > 0 ? { required } : {}),
    },
    null,
    2,
  )
}

function ParamsField({
  value,
  onChange,
  disabled,
}: {
  readonly value: string
  readonly onChange: (json: string) => void
  readonly disabled: boolean
}) {
  const parsed = paramsOf(value)
  const [raw, setRaw] = useState(parsed === null)
  const params = parsed ?? []
  const update = (next: Param[]) => onChange(schemaOf(next))

  return (
    <div className="space-y-2">
      <div className="flex justify-end">
        <Segmented
          aria-label={$t('Écriture des paramètres')}
          value={raw ? 'json' : 'rows'}
          onValueChange={(v) => setRaw(v === 'json')}
          options={[
            { value: 'rows', label: $t('Champs') },
            { value: 'json', label: 'JSON' },
          ]}
          disabled={parsed === null}
          className="h-7"
        />
      </div>
      {raw || parsed === null ? (
        <>
          <Textarea
            rows={8}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="font-mono text-xs"
            aria-invalid={parsed === null}
            aria-label={$t('Schéma JSON des paramètres')}
          />
          {parsed === null && (
            <p className="text-xs text-destructive">{$t('Ce n’est pas un schéma JSON lisible.')}</p>
          )}
        </>
      ) : (
        <div className="space-y-2">
          {params.map((param, index) => (
            <div
              // biome-ignore lint/suspicious/noArrayIndexKey: rows keep their place while typed in
              key={index}
              className="space-y-2 rounded-lg border p-3"
            >
              <div className="flex items-center gap-2">
                <Input
                  value={param.name}
                  onChange={(e) =>
                    update(
                      params.map((p, i) =>
                        i === index
                          ? { ...p, name: e.target.value.replace(/[^A-Za-z0-9_]/g, '_') }
                          : p,
                      ),
                    )
                  }
                  placeholder="ville"
                  aria-label={$t('Nom du paramètre')}
                  className="h-8 flex-1 font-mono text-xs"
                />
                <Segmented
                  aria-label={$t('Type')}
                  value={param.type}
                  onValueChange={(type) =>
                    update(params.map((p, i) => (i === index ? { ...p, type } : p)))
                  }
                  options={PARAM_TYPES.map((t) => ({ value: t.value, label: $t(t.label) }))}
                  className="h-8"
                  itemClassName="px-2 text-[11px]"
                />
                <Hint label={$t('Retirer')}>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="size-8"
                    onClick={() => update(params.filter((_, i) => i !== index))}
                  >
                    <X className="text-muted-foreground" />
                  </Button>
                </Hint>
              </div>
              <Input
                value={param.description}
                onChange={(e) =>
                  update(
                    params.map((p, i) => (i === index ? { ...p, description: e.target.value } : p)),
                  )
                }
                placeholder={$t('Ce que l’IA doit y mettre')}
                aria-label={$t('Description du paramètre')}
                className="h-8 text-xs"
              />
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  checked={param.required}
                  onChange={(e) =>
                    update(
                      params.map((p, i) =>
                        i === index ? { ...p, required: e.target.checked } : p,
                      ),
                    )
                  }
                  className="accent-primary"
                />
                {$t('Obligatoire')}
              </label>
            </div>
          ))}
          {!disabled && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 w-full gap-1.5 border-dashed text-xs"
              onClick={() =>
                update([...params, { name: '', type: 'string', description: '', required: false }])
              }
            >
              <Plus className="size-3.5" />
              {$t('Ajouter un paramètre')}
            </Button>
          )}
          {params.length === 0 && (
            <p className="text-xs text-muted-foreground">
              {$t('Aucun paramètre : l’IA l’appelle sans rien lui donner.')}
            </p>
          )}
        </div>
      )}
    </div>
  )
}

// ── Headers, a line each, a secret named by its variable ─────────────────────────────────

function headerRows(value: string): { name: string; value: string }[] {
  return value
    .split('\n')
    .filter((l) => l.trim() !== '')
    .map((line) => {
      const at = line.indexOf(':')
      return at < 0
        ? { name: line.trim(), value: '' }
        : { name: line.slice(0, at).trim(), value: line.slice(at + 1).trim() }
    })
}

/** A value that looks like a secret written as it is, not as `${NAME}`. */
const looksSecret = (value: string) =>
  !value.includes('${') && /^[A-Za-z0-9_\-.=+/]{20,}$/.test(value.replace(/^Bearer\s+/i, ''))

function HeadersField({
  value,
  onChange,
  disabled,
}: {
  readonly value: string
  readonly onChange: (value: string) => void
  readonly disabled: boolean
}) {
  const rows = headerRows(value)
  const write = (next: { name: string; value: string }[]) =>
    onChange(next.map((r) => `${r.name}: ${r.value}`).join('\n'))
  const secret = rows.some((r) => looksSecret(r.value))

  return (
    <div className="space-y-2">
      {rows.map((row, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: rows keep their place while typed in
        <div key={index} className="flex items-center gap-2">
          <Input
            value={row.name}
            onChange={(e) =>
              write(
                rows.map((r, i) =>
                  i === index ? { ...r, name: e.target.value.replace(/[:\s]/g, '') } : r,
                ),
              )
            }
            placeholder="X-Api-Key"
            aria-label={$t('Nom de l’en-tête')}
            className="h-8 w-36 font-mono text-xs"
          />
          <Input
            value={row.value}
            onChange={(e) =>
              write(rows.map((r, i) => (i === index ? { ...r, value: e.target.value } : r)))
            }
            placeholder="${METEO_CLE}"
            aria-label={$t('Valeur de l’en-tête')}
            aria-invalid={looksSecret(row.value)}
            className="h-8 flex-1 font-mono text-xs"
          />
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="size-8"
            aria-label={$t('Retirer')}
            onClick={() => write(rows.filter((_, i) => i !== index))}
          >
            <X className="text-muted-foreground" />
          </Button>
        </div>
      ))}
      {!disabled && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 gap-1.5 border-dashed text-xs"
          onClick={() => write([...rows, { name: '', value: '' }])}
        >
          <Plus className="size-3.5" />
          {$t('Ajouter un en-tête')}
        </Button>
      )}
      {secret && (
        <p className="text-xs text-destructive">
          {$t(
            'Cela ressemble à un secret écrit en clair : il serait lisible dans basedb. Écrivez ${NOM} et mettez la valeur dans l’environnement du serveur.',
          )}
        </p>
      )}
    </div>
  )
}

function EnvField({
  id,
  value,
  onChange,
}: {
  readonly id: string
  readonly value: string
  readonly onChange: (value: string) => void
}) {
  return (
    <div className="relative">
      <Lock className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-foreground" />
      <Input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '_'))}
        placeholder="METEO_JETON"
        aria-invalid={value !== '' && !ENV.test(value)}
        className="pl-8 font-mono text-xs"
        maxLength={64}
      />
    </div>
  )
}

/** `${NAME}` and `{param}` in a line, drawn as what they are. */
function Highlighted({ line }: { readonly line: string }) {
  // Each part keyed by where it starts in the line.
  let at = 0
  const parts = line.split(/(\$\{[A-Z0-9_]+\}|\{[A-Za-z0-9_]+\})/g).map((part) => {
    const start = at
    at += part.length
    return { part, start }
  })
  return (
    <>
      {parts.map(({ part, start }) =>
        part.startsWith('${') ? (
          <span
            key={start}
            className="inline-flex items-center gap-1 rounded bg-amber-500/15 px-1 text-amber-800 dark:text-amber-300"
          >
            <Lock className="size-3" />
            {part.slice(2, -1)}
          </span>
        ) : part.startsWith('{') ? (
          <span
            key={start}
            className="rounded bg-violet-500/15 px-1 text-violet-800 dark:text-violet-300"
          >
            {part}
          </span>
        ) : (
          <span key={start}>{part}</span>
        ),
      )}
    </>
  )
}

// ── The screen ──────────────────────────────────────────────────────────────────────────

export function ToolsStudio() {
  const data = useSettingsData(['outils_ia', 'serveurs_mcp'])
  // Served at /outils and in the settings: its address is where it is.
  const [toolsBase] = useState(() =>
    window.location.pathname.startsWith('/parametrage/outils') ? '/parametrage/outils' : '/outils',
  )
  const [tab, setTab, tabBase] = useAddressTab<Tab>(toolsBase, { tools: null, mcp: 'serveurs-mcp' })
  const tools = useRowEditor(data, 'outils_ia', {
    defaults: {
      Type: TYPES.http,
      Méthode: 'GET',
      'Agent IA': true,
      Copilote: true,
      Paramètres: schemaOf([]),
    },
  })
  const servers = useRowEditor(data, 'serveurs_mcp', {
    defaults: { 'Agent IA': true, Copilote: true },
  })
  const [live, setLive] = useState<ToolsOverview | null>(null)
  const [checking, setChecking] = useState(false)
  const [testing, setTesting] = useState<(ToolTarget & { tool: string; server?: string }) | null>(
    null,
  )

  const check = useCallback(() => {
    setChecking(true)
    api
      .tools()
      .then(setLive)
      .catch(() => setLive(null))
      .finally(() => setChecking(false))
  }, [])
  useEffect(check, [])
  // What was saved is what the server offers: read it again.
  useEffect(() => {
    if (tools.savedAt || servers.savedAt) check()
  }, [tools.savedAt, servers.savedAt, check])

  const tabs = (
    <StudioTabs
      value={tab}
      onChange={setTab}
      tabs={[
        { value: 'tools', label: $t('Outils'), count: data.rows('outils_ia').length },
        { value: 'mcp', label: $t('Serveurs MCP'), count: data.rows('serveurs_mcp').length },
      ]}
    />
  )
  const refresh = (
    <Button variant="ghost" size="sm" className="h-8 gap-1.5 text-xs" onClick={check}>
      <RefreshCw className={cn('size-3.5', checking && 'animate-spin')} />
      {$t('Vérifier')}
    </Button>
  )

  const dialog = (
    <ToolDialog
      tool={testing}
      onClose={() => setTesting(null)}
      note={$t('Un essai : hors de toute conversation, sans client et sans trace dans un fil.')}
      run={(args) =>
        api.testTool({
          tool: testing?.tool ?? '',
          ...(testing?.server ? { server: testing.server } : {}),
          arguments: args,
        })
      }
    />
  )

  if (tab === 'mcp') {
    return (
      <>
        <Studio
          base={tabBase}
          section={$t('Outils IA')}
          data={data}
          editor={servers}
          tabs={tabs}
          tools={refresh}
          nouns={{ fresh: $t('Nouveau serveur'), remove: $t('Supprimer le serveur') }}
          empty={{
            title: $t('Aucun serveur MCP'),
            text: $t(
              'Un serveur MCP offre ses outils à l’IA — un service interne, une API métier — sans une ligne de code.',
            ),
          }}
          used={[
            'Nom',
            'Adresse',
            'Description',
            "Jeton (variable d'environnement)",
            'En-têtes',
            'Outils autorisés',
            'Agent IA',
            'Copilote',
          ]}
          item={(row, values) => {
            const status = live?.mcp.find((m) => m.id === row.id)
            return (
              <>
                <span className="relative flex size-7 shrink-0 items-center justify-center rounded-lg bg-muted">
                  <Plug className="size-3.5 text-muted-foreground" />
                  {status && (
                    <span
                      className={cn(
                        'absolute -right-0.5 -bottom-0.5 size-2 rounded-full ring-2 ring-background',
                        status.reachable ? 'bg-emerald-500' : 'bg-rose-500',
                      )}
                    />
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium">
                    {text(values.Nom) || $t('Nouveau serveur')}
                  </span>
                  <span className="block truncate font-mono text-[11px] text-muted-foreground">
                    {text(values.Adresse) || '—'}
                  </span>
                </span>
              </>
            )
          }}
          form={(values) => {
            const status = live?.mcp.find((m) => m.id === servers.selectedId)
            const allowed = text(values['Outils autorisés'])
              .split(/[\n,]+/)
              .map((t) => t.trim())
              .filter(Boolean)
            return (
              <>
                <FormSection title={$t('Le serveur')}>
                  <Field label={$t('Nom')} required>
                    {(id) => (
                      <Input
                        id={id}
                        value={text(values.Nom)}
                        onChange={(e) => servers.set('Nom', e.target.value)}
                        maxLength={60}
                      />
                    )}
                  </Field>
                  <Field
                    label={$t('Adresse')}
                    hint={$t('Le point d’entrée MCP en HTTP (Streamable HTTP).')}
                  >
                    {(id) => (
                      <Input
                        id={id}
                        value={text(values.Adresse)}
                        onChange={(e) => servers.set('Adresse', e.target.value.trim())}
                        placeholder="https://outils.exemple.fr/mcp"
                        className="font-mono text-xs"
                      />
                    )}
                  </Field>
                  <Field
                    label={$t('Ce que l’IA y trouve')}
                    hint={$t('Elle le lit pour choisir ses outils.')}
                  >
                    {(id) => (
                      <Textarea
                        id={id}
                        rows={3}
                        value={text(values.Description)}
                        onChange={(e) => servers.set('Description', e.target.value)}
                      />
                    )}
                  </Field>
                </FormSection>
                <FormSection
                  title={$t('Authentification')}
                  hint={$t(
                    'Aucun secret ici : le nom d’une variable d’environnement du serveur de la messagerie.',
                  )}
                >
                  <Field label={$t('Jeton (Authorization: Bearer)')}>
                    {(id) => (
                      <EnvField
                        id={id}
                        value={text(values["Jeton (variable d'environnement)"])}
                        onChange={(v) => servers.set("Jeton (variable d'environnement)", v)}
                      />
                    )}
                  </Field>
                  <Field label={$t('En-têtes')}>
                    {() => (
                      <HeadersField
                        value={text(values['En-têtes'])}
                        onChange={(v) => servers.set('En-têtes', v)}
                        disabled={!data.canEdit}
                      />
                    )}
                  </Field>
                </FormSection>
                <FormSection
                  title={$t('Outils offerts')}
                  hint={$t('Aucun coché : tous les outils du serveur.')}
                >
                  {status?.reachable && status.tools.length > 0 ? (
                    <ToolChecklist
                      names={[...new Set([...status.tools.map((t) => t.name), ...allowed])]}
                      allowed={allowed}
                      onChange={(names) => servers.set('Outils autorisés', names.join('\n'))}
                      disabled={!data.canEdit}
                    />
                  ) : (
                    <Textarea
                      rows={3}
                      value={text(values['Outils autorisés'])}
                      onChange={(e) => servers.set('Outils autorisés', e.target.value)}
                      placeholder={$t('Un nom d’outil par ligne')}
                      className="font-mono text-xs"
                      aria-label={$t('Outils autorisés')}
                    />
                  )}
                </FormSection>
                <UsedBy values={values} set={servers.set} disabled={!data.canEdit} />
              </>
            )
          }}
          preview={(values) => (
            <McpPreview
              values={values}
              status={live?.mcp.find((m) => m.id === servers.selectedId) ?? null}
              saved={servers.selectedId !== NEW && !servers.dirty}
              onTest={(target) => setTesting(target)}
              canTest={data.canEdit}
            />
          )}
        />
        {dialog}
      </>
    )
  }

  return (
    <>
      <Studio
        base={tabBase}
        section={$t('Outils IA')}
        data={data}
        editor={tools}
        tabs={tabs}
        tools={refresh}
        nouns={{ fresh: $t('Nouvel outil'), remove: $t('Supprimer l’outil') }}
        empty={{
          title: $t('Aucun outil'),
          text: $t(
            'Les seules actions que l’IA peut mener : consulter un dossier, créer un rappel, appeler une API.',
          ),
        }}
        used={[
          'Nom',
          "Description pour l'IA",
          'Type',
          'Cible',
          'Méthode',
          "Jeton (variable d'environnement)",
          'En-têtes',
          'Paramètres',
          'Agent IA',
          'Copilote',
        ]}
        item={(_row, values) => {
          const Icon =
            values.Type === TYPES.basedb
              ? FileText
              : values.Type === TYPES.callback
                ? CalendarClock
                : Globe
          return (
            <>
              <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-muted">
                <Icon className="size-3.5 text-muted-foreground" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium">
                  {text(values.Nom) || $t('Nouvel outil')}
                </span>
                <span className="block truncate text-[11px] text-muted-foreground">
                  {[
                    bool(values['Agent IA']) && $t('Agent IA'),
                    bool(values.Copilote) && $t('Copilote'),
                  ]
                    .filter(Boolean)
                    .join(' · ') || $t('Personne ne s’en sert')}
                </span>
              </span>
            </>
          )
        }}
        form={(values) => (
          <>
            <FormSection title={$t('L’outil')}>
              <Field label={$t('Nom')} required>
                {(id) => (
                  <Input
                    id={id}
                    value={text(values.Nom)}
                    onChange={(e) => tools.set('Nom', e.target.value)}
                    maxLength={60}
                    placeholder={$t('Consulter un dossier')}
                  />
                )}
              </Field>
              <Field
                label={$t('Pour l’IA')}
                hint={$t(
                  'Ce que fait l’outil et quand l’appeler : c’est tout ce que le modèle en sait.',
                )}
              >
                {(id) => (
                  <Textarea
                    id={id}
                    rows={4}
                    value={text(values["Description pour l'IA"])}
                    onChange={(e) => tools.set("Description pour l'IA", e.target.value)}
                  />
                )}
              </Field>
            </FormSection>
            <FormSection title={$t('Ce qu’il fait')}>
              <CardChoice
                value={(values.Type as string) || TYPES.http}
                onChange={(type) => tools.set('Type', type)}
                disabled={!data.canEdit}
                options={[
                  {
                    value: TYPES.http,
                    label: $t('Appel HTTP'),
                    hint: $t('Une API, la vôtre ou une autre.'),
                    icon: <Globe />,
                  },
                  {
                    value: TYPES.basedb,
                    label: $t('Lecture'),
                    hint: $t('Une table de basedb, ou la fiche du visiteur.'),
                    icon: <FileText />,
                  },
                  {
                    value: TYPES.callback,
                    label: $t('Rappel'),
                    hint: $t('Un rappel par un conseiller.'),
                    icon: <CalendarClock />,
                  },
                ]}
              />
              {values.Type === TYPES.http && (
                <>
                  <Field
                    label={$t('Adresse')}
                    hint={$t('{paramètre} y est remplacé par la valeur que donne l’IA.')}
                  >
                    {(id) => (
                      <div className="flex gap-2">
                        <Segmented
                          aria-label={$t('Méthode')}
                          value={values.Méthode === 'POST' ? 'POST' : 'GET'}
                          onValueChange={(m) => tools.set('Méthode', m)}
                          options={[
                            { value: 'GET', label: 'GET' },
                            { value: 'POST', label: 'POST' },
                          ]}
                          disabled={!data.canEdit}
                          className="h-9 shrink-0"
                        />
                        <Input
                          id={id}
                          value={text(values.Cible)}
                          onChange={(e) => tools.set('Cible', e.target.value.trim())}
                          placeholder="https://api.exemple.fr/meteo?ville={ville}"
                          className="font-mono text-xs"
                        />
                      </div>
                    )}
                  </Field>
                  <Field
                    label={$t('Jeton (Authorization: Bearer)')}
                    hint={$t('Le nom d’une variable d’environnement du serveur, jamais le jeton.')}
                  >
                    {(id) => (
                      <EnvField
                        id={id}
                        value={text(values["Jeton (variable d'environnement)"])}
                        onChange={(v) => tools.set("Jeton (variable d'environnement)", v)}
                      />
                    )}
                  </Field>
                  <Field label={$t('En-têtes')}>
                    {() => (
                      <HeadersField
                        value={text(values['En-têtes'])}
                        onChange={(v) => tools.set('En-têtes', v)}
                        disabled={!data.canEdit}
                      />
                    )}
                  </Field>
                </>
              )}
              {values.Type === TYPES.basedb && (
                <Field
                  label={$t('Table lue')}
                  hint={$t('« Fiche du visiteur » : ce que le site a transmis du client connecté.')}
                >
                  {(id) => (
                    <Input
                      id={id}
                      value={text(values.Cible)}
                      onChange={(e) => tools.set('Cible', e.target.value)}
                      placeholder={$t('Fiche du visiteur')}
                    />
                  )}
                </Field>
              )}
            </FormSection>
            <FormSection
              title={$t('Paramètres')}
              hint={$t('Ce que l’IA doit fournir en l’appelant.')}
            >
              <ParamsField
                value={text(values.Paramètres)}
                onChange={(v) => tools.set('Paramètres', v)}
                disabled={!data.canEdit}
              />
            </FormSection>
            <UsedBy values={values} set={tools.set} disabled={!data.canEdit} />
          </>
        )}
        preview={(values) => (
          <ToolPreview
            values={values}
            saved={tools.selectedId !== NEW && !tools.dirty && bool(values.Actif)}
            canTest={data.canEdit}
            onTest={() =>
              tools.selectedId &&
              setTesting({
                tool: tools.selectedId,
                title: text(values.Nom),
                description: text(values["Description pour l'IA"]),
                parameters: JSON.parse(schemaOf(paramsOf(text(values.Paramètres)) ?? [])) as Record<
                  string,
                  unknown
                >,
              })
            }
          />
        )}
      />
      {dialog}
    </>
  )
}

function UsedBy({
  values,
  set,
  disabled,
}: {
  readonly values: Values
  readonly set: (label: string, value: unknown) => void
  readonly disabled: boolean
}) {
  return (
    <FormSection title={$t('Qui s’en sert')}>
      <ToggleField
        label={$t('L’agent IA')}
        hint={$t('L’IA qui répond aux visiteurs peut l’appeler seule.')}
        checked={bool(values['Agent IA'])}
        onChange={(on) => set('Agent IA', on)}
        disabled={disabled}
      />
      <ToggleField
        label={$t('Le copilote')}
        hint={$t('Proposé aux conseillers, dans le panneau de la conversation.')}
        checked={bool(values.Copilote)}
        onChange={(on) => set('Copilote', on)}
        disabled={disabled}
      />
    </FormSection>
  )
}

function ToolChecklist({
  names,
  allowed,
  onChange,
  disabled,
}: {
  readonly names: readonly string[]
  readonly allowed: readonly string[]
  readonly onChange: (names: string[]) => void
  readonly disabled: boolean
}) {
  return (
    <ul className="divide-y overflow-hidden rounded-lg border">
      {names.map((name) => {
        const on = allowed.includes(name)
        return (
          <li key={name}>
            <button
              type="button"
              disabled={disabled}
              aria-pressed={on}
              onClick={() => onChange(on ? allowed.filter((n) => n !== name) : [...allowed, name])}
              className="flex w-full items-center gap-3 px-3 py-2 text-left font-mono text-xs transition-colors hover:bg-muted/50"
            >
              <span
                className={cn(
                  'flex size-4 shrink-0 items-center justify-center rounded-[4px] border',
                  on && 'border-primary bg-primary text-primary-foreground',
                )}
              >
                {on && <Check className="size-3" strokeWidth={3} />}
              </span>
              {name}
            </button>
          </li>
        )
      })}
    </ul>
  )
}

function UsedByChips({ values }: { readonly values: Values }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {bool(values['Agent IA']) && (
        <Chip tint="violet">
          <Sparkles />
          {$t('Agent IA')}
        </Chip>
      )}
      {bool(values.Copilote) && (
        <Chip tint="sky">
          <Headset />
          {$t('Copilote')}
        </Chip>
      )}
      {!bool(values['Agent IA']) && !bool(values.Copilote) && (
        <Chip tint="zinc">{$t('Personne ne s’en sert')}</Chip>
      )}
    </div>
  )
}

function TestButton({
  saved,
  canTest,
  onTest,
  children,
}: {
  readonly saved: boolean
  readonly canTest: boolean
  readonly onTest: () => void
  readonly children?: ReactNode
}) {
  return (
    <Hint
      label={
        !canTest
          ? $t('Réservé aux superviseurs')
          : saved
            ? $t('Un essai, hors de toute conversation')
            : $t('Enregistrez-le, actif, pour l’essayer')
      }
    >
      <span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 gap-1.5 text-xs"
          disabled={!saved || !canTest}
          onClick={onTest}
        >
          <Play className="size-3" />
          {children ?? $t('Essayer')}
        </Button>
      </span>
    </Hint>
  )
}

function ToolPreview({
  values,
  saved,
  canTest,
  onTest,
}: {
  readonly values: Values
  readonly saved: boolean
  readonly canTest: boolean
  readonly onTest: () => void
}) {
  const params = paramsOf(text(values.Paramètres)) ?? []
  const http = values.Type === TYPES.http
  const method = values.Méthode === 'POST' ? 'POST' : 'GET'
  const token = text(values["Jeton (variable d'environnement)"])
  const headers = headerRows(text(values['En-têtes']))

  return (
    <>
      <PreviewCard
        label={$t('Ce que l’IA voit')}
        hint={<TestButton saved={saved} canTest={canTest} onTest={onTest} />}
      >
        <div className="space-y-3 p-5">
          <div className="flex items-center gap-2">
            <Braces className="size-4 text-violet-600 dark:text-violet-300" />
            <span className="font-mono text-sm font-semibold">
              {text(values.Nom) || $t('Nouvel outil')}
            </span>
          </div>
          <p className="text-sm leading-relaxed text-muted-foreground">
            {text(values["Description pour l'IA"]) || (
              <span className="text-amber-700 dark:text-amber-400">
                {$t('Sans description, l’IA ne saura pas quand l’appeler.')}
              </span>
            )}
          </p>
          {params.length > 0 && (
            <ul className="divide-y rounded-lg border">
              {params.map((p) => (
                <li key={p.name} className="flex items-baseline gap-2 px-3 py-2 text-xs">
                  <span className="font-mono font-medium">{p.name || '…'}</span>
                  <span className="font-mono text-[11px] text-muted-foreground">{p.type}</span>
                  {p.required && <Chip tint="amber">{$t('obligatoire')}</Chip>}
                  <span className="min-w-0 flex-1 truncate text-right text-muted-foreground">
                    {p.description}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <UsedByChips values={values} />
        </div>
      </PreviewCard>

      {http && (
        <PreviewCard label={$t('La requête envoyée')}>
          <div className="space-y-1 p-5 font-mono text-xs leading-relaxed [overflow-wrap:anywhere]">
            <div>
              <span className="font-semibold text-emerald-700 dark:text-emerald-400">{method}</span>{' '}
              <Highlighted line={text(values.Cible) || 'https://…'} />
            </div>
            {token && (
              <div className="text-muted-foreground">
                Authorization: Bearer <Highlighted line={`\${${token}}`} />
              </div>
            )}
            {headers.map((h) => (
              <div key={h.name} className="text-muted-foreground">
                {h.name}: <Highlighted line={h.value} />
              </div>
            ))}
            {method === 'POST' && (
              <div className="pt-2 text-muted-foreground">
                {'{ '}
                {params.map((p, i) => (
                  <span key={p.name}>
                    <span className="text-foreground">"{p.name}"</span>:{' '}
                    <span className="text-violet-700 dark:text-violet-300">…</span>
                    {i < params.length - 1 ? ', ' : ' '}
                  </span>
                ))}
                {'}'}
              </div>
            )}
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 border-t px-5 py-2.5 text-[11px] text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <span className="size-2 rounded-sm bg-violet-500/40" />
              {$t('donné par l’IA')}
            </span>
            <span className="flex items-center gap-1.5">
              <Lock className="size-3" />
              {$t('lu dans l’environnement du serveur')}
            </span>
          </div>
        </PreviewCard>
      )}
    </>
  )
}

function McpPreview({
  values,
  status,
  saved,
  canTest,
  onTest,
}: {
  readonly values: Values
  readonly status: ToolsOverview['mcp'][number] | null
  readonly saved: boolean
  readonly canTest: boolean
  readonly onTest: (target: ToolTarget & { tool: string; server: string }) => void
}) {
  return (
    <>
      <PreviewCard
        label={$t('Connexion')}
        hint={
          status ? (
            status.reachable ? (
              <Chip tint="emerald">
                <span className="size-1.5 rounded-full bg-current" />
                {$tp(status.tools.length, '{count} outil offert', '{count} outils offerts')}
              </Chip>
            ) : (
              <Chip tint="rose">
                <span className="size-1.5 rounded-full bg-current" />
                {$t('Ne répond pas')}
              </Chip>
            )
          ) : undefined
        }
      >
        <div className="space-y-3 p-5">
          <div className="flex items-center gap-2 font-mono text-xs">
            <Plug className="size-4 text-muted-foreground" />
            <span className="truncate">{text(values.Adresse) || 'https://…/mcp'}</span>
          </div>
          {!status && (
            <p className="text-xs text-muted-foreground">
              {saved
                ? $t('Désactivé, ou pas encore vérifié : « Vérifier » interroge le serveur.')
                : $t('Enregistrez-le pour que la messagerie l’interroge.')}
            </p>
          )}
          {status && !status.reachable && (
            <p className="text-xs text-rose-700 dark:text-rose-300">
              {$t(
                'Injoignable : l’IA répond sans ses outils. Vérifiez son adresse, son jeton et ses en-têtes.',
              )}
            </p>
          )}
          <UsedByChips values={values} />
        </div>
      </PreviewCard>

      {status?.reachable && (
        <PreviewCard label={$t('Ses outils, tels que l’IA les voit')}>
          <ul className="divide-y">
            {status.tools.map((tool) => (
              <li key={tool.name} className="flex items-start gap-3 px-5 py-3">
                <Braces className="mt-0.5 size-3.5 shrink-0 text-violet-600 dark:text-violet-300" />
                <div className="min-w-0 flex-1">
                  <div className="font-mono text-xs font-medium">{tool.name}</div>
                  <p className="line-clamp-2 text-xs text-muted-foreground">{tool.description}</p>
                </div>
                <TestButton
                  saved={saved}
                  canTest={canTest}
                  onTest={() =>
                    onTest({
                      tool: tool.name,
                      server: status.id,
                      title: `${status.name} › ${tool.name}`,
                      description: tool.description,
                      parameters: tool.parameters,
                    })
                  }
                />
              </li>
            ))}
          </ul>
        </PreviewCard>
      )}
    </>
  )
}
