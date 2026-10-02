import { type SQL, sql } from 'drizzle-orm'
import type { AnyPgColumn } from 'drizzle-orm/pg-core'

/**
 * The agent rows nobody signs in with: what an API token writes under (`token:<prefix>`,
 * D16) and what an automation acts as (`automation:<id>`, D20). Never active, never listed
 * among the agents; their names sign what they did in the threads.
 */

const PROGRAM = /^(token|automation):/

export const isProgram = (agent: { readonly login: string }): boolean => PROGRAM.test(agent.login)

/** Where `login` is a person's. */
export const person = (login: AnyPgColumn): SQL => sql`${login} !~ '^(token|automation):'`
