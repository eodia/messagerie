import { Refusal } from './refusal.js'

/**
 * GIPHY, searched for the agents — through the server, so that its key stays here (D5).
 * A GIF chosen is fetched by the server and sent as any file: the visitor's page never
 * asks GIPHY anything. Without `GIPHY_API_KEY`, no GIF.
 */

export interface GifHit {
  readonly id: string
  readonly title: string
  /** A small rendition, for the agent's picker — read from GIPHY by the agent's browser. */
  readonly preview: string
  readonly width: number
  readonly height: number
}

interface Rendition {
  readonly url?: string
  readonly webp?: string
  readonly width?: string
  readonly height?: string
}

interface GiphyGif {
  readonly id: string
  readonly title?: string
  readonly images?: Readonly<Record<string, Rendition | undefined>>
}

const API = 'https://api.giphy.com/v1/gifs'
/** What a message takes: GIPHY's « downsized », under 2 Mo, well within the 10 Mo a file may weigh. */
const MAX_BYTES = 10 * 1024 * 1024
const PAGE = 24

/** A query's answers, kept ten minutes: GIPHY counts the calls of a key. */
const cache = new Map<string, { readonly at: number; readonly hits: GifHit[] }>()
const KEPT_MS = 10 * 60_000

async function giphy<T>(url: URL): Promise<T> {
  let response: Response
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(8000) })
  } catch {
    throw new Refusal('GIFS_UNREACHABLE', 502)
  }
  if (!response.ok) throw new Refusal('GIFS_UNREACHABLE', 502, { status: response.status })
  return (await response.json()) as T
}

function hitOf(gif: GiphyGif): GifHit | null {
  const shown = gif.images?.fixed_width ?? gif.images?.fixed_width_small
  const preview = shown?.webp || shown?.url
  if (!preview) return null
  return {
    id: gif.id,
    title: gif.title?.replace(/\s+GIF(\s+by\s+.*)?$/i, '').trim() ?? '',
    preview,
    width: Number(shown?.width) || 200,
    height: Number(shown?.height) || 200,
  }
}

/** What GIPHY finds for `query` — its trending ones when there is none. */
export async function searchGifs(
  key: string,
  query: string,
  offset: number,
  language: string,
): Promise<GifHit[]> {
  const q = query.trim().slice(0, 50)
  const cached = `${language}:${q}:${offset}`
  const kept = cache.get(cached)
  if (kept && Date.now() - kept.at < KEPT_MS) return kept.hits

  const url = new URL(q ? `${API}/search` : `${API}/trending`)
  url.searchParams.set('api_key', key)
  url.searchParams.set('limit', String(PAGE))
  url.searchParams.set('offset', String(Math.max(0, Math.min(offset, 4999))))
  url.searchParams.set('rating', 'g')
  url.searchParams.set('bundle', 'messaging_non_clips')
  if (q) {
    url.searchParams.set('q', q)
    url.searchParams.set('lang', language)
  }
  const { data } = await giphy<{ data?: GiphyGif[] }>(url)
  const hits = (data ?? []).map(hitOf).filter((h): h is GifHit => h !== null)
  if (cache.size > 200) cache.delete(cache.keys().next().value as string)
  cache.set(cached, { at: Date.now(), hits })
  return hits
}

/** A GIF's bytes, to be sent as a file — by its GIPHY id, from GIPHY's own servers only. */
export async function gifFile(
  key: string,
  id: string,
): Promise<{ readonly bytes: ArrayBuffer; readonly name: string }> {
  if (!/^[A-Za-z0-9]{1,64}$/.test(id)) throw new Refusal('GIF_NOT_FOUND', 404)
  const url = new URL(`${API}/${id}`)
  url.searchParams.set('api_key', key)
  const { data } = await giphy<{ data?: GiphyGif }>(url)
  const source = data?.images?.downsized?.url ?? data?.images?.original?.url
  if (!source) throw new Refusal('GIF_NOT_FOUND', 404)
  const where = new URL(source)
  if (where.protocol !== 'https:' || !where.hostname.endsWith('.giphy.com')) {
    throw new Refusal('GIF_NOT_FOUND', 404)
  }
  let response: Response
  try {
    response = await fetch(where, { signal: AbortSignal.timeout(15_000) })
  } catch {
    throw new Refusal('GIFS_UNREACHABLE', 502)
  }
  const bytes = await response.arrayBuffer()
  if (!response.ok || bytes.byteLength === 0 || bytes.byteLength > MAX_BYTES) {
    throw new Refusal('GIF_NOT_FOUND', 404)
  }
  const title = (data?.title ?? '')
    .replace(/\s+GIF(\s+by\s+.*)?$/i, '')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
  return { bytes, name: `${title || 'gif'}.gif` }
}
