'use client'

import { ScreenHeader, Slash } from '@/components/app/screen-header'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Hint } from '@/components/ui/tooltip'
import { $t } from '@/lib/i18n'
import { messageFor } from '@/lib/messages'
import { cn } from '@/lib/utils'
import type { SettingsRow } from '@chat/contracts'
import { Check, LoaderCircle, Plus, Search, Trash2 } from 'lucide-react'
import { type ReactNode, useEffect, useId, useMemo, useRef, useState } from 'react'
import { type Choices, FieldInput } from '../field-input'
import { ElevateDialog } from '../screens/account-dialog'
import { FormSection } from './controls'
import { type SettingsData, type Values, bool, nameOf } from './data'
import { NEW, type RowEditor } from './editor'

/**
 * A settings screen, laid out as the widget editor: the rows on the left, the chosen one's
 * form in the middle, and on the right what it changes, drawn live — the menu, a
 * conversation, a week of opening hours. Fields the template adds and the form does not
 * place yet still show, under « Autres réglages »: the template stays the reference (D10).
 */

export interface Nouns {
  /** « Nouvelle boîte » — the add button, and the name of a row not saved yet. */
  readonly fresh: string
  /** « Supprimer la boîte » */
  readonly remove: string
}

export function Studio({
  section,
  data,
  editor,
  nouns,
  tabs,
  listAction,
  item,
  searchOf,
  form,
  used,
  elsewhere = [],
  preview,
  empty,
  tools,
  canDelete = true,
}: {
  readonly section: string
  readonly data: SettingsData
  readonly editor: RowEditor
  readonly nouns: Nouns
  readonly tabs?: ReactNode
  /** In place of « Nouvelle … » above the list — « Inviter » for agents. */
  readonly listAction?: ReactNode
  readonly item: (row: SettingsRow, values: Values) => ReactNode
  readonly searchOf?: (values: Values) => string
  readonly form: (values: Values) => ReactNode
  /** The fields the form places; the others go under « Autres réglages ». */
  readonly used: readonly string[]
  /** Fields edited on another screen. */
  readonly elsewhere?: readonly string[]
  readonly preview: (values: Values) => ReactNode
  readonly empty: { readonly title: string; readonly text: string }
  readonly tools?: ReactNode
  readonly canDelete?: boolean
}) {
  const { canEdit } = data
  const { table, values, selectedId } = editor
  const [query, setQuery] = useState('')
  const [confirming, setConfirming] = useState(false)
  const activeId = useId()

  // Reached from the palette with ?nouveau: a new row, once the table is read.
  const startedNew = useRef(false)
  useEffect(() => {
    if (startedNew.current || !table || !canEdit) return
    startedNew.current = true
    const params = new URLSearchParams(window.location.search)
    if (!params.has('nouveau')) return
    editor.create()
    window.history.replaceState(null, '', window.location.pathname)
  }, [table, canEdit, editor])

  // Ctrl+S saves, as in a document.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault()
        if (editor.dirty && editor.missing.length === 0 && canEdit) void editor.save()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [editor, canEdit])

  // Leaving with changes not saved asks first.
  useEffect(() => {
    if (!editor.anyDirty) return
    const warn = (event: BeforeUnloadEvent) => event.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [editor.anyDirty])

  // biome-ignore lint/correctness/useExhaustiveDependencies: another row asks again
  useEffect(() => setConfirming(false), [selectedId])

  const choices: Choices = useMemo(
    () => ({
      rowsOf: (target: string) =>
        data.rows(target).map((row) => ({
          id: row.id,
          label: nameOf(data.table(target), row.values) || $t('Sans nom'),
        })),
      users: (data.overview?.users ?? []).map((u) => ({ id: u.id, label: u.name })),
    }),
    [data],
  )

  const hasActive = table?.fields.some((f) => f.label === 'Actif') ?? false
  const rest =
    table?.fields.filter(
      (f) => f.label !== 'Actif' && !used.includes(f.label) && !elsewhere.includes(f.label),
    ) ?? []
  const folded = query.trim().toLowerCase()
  const shown = editor.rows.filter(
    (row) =>
      folded === '' ||
      (searchOf?.(row.values) ?? nameOf(table, row.values)).toLowerCase().includes(folded),
  )
  const name = values ? nameOf(table, values) : ''

  return (
    <>
      <ScreenHeader
        tools={
          <>
            {tools}
            {editor.savedAt !== null && !editor.dirty && (
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <Check className="size-3.5 text-primary" />
                {$t('Enregistré')}
              </span>
            )}
            {editor.dirty && (
              <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={editor.discard}>
                {selectedId === NEW ? $t('Abandonner') : $t('Annuler les modifications')}
              </Button>
            )}
            {canEdit && (
              <Hint
                label={
                  editor.missing.length > 0
                    ? $t('À remplir : {fields}', { fields: editor.missing.join(', ') })
                    : $t('Enregistrer (Ctrl+S)')
                }
              >
                <span>
                  <Button
                    size="sm"
                    className="h-8 gap-1.5 text-xs"
                    disabled={!editor.dirty || editor.saving || editor.missing.length > 0}
                    onClick={() => void editor.save()}
                  >
                    {editor.saving && <LoaderCircle className="size-3.5 animate-spin" />}
                    {$t('Enregistrer')}
                  </Button>
                </span>
              </Hint>
            )}
          </>
        }
      >
        <span className="text-muted-foreground">{$t('Paramétrage')}</span>
        <Slash />
        <span className={cn(values ? 'text-muted-foreground' : 'font-medium')}>{section}</span>
        {values && (
          <>
            <Slash />
            <span className="truncate font-medium">{name || nouns.fresh}</span>
          </>
        )}
      </ScreenHeader>

      {data.error === 'ELEVATION_REQUIRED' && (
        <ElevateDialog
          onClose={() => data.setError(null)}
          onDone={() => {
            data.setError(null)
            void editor.save()
          }}
        />
      )}

      {((data.error && data.error !== 'ELEVATION_REQUIRED') ||
        !data.persistent ||
        (data.overview && !canEdit)) && (
        <div className="space-y-px">
          {data.error && data.error !== 'ELEVATION_REQUIRED' && (
            <div className="flex items-center gap-2 border-b border-destructive/30 bg-destructive/5 px-4 py-1.5 text-sm text-destructive">
              <span className="flex-1">{messageFor(data.error)}</span>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs"
                onClick={() => data.setError(null)}
              >
                {$t('Fermer')}
              </Button>
            </div>
          )}
          {!data.persistent && (
            <p className="border-b border-amber-500/30 bg-amber-500/5 px-4 py-2 text-xs text-amber-800 dark:text-amber-300">
              {$t(
                'Mode démonstration : sans basedb, les réglages viennent du modèle et ne sont gardés qu’en mémoire, jusqu’au redémarrage du serveur.',
              )}
            </p>
          )}
          {data.overview && !canEdit && (
            <p className="border-b bg-muted/50 px-4 py-2 text-xs text-muted-foreground">
              {$t('Lecture seule : le paramétrage est réservé aux superviseurs.')}
            </p>
          )}
        </div>
      )}

      {data.overview === null ? (
        <div className="flex flex-1 items-center justify-center">
          {data.loading && <LoaderCircle className="size-5 animate-spin text-muted-foreground" />}
        </div>
      ) : (
        <div className="flex min-h-0 flex-1">
          {/* The rows. */}
          <aside className="flex w-64 shrink-0 flex-col border-r">
            {tabs}
            <div className="space-y-2 border-b p-3">
              {canEdit &&
                (listAction ?? (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 w-full justify-start gap-1.5 text-xs"
                    onClick={() => editor.create()}
                  >
                    <Plus className="size-3.5" />
                    {nouns.fresh}
                  </Button>
                ))}
              {editor.rows.length > 6 && (
                <div className="relative">
                  <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
                  <input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder={$t('Rechercher…')}
                    aria-label={$t('Rechercher')}
                    className="h-8 w-full rounded-lg border bg-muted/40 pr-2 pl-8 text-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/25"
                  />
                </div>
              )}
            </div>
            <ul className="flex-1 overflow-y-auto p-1.5 scroll-discret">
              {shown.map((row) => {
                const live = row.id === selectedId && values ? values : row.values
                const active = row.id === selectedId
                const inactive = hasActive && !bool(live.Actif)
                return (
                  <li key={row.id}>
                    <button
                      type="button"
                      aria-current={active ? 'true' : undefined}
                      onClick={() => editor.select(row.id)}
                      className={cn(
                        'relative flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors',
                        active ? 'bg-accent' : 'hover:bg-muted/60',
                      )}
                    >
                      {active && (
                        <span className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-primary" />
                      )}
                      <span
                        className={cn(
                          'flex min-w-0 flex-1 items-center gap-2.5',
                          inactive && 'opacity-55',
                        )}
                      >
                        {item(row, live)}
                      </span>
                      {editor.isDirty(row.id) && (
                        <Hint label={row.id === NEW ? $t('Pas encore enregistré') : $t('Modifié')}>
                          <span className="size-1.5 shrink-0 rounded-full bg-amber-500" />
                        </Hint>
                      )}
                    </button>
                  </li>
                )
              })}
              {shown.length === 0 && editor.rows.length > 0 && (
                <li className="px-3 py-8 text-center text-xs text-muted-foreground">
                  {$t('Aucun résultat.')}
                </li>
              )}
            </ul>
          </aside>

          {values ? (
            <>
              {/* The form. */}
              <section className="w-[30rem] shrink-0 overflow-y-auto border-r scroll-discret">
                <fieldset disabled={!canEdit} className="min-w-0">
                  <div className="flex items-start gap-4 px-6 pt-6 pb-5">
                    <div className="min-w-0 flex-1">
                      <h2 className="truncate text-xl font-semibold tracking-tight">
                        {name || nouns.fresh}
                      </h2>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {selectedId === NEW ? $t('Pas encore enregistré') : table?.label}
                      </p>
                    </div>
                    {hasActive && (
                      <div className="flex items-center gap-2 pt-1">
                        <Label htmlFor={activeId} className="text-xs">
                          {bool(values.Actif) ? $t('Actif') : $t('Désactivé')}
                        </Label>
                        <Switch
                          id={activeId}
                          checked={bool(values.Actif)}
                          onCheckedChange={(on) => editor.set('Actif', on)}
                        />
                      </div>
                    )}
                  </div>

                  {form(values)}

                  {rest.length > 0 && (
                    <FormSection
                      title={$t('Autres réglages')}
                      hint={$t('Des champs du modèle que cet écran ne range pas encore.')}
                    >
                      {rest.map((field) => {
                        const id = `rest-${field.label}`
                        return (
                          <div key={field.label} className="space-y-2">
                            <Label htmlFor={id} className="text-foreground">
                              {field.label}
                            </Label>
                            <FieldInput
                              id={id}
                              field={field}
                              value={values[field.label]}
                              onChange={(value) => editor.set(field.label, value)}
                              choices={choices}
                              disabled={!canEdit}
                            />
                            {field.description && (
                              <p className="text-xs text-muted-foreground">{field.description}</p>
                            )}
                          </div>
                        )
                      })}
                    </FormSection>
                  )}

                  {canEdit && canDelete && (
                    <div className="border-t px-6 py-5">
                      <Button
                        type="button"
                        variant={confirming ? 'destructive' : 'ghost'}
                        size="sm"
                        className={cn('gap-1.5 text-xs', !confirming && 'text-muted-foreground')}
                        disabled={editor.saving}
                        onClick={() => {
                          if (selectedId === NEW || confirming) void editor.remove()
                          else setConfirming(true)
                        }}
                      >
                        <Trash2 className="size-3.5" />
                        {selectedId === NEW
                          ? $t('Abandonner')
                          : confirming
                            ? $t('Confirmer la suppression')
                            : nouns.remove}
                      </Button>
                    </div>
                  )}
                </fieldset>
              </section>

              {/* What it changes, live. */}
              <section className="hidden min-w-0 flex-1 overflow-y-auto bg-canvas scroll-discret xl:block">
                <div className="mx-auto flex max-w-xl flex-col gap-7 px-8 py-8">
                  {preview(values)}
                </div>
              </section>
            </>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 bg-canvas px-8 text-center">
              <p className="text-sm font-medium">{empty.title}</p>
              <p className="max-w-sm text-sm text-muted-foreground">{empty.text}</p>
              {canEdit && !listAction && (
                <Button size="sm" className="mt-1 gap-1.5" onClick={() => editor.create()}>
                  <Plus className="size-3.5" />
                  {nouns.fresh}
                </Button>
              )}
            </div>
          )}
        </div>
      )}
    </>
  )
}

/** A caption and its card, on the preview's canvas. */
export function PreviewCard({
  label,
  hint,
  children,
  className,
}: {
  readonly label: string
  readonly hint?: ReactNode
  readonly children: ReactNode
  readonly className?: string
}) {
  return (
    <figure className="space-y-2">
      <figcaption className="flex items-baseline justify-between gap-3 px-1">
        <span className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
          {label}
        </span>
        {hint && <span className="text-[11px] text-muted-foreground">{hint}</span>}
      </figcaption>
      <div className={cn('overflow-hidden rounded-xl border bg-background', className)}>
        {children}
      </div>
    </figure>
  )
}

/** Underlined tabs above a studio's list, when a screen holds more than one table. */
export function StudioTabs<T extends string>({
  value,
  onChange,
  tabs,
}: {
  readonly value: T
  readonly onChange: (value: T) => void
  readonly tabs: readonly { readonly value: T; readonly label: string; readonly count: number }[]
}) {
  return (
    <div role="tablist" className="flex shrink-0 gap-4 border-b px-3 pt-2.5">
      {tabs.map((tab) => (
        <button
          key={tab.value}
          type="button"
          role="tab"
          aria-selected={tab.value === value}
          onClick={() => onChange(tab.value)}
          className={cn(
            'relative flex items-center gap-1.5 pb-2.5 text-xs font-medium transition-colors',
            tab.value === value
              ? 'text-foreground after:absolute after:inset-x-0 after:-bottom-px after:h-0.5 after:rounded-full after:bg-primary'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {tab.label}
          <span className="text-[11px] text-muted-foreground tabular-nums">{tab.count}</span>
        </button>
      ))}
    </div>
  )
}
