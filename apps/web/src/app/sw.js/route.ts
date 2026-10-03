/**
 * The inbox's service worker (D23): it receives the alerts the chat server pushes to this
 * device while the inbox is closed — a phone in a pocket —, shows them, and opens the
 * conversation when one is touched. Served by a route rather than a file of `public/`, so
 * that the self-contained server of the Docker image carries it.
 *
 * An inbox in front already rang (`lib/alerts.ts`): the alert then stays silent. A
 * notification has the tag of the inbox's own, `conversation-<id>`: one replaces the
 * other rather than both showing.
 */
const WORKER = `
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))

self.addEventListener('push', (event) => {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch (_) {}
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    if (windows.some((w) => w.visibilityState === 'visible' && w.focused)) return
    await self.registration.showNotification(data.title || 'Messagerie', {
      body: data.body || '',
      tag: data.conversationId ? 'conversation-' + data.conversationId : undefined,
      renotify: Boolean(data.conversationId),
      icon: '/icon.svg',
      badge: '/icon.svg',
      data: { url: data.url || '/conversations' },
    })
  })())
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = new URL((event.notification.data && event.notification.data.url) || '/', self.location.origin).href
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    const open = windows.find((w) => new URL(w.url).origin === self.location.origin)
    if (open) {
      await open.focus()
      if ('navigate' in open) await open.navigate(url)
      return
    }
    await self.clients.openWindow(url)
  })())
})
`

export function GET(): Response {
  return new Response(WORKER, {
    headers: {
      'content-type': 'text/javascript; charset=utf-8',
      'cache-control': 'no-cache',
      'service-worker-allowed': '/',
    },
  })
}
