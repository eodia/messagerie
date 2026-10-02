import type { GeoPoint } from '@chat/contracts'
import { LINKS, ZONES } from './zones.js'

/**
 * Where a visitor is, roughly (D18): the time zone their browser gives says a country and
 * a city — the zone's own, Paris for all of metropolitan France. No address, no IP looked
 * up, no service asked: a flag, and a point to centre a map on, no more.
 */

export interface ZonePlace {
  readonly country: string
  readonly latitude: number
  readonly longitude: number
}

const ZONE = /^[A-Za-z][A-Za-z0-9_+-]*(\/[A-Za-z0-9_+-]+){1,2}$/

const zones = new Map<string, ZonePlace>()
for (const line of ZONES.trim().split('\n')) {
  const [name = '', country = '', latitude = '0', longitude = '0'] = line.split(' ')
  zones.set(name, { country, latitude: Number(latitude), longitude: Number(longitude) })
}
const links = new Map<string, string>()
for (const line of LINKS.trim().split('\n')) {
  const [alias = '', target = ''] = line.split('=')
  links.set(alias, target)
}

/** A time zone as the browser gives it, if it is one: its canonical name, or `null`. */
export function knownZone(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length > 64 || !ZONE.test(raw)) return null
  const name = links.get(raw) ?? raw
  return zones.has(name) ? name : null
}

/** The country and the city of a time zone — `null` for one the table does not know. */
export function placeOfZone(zone: string | null): ZonePlace | null {
  if (zone === null) return null
  return zones.get(links.get(zone) ?? zone) ?? null
}

/** Whether a point is a zone's own city — so said by the browser, not by the site. */
export function isZonePoint(
  zone: string | null,
  latitude: number | null,
  longitude: number | null,
): boolean {
  const place = placeOfZone(zone)
  return place !== null && place.latitude === latitude && place.longitude === longitude
}

/** The contact's point, as the inbox shows it — and whether it is only their zone's city. */
export function pointOf(contact: {
  readonly timeZone: string | null
  readonly latitude: number | null
  readonly longitude: number | null
}): GeoPoint | null {
  if (contact.latitude === null || contact.longitude === null) return null
  return {
    latitude: contact.latitude,
    longitude: contact.longitude,
    approximate: isZonePoint(contact.timeZone, contact.latitude, contact.longitude),
  }
}
