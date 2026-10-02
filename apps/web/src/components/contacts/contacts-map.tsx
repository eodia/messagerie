'use client'

import 'leaflet/dist/leaflet.css'
import type { LayerGroup, Map as LeafletMap, Marker } from 'leaflet'
import { useEffect, useRef, useState } from 'react'

/**
 * The contacts' map, behind the screen (D18): OpenStreetMap's tiles, greyed to stay a
 * ground. With no contact open, every contact a dot, the map flying over to frame them;
 * with one open, the map flies to them — their city, or their country when only their time
 * zone says where they are — and their pin pulses, in the band the sheet leaves visible.
 *
 * Leaflet draws it, as in basedb; it never moves under the hand — a backdrop, not a tool.
 * Motion is skipped for whoever asks the system for less.
 */

export interface MapPoint {
  readonly id: string
  readonly name: string
  readonly latitude: number
  readonly longitude: number
  readonly approximate: boolean
}

const TILES = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'
const FRANCE: [number, number] = [46.6, 2.4]
/** How close the map goes: to a city, or to a country. */
const CITY = 11
const COUNTRY = 5

const still = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

export function ContactsMap({
  points,
  focus,
  band,
  onPick,
}: {
  readonly points: readonly MapPoint[]
  /** The contact open, or none. */
  readonly focus: MapPoint | null
  /** The height of the map left visible above the sheet — `null`: all of it. */
  readonly band: number | null
  readonly onPick: (id: string) => void
}) {
  const host = useRef<HTMLDivElement>(null)
  const leaflet = useRef<typeof import('leaflet') | null>(null)
  const [map, setMap] = useState<LeafletMap | null>(null)
  const dots = useRef<LayerGroup | null>(null)
  const pin = useRef<Marker | null>(null)
  const pick = useRef(onPick)
  pick.current = onPick

  useEffect(() => {
    let created: LeafletMap | null = null
    let gone = false
    void import('leaflet').then((L) => {
      if (gone || !host.current) return
      leaflet.current = L
      created = L.map(host.current, {
        zoomControl: false,
        attributionControl: false,
        dragging: false,
        scrollWheelZoom: false,
        doubleClickZoom: false,
        boxZoom: false,
        keyboard: false,
        touchZoom: false,
        zoomSnap: 0,
      }).setView(FRANCE, 3)
      L.control
        .attribution({ prefix: false, position: 'topright' })
        .addAttribution('© OpenStreetMap')
        .addTo(created)
      L.tileLayer(TILES, { maxZoom: 19, className: 'contacts-map-tiles' }).addTo(created)
      dots.current = L.layerGroup().addTo(created)
      setMap(created)
    })
    return () => {
      gone = true
      created?.remove()
    }
  }, [])

  // The pane is resized with the window: the map keeps its centre.
  useEffect(() => {
    if (!map || !host.current) return
    const observer = new ResizeObserver(() => map.invalidateSize())
    observer.observe(host.current)
    return () => observer.disconnect()
  }, [map])

  // The dots, popping in one after another.
  useEffect(() => {
    const L = leaflet.current
    const layer = dots.current
    if (!map || !L || !layer) return
    layer.clearLayers()
    points.forEach((p, i) => {
      L.marker([p.latitude, p.longitude], {
        icon: L.divIcon({
          className: 'contact-marker',
          html: `<span class="contact-dot" style="--delay:${Math.min(i * 35, 900)}ms"></span>`,
          iconSize: [10, 10],
        }),
        keyboard: false,
      })
        .bindTooltip(escapeHtml(p.name), {
          className: 'contact-tip',
          direction: 'top',
          offset: [0, -6],
        })
        .on('click', () => pick.current(p.id))
        .addTo(layer)
    })
  }, [map, points])

  // The flight: to the contact open, or over all of them.
  useEffect(() => {
    const L = leaflet.current
    if (!map || !L) return
    const animate = !still()
    pin.current?.remove()
    pin.current = null
    if (focus) {
      const zoom = focus.approximate ? COUNTRY : CITY
      // The pin in the middle of the visible band, not of the whole map.
      const height = map.getSize().y
      const shift = band === null ? 0 : height / 2 - band / 2
      const at = map.unproject(
        map.project([focus.latitude, focus.longitude], zoom).add([0, shift]),
        zoom,
      )
      if (animate) map.flyTo(at, zoom, { duration: 1.8, easeLinearity: 0.15 })
      else map.setView(at, zoom, { animate: false })
      pin.current = L.marker([focus.latitude, focus.longitude], {
        icon: L.divIcon({
          className: 'contact-marker',
          html: `<span class="contact-pin${focus.approximate ? ' approximate' : ''}"><span class="ring"></span><span class="ring"></span><span class="dot"></span></span>`,
          iconSize: [14, 14],
        }),
        interactive: false,
        keyboard: false,
        zIndexOffset: 1000,
      }).addTo(map)
      return
    }
    if (points.length === 0) {
      map.setView(FRANCE, COUNTRY, { animate })
      return
    }
    const bounds = L.latLngBounds(points.map((p) => [p.latitude, p.longitude] as [number, number]))
    const options = { padding: [80, 80] as [number, number], maxZoom: 7 }
    if (animate) map.flyToBounds(bounds, { ...options, duration: 1.6, easeLinearity: 0.15 })
    else map.fitBounds(bounds, { ...options, animate: false })
  }, [map, focus, band, points])

  // Isolated: its panes stack among themselves, never over the sheet.
  return <div ref={host} className="contacts-map absolute inset-0 isolate" aria-hidden />
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)
}
