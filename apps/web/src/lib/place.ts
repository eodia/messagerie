import { $t, intlLocale } from './i18n'

/**
 * Where a contact is, said in words (D18): the place a site gave — « Lyon, France » —, or
 * what their browser's time zone says: a country, and its clock.
 */

let regions: Intl.DisplayNames | null = null

/** A country's name in the reader's language: « Allemagne » for `DE`. */
export function countryName(code: string): string {
  try {
    regions ??= new Intl.DisplayNames([intlLocale()], { type: 'region' })
    return regions.of(code.toUpperCase()) ?? code
  } catch {
    return code
  }
}

/** The city a time zone is named after: « Sao Paulo » for `America/Sao_Paulo`. */
export const zoneCity = (zone: string): string =>
  (zone.split('/').at(-1) ?? zone).replace(/_/g, ' ')

/** Where they are, in a few words — the site's place, or their country —, or `null`. */
export function whereOf(contact: {
  readonly location: string | null
  readonly country: string | null
}): string | null {
  return contact.location ?? (contact.country ? countryName(contact.country) : null)
}

/**
 * Where they are, in full: the site's place, or their country and the clock their zone
 * keeps — « France · heure de Paris ».
 */
export function whereInFull(contact: {
  readonly location: string | null
  readonly country: string | null
  readonly timeZone: string | null
}): string | null {
  if (contact.location) return contact.location
  if (!contact.country) return null
  return contact.timeZone
    ? $t('{country} · heure de {city}', {
        country: countryName(contact.country),
        city: zoneCity(contact.timeZone),
      })
    : countryName(contact.country)
}

/** The time on the contact's clock: « 10:14 ». */
export function clockOf(zone: string, now: Date | number): string | null {
  try {
    return new Intl.DateTimeFormat(intlLocale(), {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: zone,
    }).format(now)
  } catch {
    return null
  }
}
