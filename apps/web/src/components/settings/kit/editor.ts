'use client'

import { api } from '@/lib/api'
import type { SettingsField, SettingsRow, SettingsTable } from '@chat/contracts'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { type SettingsData, type Values, codeOf } from './data'

/**
 * Editing a table's rows, as the widget editor edits a site: every change is a draft, kept
 * per row while one goes from row to row, until « Enregistrer » sends what changed. A new
 * row is a draft too — at the top of the list, until it is saved.
 */

export const NEW = 'new'

/** What else a screen saves with a row — a team's members, which are the agents' rows. */
export interface Extras {
  readonly dirty: (id: string) => boolean
  /** After the row: `id` is its id now, `was` the one it was edited under (`new`). */
  readonly save: (id: string, was: string) => Promise<void>
  readonly discard: (id: string) => void
}

export interface RowEditor {
  readonly key: string
  readonly table: SettingsTable | undefined
  /** The saved rows, after the new one being written, if any. */
  readonly rows: readonly SettingsRow[]
  readonly selectedId: string | null
  readonly select: (id: string | null) => void
  /** The selected row as it is being edited. */
  readonly values: Values | null
  readonly set: (label: string, value: unknown) => void
  readonly isDirty: (id: string) => boolean
  readonly dirty: boolean
  readonly anyDirty: boolean
  /** The required fields left empty on the selected row. */
  readonly missing: readonly string[]
  readonly saving: boolean
  readonly savedAt: number | null
  /** Saves the selected row; its id, or null when it failed. */
  readonly save: () => Promise<string | null>
  readonly discard: () => void
  readonly remove: () => Promise<boolean>
  readonly create: (initial?: Values) => void
}

const blank = (field: SettingsField): unknown =>
  field.kind === 'multi_select' || field.kind === 'multi_link' ? [] : null

/** A value as the server compares it: an emptied text is no value. */
function normalized(field: SettingsField, value: unknown): unknown {
  if (value === undefined || value === null) return blank(field)
  if (typeof value === 'string' && value.trim() === '') return null
  if (field.kind === 'link' && Array.isArray(value)) return value[0] ?? null
  return value
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

export function useRowEditor(
  data: SettingsData,
  key: string,
  options: { readonly defaults?: Values; readonly extras?: Extras } = {},
): RowEditor {
  const table = data.table(key)
  const saved = data.rows(key)
  const [drafts, setDrafts] = useState<Readonly<Record<string, Values>>>({})
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const { extras, defaults } = options

  // The first row, once there are rows and none is chosen.
  useEffect(() => {
    const first = saved[0]?.id
    if (selectedId === null && first) setSelectedId((chosen) => chosen ?? first)
  }, [selectedId, saved])

  const original = useCallback(
    (id: string): Values | null => {
      if (id === NEW) return null
      return saved.find((r) => r.id === id)?.values ?? null
    },
    [saved],
  )

  const isDirty = useCallback(
    (id: string): boolean => {
      if (extras?.dirty(id)) return true
      const draft = drafts[id]
      if (!draft || !table) return false
      if (id === NEW) return true
      const before = original(id) ?? {}
      return table.fields.some(
        (f) => !same(normalized(f, draft[f.label]), normalized(f, before[f.label])),
      )
    },
    [drafts, table, original, extras],
  )

  const values: Values | null =
    selectedId === null ? null : (drafts[selectedId] ?? original(selectedId))

  const rows = useMemo(() => {
    const draft = drafts[NEW]
    return draft ? [{ id: NEW, values: draft }, ...saved] : saved
  }, [drafts, saved])

  const set = useCallback(
    (label: string, value: unknown) => {
      if (selectedId === null) return
      setDrafts((all) => ({
        ...all,
        [selectedId]: { ...(all[selectedId] ?? original(selectedId) ?? {}), [label]: value },
      }))
      setSavedAt(null)
    },
    [selectedId, original],
  )

  const missing = useMemo(
    () =>
      values && table
        ? table.fields
            .filter((f) => f.required)
            .filter((f) => {
              const v = normalized(f, values[f.label])
              return v === null || (Array.isArray(v) && v.length === 0)
            })
            .map((f) => f.label)
        : [],
    [values, table],
  )

  const forget = useCallback((id: string) => setDrafts(({ [id]: _, ...others }) => others), [])

  const save = useCallback(async (): Promise<string | null> => {
    if (selectedId === null || !table || !values) return null
    setSaving(true)
    data.setError(null)
    try {
      let id = selectedId
      const before = original(selectedId)
      const changed: Record<string, unknown> = {}
      for (const field of table.fields) {
        if (!(field.label in values)) continue
        const now = normalized(field, values[field.label])
        if (before === null) {
          if (now !== null && !(Array.isArray(now) && now.length === 0)) changed[field.label] = now
        } else if (!same(now, normalized(field, before[field.label]))) {
          changed[field.label] = now
        }
      }
      if (selectedId === NEW) {
        id = (await api.createRow(key, changed)).id
      } else if (Object.keys(changed).length > 0) {
        await api.updateRow(key, selectedId, changed)
      }
      await extras?.save(id, selectedId)
      await data.reload([key])
      forget(selectedId)
      setSelectedId(id)
      setSavedAt(Date.now())
      return id
    } catch (failure) {
      data.setError(codeOf(failure))
      return null
    } finally {
      setSaving(false)
    }
  }, [selectedId, table, values, original, key, data, extras, forget])

  const discard = useCallback(() => {
    if (selectedId === null) return
    forget(selectedId)
    extras?.discard(selectedId)
    if (selectedId === NEW) setSelectedId(saved[0]?.id ?? null)
  }, [selectedId, saved, extras, forget])

  const remove = useCallback(async (): Promise<boolean> => {
    if (selectedId === null) return false
    if (selectedId === NEW) {
      discard()
      return true
    }
    setSaving(true)
    try {
      await api.deleteRow(key, selectedId)
      forget(selectedId)
      await data.reload()
      setSelectedId(saved.find((r) => r.id !== selectedId)?.id ?? null)
      return true
    } catch (failure) {
      data.setError(codeOf(failure))
      return false
    } finally {
      setSaving(false)
    }
  }, [selectedId, key, data, saved, discard, forget])

  const create = useCallback(
    (initial: Values = {}) => {
      const fresh: Record<string, unknown> = {}
      for (const field of table?.fields ?? []) {
        fresh[field.label] = field.label === 'Actif' ? true : blank(field)
      }
      setDrafts((all) => ({ ...all, [NEW]: { ...fresh, ...defaults, ...initial } }))
      setSelectedId(NEW)
      setSavedAt(null)
    },
    [table, defaults],
  )

  const anyDirty = Object.keys(drafts).some(isDirty) || saved.some((r) => extras?.dirty(r.id))

  return {
    key,
    table,
    rows,
    selectedId,
    select: setSelectedId,
    values,
    set,
    isDirty,
    dirty: selectedId !== null && isDirty(selectedId),
    anyDirty,
    missing,
    saving,
    savedAt,
    save,
    discard,
    remove,
    create,
  }
}
