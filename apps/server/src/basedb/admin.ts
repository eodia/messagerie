/**
 * What the chat asks of basedb as one of its administrators — only at installation, by
 * `pnpm provision` and `pnpm basedb:setup`, never by the running server: sign in, create
 * the « Messagerie » base from the template (B1), confirm the password, and issue the
 * chat's integration token.
 */

export class AdminFailure extends Error {}

/** A signed-in administrator: the session's cookies, as a browser keeps and echoes them. */
export interface AdminSession {
  readonly url: string
  readonly tenant: string
  readonly email: string
  readonly password: string
  cookies: string[]
}

const csrfOf = (session: AdminSession) =>
  session.cookies.find((c) => c.startsWith('__Host-basedb_csrf='))?.split('=')[1] ?? ''

function keep(session: AdminSession, response: Response): void {
  const fresh = response.headers.getSetCookie().map((c) => c.split(';')[0] ?? '')
  if (fresh.length === 0) return
  const names = new Set(fresh.map((c) => c.split('=')[0]))
  session.cookies = [...session.cookies.filter((c) => !names.has(c.split('=')[0])), ...fresh]
}

export async function signIn(
  url: string,
  tenant: string,
  email: string,
  password: string,
): Promise<AdminSession> {
  const session: AdminSession = { url, tenant, email, password, cookies: [] }
  const login = await fetch(`${url}/auth/password/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  }).catch(() => {
    throw new AdminFailure(`basedb ne répond pas à ${url}`)
  })
  if (!login.ok) throw new AdminFailure(`connexion refusée (${login.status})`)
  keep(session, login)
  if (!csrfOf(session)) throw new AdminFailure('pas de cookie de session dans la réponse')
  return session
}

/** An access token of the session — anew after an elevation, which changes the session. */
export async function accessToken(session: AdminSession): Promise<string> {
  const response = await fetch(`${session.url}/auth/session/access`, {
    method: 'POST',
    headers: { cookie: session.cookies.join('; '), 'x-basedb-csrf': csrfOf(session) },
  })
  if (!response.ok) throw new AdminFailure(`pas de jeton d’accès (${response.status})`)
  const { data } = (await response.json()) as { data: { token: string } }
  return data.token
}

/** Who the session is: basedb's account id — the value a « Personne » field holds. */
export async function whoAmI(
  session: AdminSession,
): Promise<{ readonly id: string; readonly email: string }> {
  const response = await fetch(`${session.url}/auth/me`, {
    headers: { cookie: session.cookies.join('; ') },
  })
  if (!response.ok) throw new AdminFailure(`compte introuvable (${response.status})`)
  const { data } = (await response.json()) as { data: { id: string; email: string } }
  return { id: data.id, email: data.email }
}

/** The password, confirmed: issuing a token asks for a session elevated minutes ago. */
export async function elevate(session: AdminSession): Promise<void> {
  const response = await fetch(`${session.url}/auth/elevate`, {
    method: 'POST',
    headers: {
      cookie: session.cookies.join('; '),
      'x-basedb-csrf': csrfOf(session),
      'content-type': 'application/json',
    },
    body: JSON.stringify({ password: session.password }),
  })
  if (!response.ok)
    throw new AdminFailure(`confirmation du mot de passe refusée (${response.status})`)
  keep(session, response)
}

const api = (session: AdminSession, path: string) =>
  `${session.url}/api/v1/${encodeURIComponent(session.tenant)}${path}`

export interface BaseSummary {
  readonly name: string
  readonly label: string
}

/** The bases this administrator sees, with their ids — which the access grid speaks. */
export async function listBases(
  session: AdminSession,
  token: string,
): Promise<(BaseSummary & { readonly id: string })[]> {
  const response = await fetch(api(session, '/meta/bases'), {
    headers: { authorization: `Bearer ${token}` },
  })
  if (!response.ok) throw new AdminFailure(`liste des bases refusée (${response.status})`)
  const { data } = (await response.json()) as {
    data: { id: string; name: string; label: string }[]
  }
  return data.map(({ id, name, label }) => ({ id, name, label }))
}

interface TemplateTable {
  readonly label: string
  readonly fields: readonly {
    readonly label: string
    readonly kind: string
    readonly description?: string
    readonly options?: readonly { readonly label: string; readonly color?: string }[]
  }[]
}

/** The kinds a field can be added with alone — not computed, not a relation. */
const ADDABLE = new Set([
  'short_text',
  'long_text',
  'url',
  'number',
  'boolean',
  'date',
  'select',
  'multi_select',
  'user',
])

const slug = (text: string) =>
  text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')

/**
 * Brings an existing base up to the template: the fields a newer template declares and
 * the base lacks are added — never one removed, renamed or changed, which is a person's
 * decision in basedb. Returns what was added, as « Table › Champ ». A relation, a count
 * or a table missing altogether is reported, not made: `missing`.
 */
export async function evolveBase(
  session: AdminSession,
  token: string,
  base: string,
  template: { readonly tables: readonly TemplateTable[] },
): Promise<{ added: string[]; missing: string[] }> {
  const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' }
  const described = await fetch(api(session, `/meta/bases/${encodeURIComponent(base)}`), {
    headers,
  })
  if (!described.ok) throw new AdminFailure(`description refusée (${described.status})`)
  const { data } = (await described.json()) as {
    data: { tables: { name: string; label: string; fields: { label: string }[] }[] }
  }
  const added: string[] = []
  const missing: string[] = []
  for (const wanted of template.tables) {
    const table = data.tables.find((t) => t.label === wanted.label)
    if (!table) {
      missing.push(wanted.label)
      continue
    }
    for (const field of wanted.fields) {
      if (table.fields.some((f) => f.label === field.label)) continue
      const where = `${wanted.label} › ${field.label}`
      if (!ADDABLE.has(field.kind)) {
        missing.push(where)
        continue
      }
      const response = await fetch(
        api(
          session,
          `/admin/bases/${encodeURIComponent(base)}/tables/${encodeURIComponent(table.name)}/fields`,
        ),
        {
          method: 'POST',
          headers,
          body: JSON.stringify({
            label: field.label,
            kind: field.kind,
            description: field.description ?? null,
            ...(field.options
              ? {
                  options: field.options.map((o) => ({
                    value: slug(o.label),
                    label: o.label,
                    color: o.color ?? null,
                  })),
                }
              : {}),
          }),
        },
      )
      if (!response.ok) {
        throw new AdminFailure(
          `champ ${where} refusé (${response.status}) ${await response.text()}`,
        )
      }
      added.push(where)
    }
  }
  return { added, missing }
}

/**
 * A group that may edit a base — created if it has no namesake, given `edit` on the base
 * otherwise kept as it is. The session must be elevated. Returns the group's id.
 */
export async function groupEditing(
  session: AdminSession,
  label: string,
  baseId: string,
): Promise<string> {
  const token = await accessToken(session)
  const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' }
  const listed = await fetch(api(session, '/admin/groups'), { headers })
  if (!listed.ok) throw new AdminFailure(`liste des groupes refusée (${listed.status})`)
  const { data: groups } = (await listed.json()) as { data: { id: string; label: string }[] }
  let id = groups.find((g) => g.label === label)?.id
  if (!id) {
    const created = await fetch(api(session, '/admin/groups'), {
      method: 'POST',
      headers,
      body: JSON.stringify({ label }),
    })
    if (!created.ok)
      throw new AdminFailure(`groupe refusé (${created.status}) ${await created.text()}`)
    id = ((await created.json()) as { data: { id: string } }).data.id
  }
  const granted = await fetch(api(session, '/admin/access'), {
    method: 'POST',
    headers,
    body: JSON.stringify({
      changes: [{ group: id, scope: { kind: 'base', id: baseId }, level: 'edit' }],
    }),
  })
  if (!granted.ok)
    throw new AdminFailure(`droit refusé (${granted.status}) ${await granted.text()}`)
  return id
}

interface Step {
  readonly kind: string
  readonly label?: string
  readonly table?: string
  readonly index?: number
  readonly count?: number
}

function describe(step: Step): string {
  switch (step.kind) {
    case 'table':
      return `table ${step.index ?? '?'}/${step.count ?? '?'} : ${step.label}`
    case 'fields':
      return `champs : ${step.table}`
    case 'rows':
      return `lignes : ${step.table}`
    case 'row_links':
      return 'relations entre les lignes'
    default:
      return `${step.kind}${step.label ? ` : ${step.label}` : ''}`
  }
}

/**
 * Creates a base from a template, the whole base or none, telling each step as it starts.
 */
export async function createBase(
  session: AdminSession,
  token: string,
  request: { readonly template: unknown; readonly label: string; readonly rows: boolean },
  onStep: (text: string) => void = () => {},
): Promise<BaseSummary> {
  const response = await fetch(api(session, '/admin/bases'), {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      accept: 'application/x-ndjson',
    },
    body: JSON.stringify(request),
  })
  if (!response.ok || !response.body) {
    throw new AdminFailure(`création refusée (${response.status}) ${await response.text()}`)
  }
  // One JSON object a line: the steps as they start, then the base — or the refusal.
  let last: unknown = null
  let buffer = ''
  const decoder = new TextDecoder()
  const line = (text: string) => {
    if (!text) return
    const value = JSON.parse(text) as { step?: Step }
    if (value.step) onStep(describe(value.step))
    else last = value
  }
  for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
    buffer += decoder.decode(chunk, { stream: true })
    let end = buffer.indexOf('\n')
    while (end !== -1) {
      line(buffer.slice(0, end).trim())
      buffer = buffer.slice(end + 1)
      end = buffer.indexOf('\n')
    }
  }
  line(buffer.trim())
  const outcome = last as {
    data?: { name: string; label: string }
    error?: { code: string; details?: unknown }
  } | null
  if (!outcome?.data) {
    throw new AdminFailure(`création refusée : ${JSON.stringify(outcome?.error ?? outcome)}`)
  }
  return { name: outcome.data.name, label: outcome.data.label }
}

/** An integration token of a base; its secret is in this answer and nowhere else, ever. */
export async function issueToken(
  session: AdminSession,
  base: string,
  label: string,
  access: 'read' | 'write',
): Promise<string> {
  await elevate(session)
  const response = await fetch(api(session, '/admin/tokens'), {
    method: 'POST',
    headers: {
      authorization: `Bearer ${await accessToken(session)}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ label, base, access, surfaces: ['rest'] }),
  })
  if (!response.ok) {
    throw new AdminFailure(`jeton refusé (${response.status}) ${await response.text()}`)
  }
  const { data } = (await response.json()) as { data: { secret: string } }
  return data.secret
}
