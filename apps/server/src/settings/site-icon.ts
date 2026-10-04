import { isIP } from 'node:net'
import { sniff } from '../files/attachments.js'
import { allowedTarget } from '../webhooks/target.js'
import type { Site } from './settings.js'

/**
 * A site's own icon, fetched from its website when « Logo » is empty — for the inbox's site
 * menu. The server asks the site's first domain, never the agents' browsers, and no third
 * party: its page's `apple-touch-icon`, else its largest `icon`, else `/favicon.ico`. Every
 * hop is checked as a webhook's target (no private address), five seconds and a few hundred
 * kilobytes at most; the type is read from the bytes. Kept a day — a miss, an hour.
 */

export interface SiteIcon {
  readonly type: string
  readonly bytes: Uint8Array<ArrayBuffer>
}

const FOUND_MS = 24 * 3600_000
const MISSED_MS = 3600_000
const PAGE_BYTES = 512 * 1024
const ICON_BYTES = 256 * 1024
const TIMEOUT_MS = 5000
const HOPS = 3

const cache = new Map<string, { readonly at: number; readonly icon: SiteIcon | null }>()

/** Fetches `url`, following redirects that stay allowed; its bytes, up to `limit`. */
async function fetchBounded(
  url: string,
  limit: number,
): Promise<{ readonly url: string; readonly bytes: Uint8Array<ArrayBuffer> } | null> {
  let current = url
  for (let hop = 0; hop <= HOPS; hop++) {
    if (!(await allowedTarget(current))) return null
    const response = await fetch(current, {
      redirect: 'manual',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { 'user-agent': 'Messagerie (site icon)', accept: '*/*' },
    }).catch(() => null)
    if (!response) return null
    if (response.status >= 300 && response.status < 400) {
      const next = response.headers.get('location')
      if (!next) return null
      current = new URL(next, current).toString()
      continue
    }
    if (!response.ok || !response.body) return null
    const length = Number(response.headers.get('content-length') ?? 0)
    if (length > limit) return null
    const reader = response.body.getReader()
    const chunks: Uint8Array[] = []
    let size = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > limit) {
        await reader.cancel()
        return null
      }
      chunks.push(value)
    }
    const bytes = new Uint8Array(size)
    let at = 0
    for (const chunk of chunks) {
      bytes.set(chunk, at)
      at += chunk.byteLength
    }
    return { url: current, bytes }
  }
  return null
}

/** An image's type from its bytes: those `sniff` knows, an icon, or an SVG. */
function imageType(bytes: Uint8Array): string | null {
  const known = sniff(bytes, '')
  if (known?.startsWith('image/')) return known
  if (bytes[0] === 0 && bytes[1] === 0 && bytes[2] === 1 && bytes[3] === 0) return 'image/x-icon'
  const head = new TextDecoder().decode(bytes.subarray(0, 1024)).trimStart().toLowerCase()
  if (head.startsWith('<svg') || (head.startsWith('<?xml') && head.includes('<svg'))) {
    return 'image/svg+xml'
  }
  return null
}

const attribute = (tag: string, name: string): string | null => {
  const found = new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag)
  return found ? (found[2] ?? found[3] ?? found[4] ?? null) : null
}

/** The icons a home page declares, the best first: Apple's, then the largest. */
export function iconsOf(html: string, page: string): string[] {
  const ranked: { readonly href: string; readonly rank: number }[] = []
  for (const [tag] of html.matchAll(/<link\b[^>]*>/gi)) {
    const rel = (attribute(tag, 'rel') ?? '').toLowerCase().split(/\s+/)
    const href = attribute(tag, 'href')
    if (!href || !(rel.includes('icon') || rel.some((r) => r.startsWith('apple-touch-icon')))) {
      continue
    }
    let url: string
    try {
      url = new URL(href, page).toString()
    } catch {
      continue
    }
    const apple = rel.some((r) => r.startsWith('apple-touch-icon'))
    const size = Math.max(
      0,
      ...(attribute(tag, 'sizes') ?? '')
        .split(/\s+/)
        .map((s) => Number(s.toLowerCase().split('x')[0]) || 0),
    )
    // Apple's is large and square; then the largest declared; an SVG scales.
    const svg = /\.svg(\?|$)/i.test(url) || (attribute(tag, 'type') ?? '').includes('svg')
    ranked.push({ href: url, rank: apple ? 10_000 : svg ? 5000 : size })
  }
  return ranked.sort((a, b) => b.rank - a.rank).map((r) => r.href)
}

async function fetchIcon(domain: string): Promise<SiteIcon | null> {
  const home = `https://${domain}/`
  const page = await fetchBounded(home, PAGE_BYTES)
  const declared = page ? iconsOf(new TextDecoder().decode(page.bytes), page.url) : []
  for (const candidate of [...declared, new URL('/favicon.ico', page?.url ?? home).toString()]) {
    const got = await fetchBounded(candidate, ICON_BYTES)
    const type = got ? imageType(got.bytes) : null
    if (got && type) return { type, bytes: got.bytes }
  }
  return null
}

/** The domains worth asking: host names, not `localhost` nor a bare address. */
const askable = (domains: readonly string[]) =>
  domains.filter((d) => d !== 'localhost' && d.includes('.') && isIP(d) === 0).slice(0, 3)

/** The site's icon, from the first of its domains that gives one — cached; `null`: none. */
export async function siteIcon(
  site: Pick<Site, 'domains'>,
  now = Date.now(),
): Promise<SiteIcon | null> {
  for (const domain of askable(site.domains)) {
    const kept = cache.get(domain)
    const icon =
      kept && now - kept.at < (kept.icon ? FOUND_MS : MISSED_MS)
        ? kept.icon
        : await fetchIcon(domain).catch(() => null)
    if (!kept || kept.icon !== icon) cache.set(domain, { at: now, icon })
    if (icon) return icon
  }
  return null
}
