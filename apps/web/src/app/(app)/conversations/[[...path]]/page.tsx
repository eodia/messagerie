import { Inbox } from '@/components/inbox/inbox'

/**
 * Every address of the conversations' screen — `/conversations/<boîte>/<conversation>` —
 * is this one page: the screen reads the address itself (`lib/address.ts`).
 */
export default function ConversationsPage() {
  return <Inbox />
}
