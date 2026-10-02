import { Invitation } from '@/components/app/invitation'

/** Read at each request, not frozen at build time: the image serves any instance. */
export const dynamic = 'force-dynamic'

export default async function InvitationPage({
  params,
}: {
  readonly params: Promise<{ token: string }>
}) {
  const { token } = await params
  // `||`, not `??`: an empty variable in a `.env` file means unset.
  const apiUrl = process.env.CHAT_API_URL || 'http://localhost:8810'
  return <Invitation apiUrl={apiUrl} token={token} />
}
