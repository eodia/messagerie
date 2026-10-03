import { sql } from 'drizzle-orm'
import type { Db } from '../db/client.js'

/**
 * An agent's alerts beyond the open inbox (D23): a line written in their bell also waits
 * to reach their phone — fifteen seconds, time enough to read it at their desk — and, if
 * they asked, their mailbox — ten minutes. Read meanwhile, it goes nowhere.
 */

export const PUSH_DELAY_SECONDS = 15
export const EMAIL_DELAY_SECONDS = 600

/** Inside the transaction that wrote the lines `notificationIds`. */
export async function queueAlerts(tx: Db, notificationIds: readonly string[]): Promise<void> {
  if (notificationIds.length === 0) return
  const ids = sql`array[${sql.join(
    notificationIds.map((id) => sql`${id}::uuid`),
    sql`, `,
  )}]`
  // One push waiting per line, one e-mail per line ever: a line brought back to the top by
  // a fifth message rings the phone again once the last push left, never the mailbox.
  await tx.execute(sql`
    insert into chat.outbound (channel, purpose, conversation_id, notification_id, agent_id, next_attempt_at)
    select 'push', 'agent_alert', n.conversation_id, n.id, n.agent_id,
      now() + make_interval(secs => ${PUSH_DELAY_SECONDS})
    from chat.notification n
    where n.id = any(${ids}) and n.read_at is null
      and exists (select 1 from chat.push_subscription s where s.agent_id = n.agent_id)
    on conflict do nothing`)
  await tx.execute(sql`
    insert into chat.outbound (channel, purpose, conversation_id, notification_id, agent_id, next_attempt_at)
    select 'email', 'agent_alert', n.conversation_id, n.id, n.agent_id,
      now() + make_interval(secs => ${EMAIL_DELAY_SECONDS})
    from chat.notification n
    join chat.agent a on a.id = n.agent_id
    where n.id = any(${ids}) and n.read_at is null and a.email_alerts and a.active
    on conflict do nothing`)
}
