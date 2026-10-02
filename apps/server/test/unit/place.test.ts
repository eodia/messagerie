import { describe, expect, it } from 'vitest'
import { knownZone, placeOfZone, pointOf } from '../../src/places/place.js'

/** Where a visitor is, from the time zone their browser gives (D18). */

describe('a time zone', () => {
  it('says a country and a city', () => {
    expect(placeOfZone('Europe/Paris')).toEqual({ country: 'FR', latitude: 48.87, longitude: 2.33 })
    expect(placeOfZone('America/Argentina/Buenos_Aires')?.country).toBe('AR')
  })

  it('is known by its old names too, as browsers still give them', () => {
    expect(knownZone('Asia/Calcutta')).toBe('Asia/Kolkata')
    expect(knownZone('Europe/Kiev')).toBe('Europe/Kyiv')
  })

  it('is refused when it is not one', () => {
    for (const raw of ['Mars/Olympus', 'UTC', '../etc/passwd', 'Europe/Paris; drop', 42, null]) {
      expect(knownZone(raw)).toBeNull()
    }
  })

  it('makes a point approximate only when it is the zone’s own city', () => {
    expect(pointOf({ timeZone: 'Europe/Paris', latitude: 48.87, longitude: 2.33 })).toEqual({
      latitude: 48.87,
      longitude: 2.33,
      approximate: true,
    })
    expect(
      pointOf({ timeZone: 'Europe/Paris', latitude: 45.764, longitude: 4.8357 })?.approximate,
    ).toBe(false)
    expect(pointOf({ timeZone: 'Europe/Paris', latitude: null, longitude: null })).toBeNull()
  })
})
