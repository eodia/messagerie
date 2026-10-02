import { describe, expect, it } from 'vitest'
import type { AgentRow } from '../../src/inbox/read.js'
import {
  createRow,
  deleteRow,
  settingsRows,
  settingsSchema,
  updateRow,
} from '../../src/inbox/settings-screen.js'
import { MemorySource } from '../../src/settings/demo.js'
import { Settings } from '../../src/settings/settings.js'

/** The settings screens: the template's fields, each value checked, written by a supervisor. */

const supervisor = { id: 'a1', role: 'supervisor', login: 'dev-marc' } as AgentRow
const agent = { id: 'a2', role: 'agent', login: 'other' } as AgentRow
const fresh = () => new Settings(new MemorySource('dev-marc'))

describe('the schema', () => {
  it('takes the template’s tables, fields and relations', () => {
    const inboxes = settingsSchema().find((t) => t.key === 'boites')
    expect(inboxes?.label).toBe('Boîtes de réception')
    expect(inboxes?.fields.find((f) => f.label === 'Équipes')).toMatchObject({
      kind: 'multi_link',
      target: 'equipes',
    })
    expect(inboxes?.fields.find((f) => f.label === 'Nom')).toMatchObject({ required: true })
    const agents = settingsSchema().find((t) => t.key === 'conseillers')
    expect(agents?.fields.find((f) => f.label === 'Rôle')?.options).toEqual([
      'Conseiller',
      'Superviseur',
    ])
  })

  it('leaves out computed fields', () => {
    const kinds = settingsSchema().flatMap((t) => t.fields.map((f) => f.kind))
    expect(kinds).not.toContain('count')
  })
})

describe('a row', () => {
  it('is read by supervisors alone, but for the knowledge base and its sites', async () => {
    const settings = fresh()
    for (const key of ['boites', 'equipes', 'conseillers', 'garde_fous', 'outils_ia']) {
      await expect(settingsRows(settings, agent, key)).rejects.toMatchObject({
        code: 'NOT_ALLOWED',
      })
    }
    for (const key of ['articles', 'categories', 'sites']) {
      await expect(settingsRows(settings, agent, key)).resolves.toBeInstanceOf(Array)
    }
  })

  it('is created, changed and deleted by a supervisor', async () => {
    const settings = fresh()
    const created = await createRow(settings, supervisor, 'equipes', {
      Nom: 'Équipe Prévoyance',
      Description: 'Les contrats de prévoyance.',
    })
    await updateRow(settings, supervisor, 'equipes', created.id, { Description: 'Revue.' })
    const rows = await settingsRows(settings, supervisor, 'equipes')
    expect(rows.find((r) => r.id === created.id)?.values).toMatchObject({
      Nom: 'Équipe Prévoyance',
      Description: 'Revue.',
    })
    // The inboxes see it at once: the cache was forgotten.
    expect((await settings.teams()).some((t) => t.name === 'Équipe Prévoyance')).toBe(true)
    await deleteRow(settings, supervisor, 'equipes', created.id)
    expect(
      (await settingsRows(settings, supervisor, 'equipes')).some((r) => r.id === created.id),
    ).toBe(false)
  })

  it('is refused to an agent', async () => {
    await expect(createRow(fresh(), agent, 'equipes', { Nom: 'Non' })).rejects.toMatchObject({
      code: 'NOT_ALLOWED',
    })
  })

  it('refuses a value its field cannot hold, and a missing required one', async () => {
    const settings = fresh()
    await expect(
      createRow(settings, supervisor, 'conseillers', { Nom: 'X', Rôle: 'Directeur' }),
    ).rejects.toMatchObject({ details: { field: 'Rôle' } })
    await expect(
      createRow(settings, supervisor, 'boites', { Nom: 'X', Équipes: 'support' }),
    ).rejects.toMatchObject({ details: { field: 'Équipes' } })
    await expect(
      createRow(settings, supervisor, 'boites', { Description: 'Sans nom' }),
    ).rejects.toMatchObject({ details: { field: 'Nom', reason: 'required' } })
    await expect(createRow(settings, supervisor, 'boites', { Inconnu: 1 })).rejects.toMatchObject({
      details: { field: 'Inconnu' },
    })
  })

  it('empties a text with an empty value, and a relation with null', async () => {
    const settings = fresh()
    await updateRow(settings, supervisor, 'boites', 'sinistres', {
      Description: '   ',
      'Équipe par défaut': null,
      Équipes: null,
    })
    const row = (await settingsRows(settings, supervisor, 'boites')).find(
      (r) => r.id === 'sinistres',
    )
    expect(row?.values).toMatchObject({ Description: null, 'Équipe par défaut': null, Équipes: [] })
  })
})

describe('an inbox’s look', () => {
  it('is its colour, its pictogram and its picture — a script never', async () => {
    const settings = fresh()
    const look = async () => (await settings.inboxes()).find((i) => i.id === 'sinistres')
    expect(await look()).toMatchObject({ color: '#EA580C', icon: 'droplet', image: null })

    const picture = 'data:image/webp;base64,UklGRhYAAABXRUJQVlA4'
    await updateRow(settings, supervisor, 'boites', 'sinistres', {
      Pictogramme: null,
      Image: picture,
    })
    expect(await look()).toMatchObject({ icon: null, image: picture })

    for (const bad of [
      'javascript:alert(1)',
      'data:image/svg+xml;base64,PHN2Zz4=',
      'http://x.fr/a.png',
    ]) {
      await updateRow(settings, supervisor, 'boites', 'sinistres', { Image: bad })
      expect((await look())?.image).toBeNull()
    }
    await updateRow(settings, supervisor, 'boites', 'sinistres', {
      Pictogramme: 'Shield Alert',
    })
    expect((await look())?.icon).toBeNull()
  })
})
