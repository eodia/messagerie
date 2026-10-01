'use client'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { api } from '@/lib/api'
import { $t } from '@/lib/i18n'
import { messageFor } from '@/lib/messages'
import type { SettingsField, SettingsRow, SettingsTable } from '@chat/contracts'
import { LoaderCircle, Trash2 } from 'lucide-react'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { type Choices, FieldInput } from './field-input'
import { viewOf } from './views'

/**
 * A row of a settings table, in a form: every field the template declares, but those edited
 * on another screen. A new row starts « Actif »; saving sends what changed, and basedb
 * applies the supervisor's rights.
 */

const empty = (field: SettingsField): unknown =>
  field.kind === 'boolean'
    ? field.label === 'Actif'
    : field.kind === 'multi_select' || field.kind === 'multi_link'
      ? []
      : null

/** The value as the server takes it: an emptied text is no value. */
const normalized = (value: unknown): unknown =>
  typeof value === 'string' && value.trim() === '' ? null : value

export function RowEditor({
  table,
  row,
  title,
  choices,
  canEdit,
  onClose,
  onSaved,
}: {
  readonly table: SettingsTable
  /** Null: a new row. */
  readonly row: SettingsRow | null
  readonly title: string
  readonly choices: Choices
  readonly canEdit: boolean
  readonly onClose: () => void
  readonly onSaved: () => void
}) {
  const view = viewOf(table.key)
  const fields = table.fields.filter((f) => !view.hidden?.includes(f.label))
  const [values, setValues] = useState<Record<string, unknown>>({})
  const [busy, setBusy] = useState<'save' | 'delete' | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // biome-ignore lint/correctness/useExhaustiveDependencies: a new row or another one resets the form
  useEffect(() => {
    setValues(
      Object.fromEntries(
        fields.map((f) => [f.label, row ? (row.values[f.label] ?? empty(f)) : empty(f)]),
      ),
    )
    setConfirming(false)
    setError(null)
  }, [row, table.key])

  const missing = fields.some((f) => {
    const value = normalized(values[f.label])
    return f.required && (value === null || value === undefined)
  })

  async function save() {
    const changed: Record<string, unknown> = {}
    for (const field of fields) {
      const value = normalized(values[field.label])
      const before = row ? normalized(row.values[field.label] ?? empty(field)) : empty(field)
      if (JSON.stringify(value) !== JSON.stringify(before) || (!row && value !== null)) {
        changed[field.label] = value
      }
    }
    setBusy('save')
    setError(null)
    try {
      if (row) await api.updateRow(table.key, row.id, changed)
      else await api.createRow(table.key, changed)
      onSaved()
    } catch (failure) {
      setError((failure as { code?: string }).code ?? 'INTERNAL_ERROR')
    } finally {
      setBusy(null)
    }
  }

  async function remove() {
    if (!row) return
    setBusy('delete')
    setError(null)
    try {
      await api.deleteRow(table.key, row.id)
      onSaved()
    } catch (failure) {
      setError((failure as { code?: string }).code ?? 'INTERNAL_ERROR')
      setConfirming(false)
    } finally {
      setBusy(null)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex max-h-[88vh] max-w-2xl flex-col gap-0 p-0">
        <DialogHeader className="border-b px-6 pt-5 pb-4">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{table.label}</DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 py-5 scroll-discret">
          {view.elsewhere && (
            <p className="rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
              {$t('Ailleurs :')}{' '}
              <Link href={view.elsewhere.href} className="font-medium text-foreground underline">
                {$t(view.elsewhere.label)}
              </Link>
            </p>
          )}
          {fields.map((field) => {
            const id = `field-${table.key}-${field.label}`
            const inline = field.kind === 'boolean'
            return (
              <div key={field.label} className={inline ? 'flex items-start gap-3' : 'space-y-2'}>
                <div className={inline ? 'min-w-0 flex-1 space-y-1' : 'space-y-1'}>
                  <Label htmlFor={id} className="text-foreground">
                    {field.label}
                    {field.required && <span className="text-destructive">*</span>}
                  </Label>
                  {field.description && (
                    <p className="text-xs text-muted-foreground">{field.description}</p>
                  )}
                </div>
                <FieldInput
                  id={id}
                  field={field}
                  value={values[field.label]}
                  onChange={(value) => setValues((all) => ({ ...all, [field.label]: value }))}
                  choices={choices}
                  disabled={!canEdit}
                />
              </div>
            )
          })}
        </div>

        <DialogFooter className="items-center border-t px-6 py-3 sm:justify-between">
          <div className="flex items-center gap-2">
            {row && canEdit && (
              <Button
                type="button"
                variant={confirming ? 'destructive' : 'ghost'}
                size="sm"
                disabled={busy !== null}
                onClick={() => (confirming ? void remove() : setConfirming(true))}
                className="gap-1.5"
              >
                {busy === 'delete' ? (
                  <LoaderCircle className="size-3.5 animate-spin" />
                ) : (
                  <Trash2 className="size-3.5" />
                )}
                {confirming ? $t('Confirmer la suppression') : $t('Supprimer')}
              </Button>
            )}
            {error && <span className="text-xs text-destructive">{messageFor(error)}</span>}
          </div>
          <div className="flex items-center gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={onClose}>
              {canEdit ? $t('Annuler') : $t('Fermer')}
            </Button>
            {canEdit && (
              <Button
                type="button"
                size="sm"
                disabled={busy !== null || missing}
                onClick={() => void save()}
                className="gap-1.5"
              >
                {busy === 'save' && <LoaderCircle className="size-3.5 animate-spin" />}
                {row ? $t('Enregistrer') : $t('Ajouter')}
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
