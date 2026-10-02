import { lookup } from 'node:dns/promises'
import { BlockList, isIP } from 'node:net'

/**
 * Where a webhook may call — basedb's rule (D17): HTTPS, port 443, to a PUBLIC address. The
 * chat's server sits inside a network: a webhook must not become a way into it. Every
 * address the name gives is checked, at creation and before each call; a refusal says no
 * more than that.
 *
 *   CHAT_WEBHOOK_ALLOW   names, `*.domains` or CIDR ranges trusted even when private
 *   CHAT_WEBHOOK_DEV=1   development: HTTP and private addresses allowed
 */

const reserved = new BlockList()
for (const [address, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const) {
  reserved.addSubnet(address, prefix, 'ipv4')
}
for (const [address, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
  ['2001:db8::', 32],
  ['64:ff9b::', 96],
] as const) {
  reserved.addSubnet(address, prefix, 'ipv6')
}

const development = () => process.env.CHAT_WEBHOOK_DEV === '1'

/** The trusted names and ranges of `CHAT_WEBHOOK_ALLOW`. */
function trusted(host: string, address: string | null): boolean {
  const rules = (process.env.CHAT_WEBHOOK_ALLOW ?? '')
    .split(',')
    .map((r) => r.trim().toLowerCase())
    .filter(Boolean)
  for (const rule of rules) {
    if (rule.includes('/') && address) {
      const [range = '', bits = '0'] = rule.split('/')
      const list = new BlockList()
      const family = isIP(range) === 6 ? 'ipv6' : 'ipv4'
      list.addSubnet(range, Number(bits), family)
      if (list.check(address, isIP(address) === 6 ? 'ipv6' : 'ipv4')) return true
    } else if (rule.startsWith('*.') ? host.endsWith(rule.slice(1)) : host === rule) {
      return true
    }
  }
  return false
}

/**
 * The IPv4 inside an IPv4-mapped IPv6 address — `::ffff:10.0.0.1`, or `::ffff:a00:1` as
 * `URL` writes it —, or the address as it is.
 */
function unmapped(address: string): string {
  const lower = address.toLowerCase()
  if (!lower.startsWith('::ffff:')) return address
  const rest = lower.slice(7)
  if (isIP(rest) === 4) return rest
  const hex = /^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(rest)
  if (!hex) return address
  const [high, low] = [Number.parseInt(hex[1] ?? '0', 16), Number.parseInt(hex[2] ?? '0', 16)]
  return [high >> 8, high & 255, low >> 8, low & 255].join('.')
}

/** An address is public: not one of the reserved ranges, an IPv4 mapped in IPv6 unwrapped. */
function isPublic(address: string): boolean {
  const unwrapped = unmapped(address)
  const family = isIP(unwrapped) === 6 ? 'ipv6' : 'ipv4'
  return !reserved.check(unwrapped, family)
}

/** The URL is shaped right — HTTPS, no user, port 443 —, or `null`. Without DNS. */
export function shapedTarget(raw: string): URL | null {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return null
  }
  if (url.username || url.password) return null
  if (development()) return url.protocol === 'https:' || url.protocol === 'http:' ? url : null
  if (url.protocol !== 'https:' || (url.port !== '' && url.port !== '443')) return null
  return url
}

/** Whether the webhook may call this URL now: its shape, and every address its name gives. */
export async function allowedTarget(raw: string): Promise<boolean> {
  const url = shapedTarget(raw)
  if (!url) return false
  if (development()) return true
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase()
  const addresses = isIP(host)
    ? [host]
    : await lookup(host, { all: true })
        .then((found) => found.map((a) => a.address))
        .catch(() => [] as string[])
  if (addresses.length === 0) return false
  return addresses.every((address) => isPublic(address) || trusted(host, unmapped(address)))
}
