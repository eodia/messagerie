'use client'

/**
 * This device's alerts while the inbox is closed (D23): the service worker (`/sw.js`)
 * subscribes to the browser's push service with the chat server's key, and the server
 * keeps the subscription — one per device, per agent.
 *
 * - `unsupported`: no Web Push in this browser.
 * - `install`: an iPhone or an iPad, the inbox not installed — Safari pushes only to an
 *   application of the home screen.
 * - `denied`: the browser refuses notifications to this site.
 */
export type PushState = 'unsupported' | 'install' | 'denied' | 'off' | 'on'

const WORKER = '/sw.js'

const supported = () =>
  typeof window !== 'undefined' &&
  'serviceWorker' in navigator &&
  'PushManager' in window &&
  typeof Notification !== 'undefined'

const appleMobile = () =>
  /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)

const installed = () =>
  window.matchMedia('(display-mode: standalone)').matches ||
  (navigator as Navigator & { standalone?: boolean }).standalone === true

/** The key as `PushManager.subscribe` takes it. */
function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4))
  const bytes = new Uint8Array(new ArrayBuffer(raw.length))
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i)
  return bytes
}

const sameKey = (subscription: PushSubscription, serverKey: string) => {
  const given = subscription.options.applicationServerKey
  if (!given) return false
  const a = new Uint8Array(given)
  const b = keyBytes(serverKey)
  return a.length === b.length && a.every((byte, i) => byte === b[i])
}

async function current(): Promise<PushSubscription | null> {
  const registration = await navigator.serviceWorker.getRegistration(WORKER)
  return (await registration?.pushManager.getSubscription()) ?? null
}

export async function pushState(): Promise<PushState> {
  if (!supported()) return appleMobile() && !installed() ? 'install' : 'unsupported'
  if (Notification.permission === 'denied') return 'denied'
  return (await current()) ? 'on' : 'off'
}

/**
 * Subscribes this device — asking the browser first, from the click that wants it — and
 * hands the subscription to the server.
 */
export async function subscribe(
  serverKey: string,
  save: (subscription: PushSubscriptionJSON) => Promise<void>,
): Promise<PushState> {
  if (!supported()) return pushState()
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') return permission === 'denied' ? 'denied' : 'off'
  const registration = await navigator.serviceWorker.register(WORKER, { scope: '/' })
  await navigator.serviceWorker.ready
  let subscription = await registration.pushManager.getSubscription()
  // Subscribed with another key — the server's secret changed —: the old one is dead.
  if (subscription && !sameKey(subscription, serverKey)) {
    await subscription.unsubscribe()
    subscription = null
  }
  subscription ??= await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: keyBytes(serverKey),
  })
  await save(subscription.toJSON())
  return 'on'
}

/** This device gets nothing more: unsubscribed here, forgotten by the server. */
export async function unsubscribe(forget: (endpoint: string) => Promise<void>): Promise<PushState> {
  const subscription = supported() ? await current() : null
  if (subscription) {
    await forget(subscription.endpoint).catch(() => undefined)
    await subscription.unsubscribe()
  }
  return pushState()
}

/**
 * At each start: a subscription made with an old key is made again, and the server is
 * told this device's again — a push service may have changed its address.
 */
export async function refresh(
  serverKey: string,
  save: (subscription: PushSubscriptionJSON) => Promise<void>,
): Promise<PushState> {
  if (!supported() || Notification.permission !== 'granted') return pushState()
  const subscription = await current()
  if (!subscription) return 'off'
  if (!sameKey(subscription, serverKey)) return subscribe(serverKey, save)
  await save(subscription.toJSON())
  return 'on'
}
